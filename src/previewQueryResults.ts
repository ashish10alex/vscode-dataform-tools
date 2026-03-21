import * as vscode from 'vscode';
import { getCurrentFileMetadata, handleSemicolonPrePostOps } from "./utils";
import { CustomViewProvider } from './views/register-query-results-panel';
import { QueryWtType, TablesWtFullQuery } from './types';

export async function runQueryInPanel(queryWtType: QueryWtType, queryResultsViewProvider: CustomViewProvider) {
    if (!queryResultsViewProvider._view) {
        queryResultsViewProvider.focusWebview(queryWtType);
    } else {
        queryResultsViewProvider.updateContent(queryWtType);
    }
}

export function getQueryStringForPreview(fileMetadata: TablesWtFullQuery, isIncremental: boolean): string {
    let query = "";
    if (fileMetadata.queryMeta.type === "assertion") {
        query = fileMetadata.queryMeta.assertionQuery;
    } else if (fileMetadata.queryMeta.type === "table" || fileMetadata.queryMeta.type === "view") {
        query = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.tableQueries.map((t: { query: string }) => t.query).join("\n");
    } else if (fileMetadata.queryMeta.type === "operations") {
        query = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.operationsQuery;
    } else if (fileMetadata.queryMeta.type === "incremental") {
        if (isIncremental === true){
            query = fileMetadata.queryMeta.incrementalPreOpsQuery + fileMetadata.queryMeta.incrementalQueries.map((q: { incrementalQuery: string }) => q.incrementalQuery).join("\n");
        } else {
            query = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.incrementalQueries.map((q: { nonIncrementalQuery: string }) => q.nonIncrementalQuery).join("\n");
        }
    } else if (fileMetadata.queryMeta.type === "test") {
        query = fileMetadata.queryMeta.testQuery;
    }
    return query;
}

export async function previewQueryResults(queryResultsViewProvider: CustomViewProvider) {
    let curFileMeta = await getCurrentFileMetadata(false);
    if (!curFileMeta?.fileMetadata) {
        return;
    }

    let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
    let query = getQueryStringForPreview(fileMetadata, incrementalCheckBox);

    if (query === "") {
        vscode.window.showWarningMessage("No query to run");
        return;
    }
    runQueryInPanel({query: query, type: fileMetadata.queryMeta.type}, queryResultsViewProvider);
}
