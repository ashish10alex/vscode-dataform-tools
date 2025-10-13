import * as vscode from 'vscode';
import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation, getGcpProjectLocationDataform, getGcpProjectIdDataform } from "./utils";
import { createDataformWorkflowInvocation } from "./runDataformWtApi";

export async function runCurrentFile(includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {

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

    let currFileMetadata;
    let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder); // Takes ~1100ms

    if(errors && errors.length > 0){
        vscode.window.showErrorMessage("Error compiling Dataform. Run `dataform compile` to see more details");
        return;
    }

    if (dataformCompiledJson) {
        currFileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
    }

    if (currFileMetadata) {
        let actionsList: string[] = currFileMetadata.tables.map(table => `${table.target.database}.${table.target.schema}.${table.target.name}`);

        let dataformActionCmd = "";

        let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDownstreamDependents, fullRefresh);
        runCommandInTerminal(dataformActionCmd);
    }
}


export async function runCurrentFileWtApi(transitiveDependenciesIncluded:boolean,transitiveDependentsIncluded:boolean,fullyRefreshIncrementalTablesEnabled:boolean) {

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

    if (!CACHED_COMPILED_DATAFORM_JSON) {

        let workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        let {dataformCompiledJson} = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    if(!CACHED_COMPILED_DATAFORM_JSON){
        return;
    }

    let currFileMetadata;
    if (CACHED_COMPILED_DATAFORM_JSON) {
        currFileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, CACHED_COMPILED_DATAFORM_JSON);
    }

    if(!currFileMetadata){
        vscode.window.showErrorMessage(`No metadata found for the current file ${filename}`);
        return;
    }

    let actionsList: {database:string, schema: string, name:string}[] = [];
    currFileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; }) => {
        const action = {database: table.target.database, schema: table.target.schema, name: table.target.name};
        actionsList.push(action);
    });

    const projectId = await getGcpProjectIdDataform(CACHED_COMPILED_DATAFORM_JSON);
    if(!projectId){
        vscode.window.showErrorMessage(`Unable to determine GCP project location to use for Dataform API run`);
        return;
    }

    let gcpProjectLocation = await getGcpProjectLocationDataform(projectId, CACHED_COMPILED_DATAFORM_JSON);

    const invocationConfig = {
        includedTargets: actionsList,
        transitiveDependenciesIncluded: transitiveDependenciesIncluded,
        transitiveDependentsIncluded: transitiveDependentsIncluded,
        fullyRefreshIncrementalTablesEnabled: fullyRefreshIncrementalTablesEnabled,
    };

    createDataformWorkflowInvocation(projectId, gcpProjectLocation, invocationConfig);
}
