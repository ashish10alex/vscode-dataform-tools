import * as vscode from 'vscode';
import { compiledGraph, compiledJson } from '../project';
import { queryDryRun } from '../bigqueryDryRun';
import { getMetadataForSqlxFileBlocks } from '../sqlxFileParser';
import { logger } from '../logger';
import { RunDryRun, ScriptDryRun, dryRunScriptsOf, toDryRunResult } from '../bigquery/dryRunService';
import { sqlxDiagnostics } from '../bigquery/sqlxDiagnostics';
import { applyDeferralToAction } from '../defer/deferRules';
import { Action, actionsInFile, madeUpTarget, slashPath, targetId } from '../shared/compiledGraph';
import { getDependenciesAutoCompletionItems, getDataformTags } from './queryMetadata';
import { getCurrentFileMetadata } from './dataformHelpers';
import { handleAccessDenied } from '../defer';
import { forgetDryRunSchema, recordDryRunSchema } from '../columnLineage/impactReport';
import { TablesWtFullQuery, SqlxBlockMetadata, BigQueryDryRunResponse, DryRunAnnotation } from '../types';
import type { AssertionQueryEntry, TableQueryEntry, IncrementalQueryEntry, OperationQueryEntry, TestQueryEntry } from '../types';
import { extensionConfiguration } from '../project/settings';

export function handleSemicolonPrePostOps(fileMetadata: TablesWtFullQuery) {
    const preOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.preOpsQuery);
    const incrementalPreOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.incrementalPreOpsQuery);
    const postOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.postOpsQuery);

    if (!preOpsEndsWithSemicolon && fileMetadata.queryMeta.preOpsQuery !== "") {
        fileMetadata.queryMeta.preOpsQuery = fileMetadata.queryMeta.preOpsQuery.trimEnd() + ";" + "\n";
    }

    if (!incrementalPreOpsEndsWithSemicolon && fileMetadata.queryMeta.incrementalPreOpsQuery !== "") {
        fileMetadata.queryMeta.incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimEnd() + ";" + "\n";
    }

    if (!postOpsEndsWithSemicolon && fileMetadata.queryMeta.postOpsQuery !== "") {
        fileMetadata.queryMeta.postOpsQuery = fileMetadata.queryMeta.postOpsQuery.trimEnd() + ";" + "\n";
    }
    return fileMetadata;
}

export async function gatherQueryAutoCompletionMeta() {
    const compiled = compiledJson();
    if (!compiled) {
        logger.debug('No cached compilation available for autocompletion');
        return;
    }
    logger.debug('Using cached compilation for autocompletion metadata');
    // all 2 of these together take approx less than 0.35ms (Dataform repository with 285 nodes)
    let [declarationsAndTargets, dataformTags] = await Promise.all([
        getDependenciesAutoCompletionItems(compiled),
        getDataformTags(compiled),
    ]);
    return {
        declarationsAndTargets: declarationsAndTargets, dataformTags: dataformTags
    };

}



/** A Dataform action as it is dry-run with `skipPreOpsInDryRun` on: without its pre-operations, and so without the dry run of its post-operations, which needs them */
export function withoutPreOperations(action: Action): Action {
    const isPreOperations = (title: string) => /^(incremental )?pre_operations/.test(title);
    if (!action.sections.some((section) => isPreOperations(section.title))) {
        return action;
    }
    return {
        ...action,
        sections: action.sections
            .filter((section) => !isPreOperations(section.title))
            .map((section) => ({ ...section, dryRun: section.dryRun.filter((script) => script !== 'post_operations') })),
    };
}

const emptyDryRunResponse = (): BigQueryDryRunResponse => ({ error: { hasError: false, message: "" } } as BigQueryDryRunResponse);

/**
 * Dry-runs the actions of the current file and marks their errors in a `.sqlx` file.
 *
 * The dry runs are those of the actions' SQL sections (src/bigquery/dryRunService.ts), after defer's rewrite. The
 * panel is still sent BigQuery's answers in the shape it has always had, so they are handed back that way here, lined
 * up with the entries of `queryMeta`.
 *
 * @param run Asks BigQuery for one dry run. Tests pass their own
 */
