import * as vscode from 'vscode';
import { ensureFreshCompilation, getCurrentFileMetadata, getWorkspaceFolder, handleSemicolonPrePostOps } from "./utils";
import { CustomViewProvider } from './views/register-query-results-panel';
import { QueryWtType, TablesWtFullQuery } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { countDeferred, Deferral, handleAccessDenied, resolveDeferralForActions } from './defer';
import { applyDeferralToAction } from './defer/deferRules';
import { previewQuery } from './bigquery/preview';
import { compiledGraph, compiledJson } from './project';
import { resolveDataformOptions } from './project/dataformOptions';
import { Kind, Target, actionsInFile, isMadeUpTarget, previewSection, targetId } from './shared/compiledGraph';
import { withoutPreOperations } from './utils/dryRunOrchestrator';

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

/** A preview's query and the deferral its SQL was rewritten with */
interface DeferredPreview {
    query: string;
    deferral?: Deferral;
}

/**
 * Checks a preview that reads upstream tables from prod before running it. A prod table we cannot read makes
 * the preview fall back to its dev table, for which the preview is `read` again, and a scan above
 * `deferPreviewScanWarningGiB` asks first, as prod tables are often much larger than their dev copies. Returns the
 * preview to run, or undefined to cancel.
 */
async function checkDeferredPreview<Preview extends DeferredPreview>(preview: Preview, read: () => Promise<Preview | undefined>): Promise<Preview | undefined> {
    let dryRun = await queryDryRun(preview.query);
    if (handleAccessDenied(preview.deferral, [dryRun.error?.message]).length > 0) {
        const reread = await read();
        if (!reread) {
            return undefined;
        }
        preview = reread;
        dryRun = await queryDryRun(preview.query);
    }

    const deferred = countDeferred(preview.deferral);
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
    return preview;
}

export async function previewQueryResults(queryResultsViewProvider: CustomViewProvider) {
    const read = async () => {
        const curFileMeta = await getCurrentFileMetadata(false);
        if (!curFileMeta?.fileMetadata) {
            return undefined;
        }
        const fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
        return { query: getQueryStringForPreview(fileMetadata, incrementalCheckBox), deferral: curFileMeta.deferral, fileMetadata };
    };
    let preview = await read();
    if (!preview) {
        return;
    }

    if (preview.query === "") {
        vscode.window.showWarningMessage("No query to run");
        return;
    }
    if (countDeferred(preview.deferral) > 0) {
        preview = await checkDeferredPreview(preview, read);
        if (!preview) {
            return;
        }
    }
    runQueryInPanel({query: preview.query, type: preview.fileMetadata.queryMeta.type}, queryResultsViewProvider);
}

/** What the results view calls an action of the Kind */
function resultsType(kind: Kind): string {
    return kind === 'operation' ? 'operations' : kind === 'unit test' ? 'test' : kind;
}

/**
 * Previews the section titled `section` of the action at `target`, whichever file is open: what the panel asks for.
 * The query is that of `previewQuery`, on the action as the panel shows and dry-runs it: reading Deferred Actions
 * from prod, and without pre-operations when the `skipPreOpsInPreviewQuery` setting says so. The results view's
 * "incremental" switch still chooses the variant of an incremental table, as it does for a preview of the open file.
 */
export async function previewAction(target: Target, section: string, alone?: boolean) {
    const workspaceFolder = await getWorkspaceFolder({ explain: true });
    if (!workspaceFolder) {
        return;
    }
    await ensureFreshCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder));
    const graph = compiledGraph(workspaceFolder);
    const compiled = compiledJson(workspaceFolder);
    const action = graph?.actions[targetId(target)];
    if (!graph || !compiled || !action) {
        vscode.window.showWarningMessage("No query to run");
        return;
    }
    if (incrementalCheckBox && section === previewSection(action)) {
        section = previewSection(action, true) ?? section;
    }

    const skipPreOps = vscode.workspace.getConfiguration('vscode-dataform-tools').get('skipPreOpsInPreviewQuery') ?? false;
    // Deferral is decided for the file's actions together, as it is for what the panel shows of the file
    const selected = actionsInFile(graph, action.fileName).map((inFile) => ({
        target: isMadeUpTarget(inFile.target) ? undefined : inFile.target,
        dependencyTargets: inFile.dependencyTargets,
        type: resultsType(inFile.kind),
    }));
    const read = async () => {
        const deferral = await resolveDeferralForActions(selected, compiled, workspaceFolder);
        const deferred = applyDeferralToAction(action, deferral?.entries ?? []);
        const query = previewQuery(skipPreOps ? withoutPreOperations(deferred) : deferred, section, { alone })?.sql;
        return query ? { query, deferral } : undefined;
    };

    let preview = await read();
    if (!preview) {
        vscode.window.showWarningMessage("No query to run");
        return;
    }
    if (countDeferred(preview.deferral) > 0) {
        preview = await checkDeferredPreview(preview, read);
        if (!preview) {
            return;
        }
    }
    await vscode.commands.executeCommand('vscode-dataform-tools.runGeneratedQuery', preview.query, resultsType(action.kind));
}
