import * as vscode from 'vscode';
import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation, showLoadingProgress } from "./utils";
import { _syncAndrunDataformRemotely } from "./dataformApiUtils";
import { ExecutionMode } from './types';

export async function runCurrentFile(includDependencies: boolean, includeDependents: boolean, fullRefresh: boolean, executionMode:ExecutionMode): Promise<{ workflowInvocationUrlGCP: string|undefined; errorWorkflowInvocation: string|undefined; } | undefined> {

    let document =  getVSCodeDocument() || activeDocumentObj;
    if (!document) {
        return;
    }

    let normalizeForWindows = true;
    if (executionMode === "api" || executionMode === "api_workspace") {
        normalizeForWindows = false;
    }

    var result = getFileNameFromDocument(document, false, normalizeForWindows);
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
    } else if (executionMode === "api" || executionMode === "api_workspace") {
        const compilationType = executionMode  === "api" ? "gitBranch" : "workspace";
        try{
            await showLoadingProgress(
                "",
                _syncAndrunDataformRemotely,
                "Dataform remote workspace execution cancelled",
                compilationType,
                relativeFilePath,
                includDependencies,
                includeDependents,
                fullRefresh,
                compilerOptionsMap,
            );
            return;
        } catch(error:any){
            vscode.window.showErrorMessage(error.message);
            return {workflowInvocationUrlGCP: undefined, errorWorkflowInvocation: error.message};
        }
    }
    return;
}