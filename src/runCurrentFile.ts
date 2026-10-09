import * as vscode from 'vscode';
import { compiledJson } from './project';
import { getDataformActionCmdFromActionList, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCompilation, showLoadingProgress, getCachedDataformRepositoryLocation, ensureFreshCompilation } from "./utils";
import { loadDataformTools } from "./lazySdk";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely } from "./dataformApiUtils";
import { ExecutionMode, LastRunRequest } from './types';
import { GitService } from './gitClient';
import { confirmRemoteRun, resolveExecutionMode } from './utils/remoteCompiler';
import { getPropertyGraphsForFile } from './shared/propertyGraph';
import { beginRun } from './defer/deferRun';
import { runDataformRunInTerminal } from './cliRunJobs';
import { resolveDataformOptions } from './project/dataformOptions';
import { extensionConfiguration } from './project/settings';

/** Runs the active file, or `relativeFilePathOverride` (workspace-relative) when rerunning a previous execution. */
export async function runCurrentFile(context: vscode.ExtensionContext, includDependencies: boolean, includeDependents: boolean, fullRefresh: boolean, executionMode:ExecutionMode, relativeFilePathOverride?: string): Promise<{ workflowInvocationUrlGCP: string|undefined; errorWorkflowInvocation: string|undefined; } | undefined> {
    executionMode = resolveExecutionMode(executionMode);

    let relativeFilePath = relativeFilePathOverride;
    if (!relativeFilePath) {
        let document =  getVSCodeDocument() || activeDocumentObj;
        if (!document) {
            return;
        }

        const result = getFileNameFromDocument(document, false);
        if (result.success === false) {
            vscode.window.showErrorMessage(`Extension was unable to get filename of the current file`);
            return;
        }
        relativeFilePath = result.value[1];
    }
    let workspaceFolder = await getWorkspaceFolder({ explain: true });
    if (!workspaceFolder) {
        return;
    }


    let currFileMetadata;
    await ensureFreshCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder));
    let compiled = compiledJson(workspaceFolder);
    if (!compiled) {

        let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder)); // Takes ~1100ms
        if(errors && errors.length > 0){
            vscode.window.showErrorMessage("Error compiling Dataform. Run `dataform compile` to see more details");
            return;
        }
        compiled = dataformCompiledJson;
    }

    if (compiled) {
        currFileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, compiled, workspaceFolder);
    }
    if(!currFileMetadata){
        vscode.window.showErrorMessage(`Unable to get metadata for the current file`);
        return;
    }

    // PropertyGraph actions produce no queries, so they are absent from `tables` and have to be
    // picked up from the compiled output directly for the file to be runnable at all.
    const propertyGraphs = getPropertyGraphsForFile(relativeFilePath, compiled)
        .filter((graph) => !graph.disabled);

    // Saved only once the run is about to dispatch, so a cancelled or non-runnable run does not replace the last one.
    const lastRunRequest: Omit<LastRunRequest, 'timestamp'> = { kind: 'currentFile', items: [relativeFilePath], includeDependencies: includDependencies, includeDependents, fullRefresh, executionMode, workspaceFolder };

    if (executionMode === "cli") {
        let actionsList: string[] = currFileMetadata.tables
            .filter((table: any) => table.type !== 'test')
            .map(table => `${table.target.database}.${table.target.schema}.${table.target.name}`);

        propertyGraphs.forEach((graph) => {
            actionsList.push(`${graph.target.database}.${graph.target.schema}.${graph.target.name}`);
        });

        if (actionsList.length === 0) {
            vscode.window.showErrorMessage(`No runnable Dataform actions found in ${relativeFilePath}`);
            return;
        }

        let dataformActionCmd = "";

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, includDependencies, includeDependents, fullRefresh);
        if (!(await beginRun(lastRunRequest))) { return; }
        const targets = [...currFileMetadata.tables.filter((table: any) => table.type !== 'test'), ...propertyGraphs].map(({ target }) => ({ database: target.database, schema: target.schema, name: target.name }));
        await runDataformRunInTerminal(workspaceFolder, dataformActionCmd, { targets, includeDependencies: includDependencies, includeDependents, fullRefresh });
        return;
    } else if (executionMode === "api" || executionMode === "api_workspace"){
        const gcpProjectIdOveride = extensionConfiguration().get('gcpProjectId');
        const projectId = (gcpProjectIdOveride || compiled?.projectConfig.defaultDatabase) as string | undefined;
        if(!projectId){
            vscode.window.showErrorMessage("Unable to determine GCP project id to use for Dataform API run");
            return;
        }

        let actionsList: {database:string, schema: string, name:string}[] = [];
        currFileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; type?: string }) => {
            if (table.type === 'test') {
                return;
            }
            const action = {database: table.target.database, schema: table.target.schema, name: table.target.name};
            actionsList.push(action);
        });

        propertyGraphs.forEach((graph) => {
            actionsList.push({database: graph.target.database, schema: graph.target.schema, name: graph.target.name});
        });

        if (actionsList.length === 0) {
            vscode.window.showErrorMessage(`No runnable Dataform actions found in ${relativeFilePath}`);
            return;
        }

        const invocationConfig = {
            includedTargets: actionsList,
            transitiveDependenciesIncluded: includDependencies,
            transitiveDependentsIncluded: includeDependents,
            fullyRefreshIncrementalTablesEnabled: fullRefresh,
        };

        try{
            if(executionMode === "api_workspace"){
                if (!(await beginRun(lastRunRequest))) { return; }
                await showLoadingProgress(
                    "",
                    syncAndrunDataformRemotely,
                    "Dataform remote workspace execution cancelled",
                    context,
                    invocationConfig,
                    globalThis.compilerOptionsMap,
                );
                return;
            }

            if (!(await confirmRemoteRun())) {
                return;
            }
            if (!(await beginRun(lastRunRequest))) { return; }

            const gitClient = new GitService();
            const gitInfo = await gitClient.getGitBranchAndRepoName();
            if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
                throw new Error("Error determining git repository and or branch name");
            } 
            const repositoryName = gitInfo.gitRepoName;
            vscode.window.showInformationMessage(`Creating workflow invocation with ${gitInfo.gitBranch} remote git branch ...`);

            const gcpProjectLocation = await getCachedDataformRepositoryLocation(context, repositoryName);
            if (!gcpProjectLocation) {
                vscode.window.showInformationMessage("Could not determine the location where Dataform repository is hosted, aborting...");
                return;
            }

            const dataformClient = new (await loadDataformTools())(projectId, gcpProjectLocation);

            const output = await dataformClient.runDataformRemotely(repositoryName, globalThis.compilerOptionsMap, invocationConfig, undefined, gitInfo.gitBranch);
            if(!output){
                throw new Error("Error creating workflow invocation");
            }
            await sendWorkflowInvocationNotification(output.workflowInvocationUrl, context, invocationConfig, gitInfo.gitBranch, "api", output.workflowInvocationId, projectId, gcpProjectLocation, repositoryName);
            //NOTE: I am assuming that if the user has got this far the location set was correct, so caching it
            await context.globalState.update(`vscode_dataform_tools_${repositoryName}`, gcpProjectLocation);
            return {workflowInvocationUrlGCP: output.workflowInvocationUrl, errorWorkflowInvocation: undefined};
        } catch(error:any){
            vscode.window.showErrorMessage(error.message);
            return {workflowInvocationUrlGCP: undefined, errorWorkflowInvocation: error.message};
        }
    }
    return;
}