export async function dryRunAndShowDiagnostics(curFileMeta: any, document: vscode.TextDocument, diagnosticCollection: any, showCompiledQueryInVerticalSplitOnSave: boolean | undefined, run: RunDryRun = (sql) => queryDryRun(sql)) {
    let sqlxBlockMetadata: SqlxBlockMetadata | undefined = undefined;
    //NOTE: Currently inline diagnostics are only supported for .sqlx files
    if (curFileMeta.pathMeta.extension === "sqlx") {
        sqlxBlockMetadata = getMetadataForSqlxFileBlocks(document); //Takes less than 2ms (Dataform with 285 nodes)
    }

    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = extensionConfiguration().get('showCompiledQueryInVerticalSplitOnSave');
    }

    const type = curFileMeta.fileMetadata.queryMeta.type;
    const fileMetadata = curFileMeta.fileMetadata;

    const skipPreOpsInDryRun = extensionConfiguration().get('skipPreOpsInDryRun');
    logger.debug(`skipPreOpsInDryRun: ${skipPreOpsInDryRun}`);

    // The file's actions as they are dry-run: reading Deferred Actions from prod, and without pre-operations when
    // those are to be skipped
    const graph = compiledGraph();
    const deferralEntries = curFileMeta.deferral?.entries ?? [];
    const fileActions = (graph ? actionsInFile(graph, slashPath(curFileMeta.pathMeta.relativeFilePath)) : [])
        .map((action) => applyDeferralToAction(action, deferralEntries))
        .map((action) => (skipPreOpsInDryRun ? withoutPreOperations(action) : action));

    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    const dryRuns: ScriptDryRun[] = (await Promise.all(fileActions.map((action) => dryRunScriptsOf(action, run)))).flat();
    const find = (actionId: string, script: string, incremental = false) =>
        dryRuns.find((dryRun) => dryRun.action.id === actionId && dryRun.script.name === script && dryRun.script.incremental === incremental);
    const responseOf = (dryRun: ScriptDryRun | undefined) => dryRun?.response ?? emptyDryRunResponse();

    const assertionQueries: AssertionQueryEntry[] = fileMetadata.queryMeta.assertionQueries ?? [];
    const tableQueries: TableQueryEntry[] = fileMetadata.queryMeta.tableQueries ?? [];
    const incrementalQueries: IncrementalQueryEntry[] = fileMetadata.queryMeta.incrementalQueries ?? [];
    const operationQueries: OperationQueryEntry[] = fileMetadata.queryMeta.operationQueries ?? [];
    const testQueries: TestQueryEntry[] = fileMetadata.queryMeta.testQueries ?? [];

    // Each entry of queryMeta is named by its action's ID, a unit test by its name
    const unitTestId = (name: string) => targetId(madeUpTarget('unit test', name));
    const perAssertionDryRunResults = assertionQueries.map((aq) => responseOf(find(aq.targetName, 'query')));
    const perTableDryRunResults = tableQueries.map((tq) => responseOf(find(tq.targetName, 'query')));
    const perNonIncrementalDryRunResults = incrementalQueries.map((iq) => responseOf(find(iq.targetName, 'query')));
    const perIncrementalDryRunResults = incrementalQueries.map((iq) => responseOf(find(iq.targetName, 'query', true)));
    const perOperationDryRunResults = operationQueries.map((oq) => responseOf(find(oq.targetName, 'operation')));
    const perTestDryRunResults = testQueries.map((tq) => responseOf(find(unitTestId(tq.name), 'test query')));
    const perExpectedOutputDryRunResults = testQueries.map((tq) => responseOf(find(unitTestId(tq.name), 'expected output')));

    // A deferred query denied access to a prod table: those tables fall back to dev on the next read of the metadata
    const accessDeniedTargets = handleAccessDenied(curFileMeta.deferral, dryRuns.map(({ response }) => response?.error?.hasError ? response.error.message : undefined));

    // Enrich each query entry with the result of its dry run so callers
    // can access query + error as one cohesive object instead of separate maps.
    const toAnnotation = (r: BigQueryDryRunResponse): DryRunAnnotation | undefined =>
        r?.error?.hasError ? { message: r.error.message, location: r.error.location } : undefined;

    assertionQueries.forEach((aq: AssertionQueryEntry, i: number) => {
        aq.dryRunQuery = find(aq.targetName, 'query')?.script.sql ?? aq.query;
        aq.error = toAnnotation(perAssertionDryRunResults[i]);
    });
    tableQueries.forEach((tq: TableQueryEntry, i: number) => {
        tq.dryRunQuery = find(tq.targetName, 'query')?.script.sql ?? tq.query;
        tq.error = toAnnotation(perTableDryRunResults[i]);
    });
    incrementalQueries.forEach((iq: IncrementalQueryEntry, i: number) => {
        iq.dryRunNonIncrementalQuery = find(iq.targetName, 'query')?.script.sql ?? iq.nonIncrementalQuery;
        iq.dryRunIncrementalQuery = find(iq.targetName, 'query', true)?.script.sql ?? iq.incrementalQuery;
        iq.nonIncrementalError = toAnnotation(perNonIncrementalDryRunResults[i]);
        iq.incrementalError = toAnnotation(perIncrementalDryRunResults[i]);
    });
    operationQueries.forEach((oq: OperationQueryEntry, i: number) => {
        oq.dryRunQuery = find(oq.targetName, 'operation')?.script.sql ?? oq.query;
        oq.error = toAnnotation(perOperationDryRunResults[i]);
    });
    testQueries.forEach((tq: TestQueryEntry, i: number) => {
        tq.testError = toAnnotation(perTestDryRunResults[i]);
        tq.expectedOutputError = toAnnotation(perExpectedOutputDryRunResults[i]);
    });

    const dryRunResult = perTableDryRunResults[0] ?? perAssertionDryRunResults[0] ?? perOperationDryRunResults[0] ?? perIncrementalDryRunResults[0] ?? emptyDryRunResponse();
    const incrementalDryRunResult = perIncrementalDryRunResults[0] ?? emptyDryRunResponse();
    const nonIncrementalDryRunResult = perNonIncrementalDryRunResults[0] ?? emptyDryRunResponse();
    const assertionDryRunResult = perAssertionDryRunResults[0] ?? emptyDryRunResponse();
    const testDryRunResult = perTestDryRunResults[0] ?? emptyDryRunResponse();
    const expectedOutputDryRunResult = perExpectedOutputDryRunResults[0] ?? emptyDryRunResponse();

    if (dryRunResult.schema || nonIncrementalDryRunResult.schema) {
        compiledQuerySchema = type === "incremental" ? nonIncrementalDryRunResult.schema : dryRunResult.schema;
    } else if (dryRunResult.schema === undefined && dryRunResult.error.hasError === false) {
        // happens when Dataform config type is operation and dry run api response has no schema
        compiledQuerySchema = {
            fields: [
                {
                    name: "",
                    type: "",
                }
            ]
        };
    }

    // Kept for the on-demand column impact check, so it can compare with prod without another dry run. Only for a
    // file that defines one table, view or incremental table, whatever else (e.g. assertions in a .js file) it has;
    // an incremental table's schema comes from its non-incremental query.
    const impactResult = tableQueries.length + incrementalQueries.length !== 1 ? undefined
        : tableQueries.length ? perTableDryRunResults[0] : perNonIncrementalDryRunResults[0];
    if (!impactResult || impactResult.error.hasError || !impactResult.schema) {
        forgetDryRunSchema(document, curFileMeta);
    } else {
        recordDryRunSchema(document, curFileMeta, impactResult.schema);
    }

    const results = { mainQuery: dryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults, accessDeniedTargets, dryRuns };

    if (dryRuns.some(({ response }) => response?.error?.hasError)) {
        if (sqlxBlockMetadata) {
            // Each error is placed within its section of the compiled SQL, and from there in the block of the file
            const sectionResults = dryRuns.map(({ action, script, response }) => toDryRunResult(action, script, 0, response));
            const severity = vscode.DiagnosticSeverity.Error;
            const diagnostics = sqlxDiagnostics(fileActions, sectionResults, sqlxBlockMetadata).map(({ line, column, message }) =>
                new vscode.Diagnostic(new vscode.Range(new vscode.Position(line, column), new vscode.Position(line, column + 5)), message, severity));
            diagnosticCollection.set(document.uri, diagnostics);
        }
        return results;
    }

    if (!showCompiledQueryInVerticalSplitOnSave) {
        let combinedTableIds = "";
        curFileMeta.fileMetadata.tables.forEach((table: { target: import('../types').Target }) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        // 0 bytes with UNKNOWN accuracy is not an estimate, so say so rather than reporting 0
        const bytesProcessedSummary = dryRunResult.statistics?.bytesEstimateUnknown
            ? "could not be estimated by BigQuery"
            : `${dryRunResult.statistics?.totalBytesProcessed || 0}`;
        vscode.window.showInformationMessage(`GB: ${bytesProcessedSummary} - ${combinedTableIds}`);
    }
    return results;
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, showCompiledQueryInVerticalSplitOnSave: boolean) {
    diagnosticCollection.clear();

    let curFileMeta = await getCurrentFileMetadata(true);

    if (!compiledJson() || !curFileMeta) {
        return;
    }

    let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
    if (!queryAutoCompMeta) {
        return;
    }

    dataformTags = queryAutoCompMeta.dataformTags;
    declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

    const { accessDeniedTargets } = await dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);
    if (accessDeniedTargets.length > 0) {
        // Read again so the unreadable prod tables keep their dev refs
        diagnosticCollection.clear();
        curFileMeta = await getCurrentFileMetadata(false);
        if (curFileMeta?.fileMetadata) {
            await dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);
        }
    }

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
}
