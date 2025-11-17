import * as vscode from 'vscode';
import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation, getLocationOfGcpProject, showLoadingProgress } from "./utils";
import { DataformTools } from "@ashishalex/dataform-tools";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely } from "./dataformApiUtils";
import { ExecutionMode } from './types';
import { getGitBranchAndRepoName } from './getGitMeta';

export async function runCurrentFile(includDependencies: boolean, includeDependents: boolean, fullRefresh: boolean, executionMode:ExecutionMode): Promise<{ workflowInvocationUrlGCP: string|undefined; errorWorkflowInvocation: string|undefined; } | undefined> {

    let document =  getVSCodeDocument() || activeDocumentObj;
    if (!document) {
        return;
    }

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        vscode.window.showErrorMessage(`Extension was unable to get filename of the current file`);
        return;
    }
    //@ts-ignore
    const [filename, relativeFilePath, extension] = result.value;
    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();

    let currFileMetadata;
    if (!CACHED_COMPILED_DATAFORM_JSON) {

        let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder); // Takes ~1100ms
        if(errors && errors.length > 0){
            vscode.window.showErrorMessage("Error compiling Dataform. Run `dataform compile` to see more details");
            return;
        }
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    if (CACHED_COMPILED_DATAFORM_JSON) {
        currFileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, CACHED_COMPILED_DATAFORM_JSON);
    }
    if(!currFileMetadata){
        vscode.window.showErrorMessage(`Unable to get metadata for the current file`);
        return;
    }

    if (executionMode === "cli") {
        let actionsList: string[] = currFileMetadata.tables.map(table => `${table.target.database}.${table.target.schema}.${table.target.name}`);

        let dataformActionCmd = "";

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDependents, fullRefresh);
        runCommandInTerminal(dataformActionCmd);
        return;
    } else if (executionMode === "api" || executionMode === "api_workspace"){
        const projectId = CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase;
        if(!projectId){
            vscode.window.showErrorMessage("Unable to determine GCP project id to use for Dataform API run");
            return;
        }

        let gcpProjectLocation = undefined;
        if(CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultLocation){
            gcpProjectLocation = CACHED_COMPILED_DATAFORM_JSON.projectConfig.defaultLocation;
        }else{
            gcpProjectLocation = await getLocationOfGcpProject(projectId);
        }

        if(!gcpProjectLocation){
            vscode.window.showErrorMessage("Unable to determine GCP project location to use for Dataform API run");
            return;
        }

        let actionsList: {database:string, schema: string, name:string}[] = [];
        currFileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; }) => {
            const action = {database: table.target.database, schema: table.target.schema, name: table.target.name};
            actionsList.push(action);
        });

        const invocationConfig = {
            includedTargets: actionsList,
            transitiveDependenciesIncluded: includDependencies,
            transitiveDependentsIncluded: includeDependents,
            fullyRefreshIncrementalTablesEnabled: fullRefresh,
        };

        try{
            if(executionMode === "api_workspace"){
                await showLoadingProgress(
                    "",
                    syncAndrunDataformRemotely,
                    "Dataform remote workspace execution cancelled",
                    invocationConfig,
                    compilerOptionsMap,
                );
                return;
            }
            const dataformClient = new DataformTools(projectId, gcpProjectLocation);
            const gitInfo = getGitBranchAndRepoName();
            if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
                throw new Error("Error determining git repository and or branch name");
            } 
            const repositoryName = gitInfo.gitRepoName;
            vscode.window.showInformationMessage(`Creating workflow invocation with ${gitInfo.gitBranch} remote git branch ...`);

            const workflowInvocation = await dataformClient.runDataformRemotely(repositoryName, compilerOptionsMap, invocationConfig, undefined, gitInfo.gitBranch);
            const workflowInvocationId = workflowInvocation?.name?.split("/").pop();
            if(workflowInvocationId){
                const workflowInvocationUrl = dataformClient.getWorkflowInvocationUrl(repositoryName, workflowInvocationId);
                sendWorkflowInvocationNotification(workflowInvocationUrl);
                return {workflowInvocationUrlGCP: workflowInvocationUrl, errorWorkflowInvocation: undefined};
            }
        } catch(error:any){
            vscode.window.showErrorMessage(error.message);
            return {workflowInvocationUrlGCP: undefined, errorWorkflowInvocation: error.message};
        }
    }
    return;
}