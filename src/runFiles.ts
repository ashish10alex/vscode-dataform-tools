import * as vscode from 'vscode';
import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation } from "./utils";

export async function runCurrentFile(includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {

    let document = activeDocumentObj || getVSCodeDocument();
    if (!document) {
        return;
    }

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        return;
         //{ return {errors: {errorGettingFileNameFromDocument: result.error}}; }
        //TODO: should we return an error here ?
    }
    const [filename, relativeFilePath, extension] = result.value;
    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }
    workspaceFolder = `"${workspaceFolder}"`;

    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();

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

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDownstreamDependents, fullRefresh);
        runCommandInTerminal(dataformActionCmd);
    }
}
