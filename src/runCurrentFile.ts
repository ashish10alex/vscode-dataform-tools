import * as vscode from 'vscode';
import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation, getLocationOfGcpProject } from "./utils";
import { createDataformWorkflowInvocation } from "./runDataformWtApi";

export async function runCurrentFile(includDependencies: boolean, includeDependents: boolean, fullRefresh: boolean, executionMode:string) {

    let document =  getVSCodeDocument() || activeDocumentObj;
    if (!document) {
        return;
    }

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        return;
         //{ return {errors: {errorGettingFileNameFromDocument: result.error}}; }
        //TODO: should we return an error here ?
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

        let workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

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
        //TODO: throw some error here
        return;
    }

    if (executionMode === "cli") {
        let actionsList: string[] = currFileMetadata.tables.map(table => `${table.target.database}.${table.target.schema}.${table.target.name}`);

        let dataformActionCmd = "";

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDependents, fullRefresh);
        runCommandInTerminal(dataformActionCmd);
    } else if (executionMode === "api"){
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

        createDataformWorkflowInvocation(projectId, gcpProjectLocation, invocationConfig);

    }
}