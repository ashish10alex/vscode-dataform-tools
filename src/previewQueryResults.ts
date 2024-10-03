import * as vscode from 'vscode';
import { getCurrentFileMetadata, handleSemicolonPrePostOps } from "./utils";
import { CustomViewProvider } from './views/register-query-results-panel';

export async function runQueryInPanel(query: string, queryResultsViewProvider: CustomViewProvider) {
    if (!queryResultsViewProvider._view) {
        queryResultsViewProvider.focusWebview(query);
    } else {
        queryResultsViewProvider.updateContent(query);
    }
}

export async function previewQueryResults(queryResultsViewProvider: CustomViewProvider) {
    let fileMetadata = await getCurrentFileMetadata(false);
    if (!fileMetadata) {
        return;
    }

    fileMetadata = handleSemicolonPrePostOps(fileMetadata);

    let query = "";
    if (fileMetadata.queryMeta.type === "assertion") {
        query = fileMetadata.queryMeta.assertionQuery;
    } else if (fileMetadata.queryMeta.type === "table" || fileMetadata.queryMeta.type === "view") {
        query = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.tableOrViewQuery;
    } else if (fileMetadata.queryMeta.type === "operations") {
        query = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.operationsQuery;
    } else if (fileMetadata.queryMeta.type === "incremental") {
        query = fileMetadata.queryMeta.incrementalPreOpsQuery + fileMetadata.queryMeta.incrementalQuery;
    }
    if (query === "") {
        vscode.window.showWarningMessage("No query to run");
        return;
    }
    runQueryInPanel(query, queryResultsViewProvider);
}
