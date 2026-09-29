import * as vscode from 'vscode';
import { getCurrentFileMetadata, handleSemicolonPrePostOps } from "./utils";
import { CustomViewProvider } from './views/register-query-results-panel';
import { CurrentFileMetadata, QueryWtType, TablesWtFullQuery } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { countDeferred, handleAccessDenied } from './defer';

export async function runQueryInPanel(queryWtType: QueryWtType, queryResultsViewProvider: CustomViewProvider) {
    if (!queryResultsViewProvider._view) {
        queryResultsViewProvider.focusWebview(queryWtType);
    } else {
        queryResultsViewProvider.updateContent(queryWtType);
    }
}

export function getQueryStringForPreview(fileMetadata: TablesWtFullQuery, isIncremental: boolean, skipPreOps?: boolean): string {
    if (skipPreOps === undefined) {
        skipPreOps = vscode.workspace.getConfiguration('vscode-dataform-tools').get('skipPreOpsInPreviewQuery') ?? false;
    }
    const preOpsQuery = skipPreOps ? "" : fileMetadata.queryMeta.preOpsQuery;
    const incrementalPreOpsQuery = skipPreOps ? "" : fileMetadata.queryMeta.incrementalPreOpsQuery;

    let query = "";
    if (fileMetadata.queryMeta.type === "assertion") {
        query = fileMetadata.queryMeta.assertionQuery;
    } else if (fileMetadata.queryMeta.type === "table" || fileMetadata.queryMeta.type === "view") {
        query = preOpsQuery + fileMetadata.queryMeta.tableQueries.map((t: { query: string }) => t.query).join("\n");
    } else if (fileMetadata.queryMeta.type === "operations") {
        query = preOpsQuery + fileMetadata.queryMeta.operationsQuery;
    } else if (fileMetadata.queryMeta.type === "incremental") {
        if (isIncremental === true){
            query = incrementalPreOpsQuery + fileMetadata.queryMeta.incrementalQueries.map((q: { incrementalQuery: string }) => q.incrementalQuery).join("\n");
        } else {
            query = preOpsQuery + fileMetadata.queryMeta.incrementalQueries.map((q: { nonIncrementalQuery: string }) => q.nonIncrementalQuery).join("\n");
        }
    } else if (fileMetadata.queryMeta.type === "test") {
        query = fileMetadata.queryMeta.testQuery;
    }
    return query;
}

function formatGiB(bytes: number): string {
    return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
}

/**
 * Checks a preview that reads upstream tables from prod before running it. A prod table we cannot read makes
 * the preview fall back to its dev table, and a scan above `deferPreviewScanWarningGiB` asks first, as prod
 * tables are often much larger than their dev copies. Returns the query to run, or undefined to cancel.
 */
async function checkDeferredPreview(curFileMeta: CurrentFileMetadata, query: string): Promise<{ query: string, fileMetadata: TablesWtFullQuery } | undefined> {
    let fileMetadata = curFileMeta.fileMetadata!;
    let dryRun = await queryDryRun(query);
    if (handleAccessDenied(curFileMeta.deferral, [dryRun.error?.message]).length > 0) {
        const reread = await getCurrentFileMetadata(false);
        if (!reread?.fileMetadata) {
            return undefined;
        }
        curFileMeta = reread;
        fileMetadata = handleSemicolonPrePostOps(reread.fileMetadata);
        query = getQueryStringForPreview(fileMetadata, incrementalCheckBox);
        dryRun = await queryDryRun(query);
    }

    const deferred = countDeferred(curFileMeta.deferral);
    const thresholdGiB = vscode.workspace.getConfiguration('vscode-dataform-tools').get<number>('deferPreviewScanWarningGiB') ?? 10;
    const bytes = dryRun.statistics?.totalBytesProcessed ?? 0;
    if (deferred > 0 && thresholdGiB > 0 && !dryRun.error?.hasError && bytes > thresholdGiB * (1024 ** 3)) {
        const cost = dryRun.statistics?.cost;
        const costText = cost ? ` (~${cost.value.toFixed(2)} ${cost.currency})` : "";
        const choice = await vscode.window.showWarningMessage(
            `This preview scans ${formatGiB(bytes)}${costText}. ${deferred} upstream table${deferred === 1 ? " is" : "s are"} read from prod. Run it?`,
            { modal: true },
            "Run",
        );
        if (choice !== "Run") {
            return undefined;
        }
    }
    return { query, fileMetadata };
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
    if (countDeferred(curFileMeta.deferral) > 0) {
        const checked = await checkDeferredPreview(curFileMeta, query);
        if (!checked) {
            return;
        }
        ({ query, fileMetadata } = checked);
    }
    runQueryInPanel({query: query, type: fileMetadata.queryMeta.type}, queryResultsViewProvider);
}
