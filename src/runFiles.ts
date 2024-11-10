import { getDataformActionCmdFromActionList, getDataformCompilationTimeoutFromConfig, getFileNameFromDocument, getQueryMetaForCurrentFile, getVSCodeDocument, getWorkspaceFolder, runCommandInTerminal, runCompilation } from "./utils";

export async function runCurrentFile(includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {


    let document = getVSCodeDocument();
    if (!document) {
        return;
    }
    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
    if (!filename || !relativeFilePath || !extension) {
        return;
    }
    let workspaceFolder = getWorkspaceFolder();

    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();

    if (!workspaceFolder) {
        return;
    }

    let currFileMetadata;
    let {dataformCompiledJson, error} = await runCompilation(workspaceFolder); // Takes ~1100ms
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