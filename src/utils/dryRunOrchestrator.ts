import * as vscode from 'vscode';
import { queryDryRun } from '../bigqueryDryRun';
import { setDiagnostics } from '../setDiagnostics';
import { getMetadataForSqlxFileBlocks } from '../sqlxFileParser';
import { logger } from '../logger';
import { assertionQueryOffset, tableQueryOffset, incrementalTableOffset } from '../constants';
import { calculateIncrementalPreOpsOffset, calculateIncrementalSkipPreOpsOffset } from '../offsetCalculations';
import { getDependenciesAutoCompletionItems, getDataformTags } from './queryMetadata';
import { getCurrentFileMetadata } from './dataformHelpers';
import { TablesWtFullQuery, SqlxBlockMetadata, BigQueryDryRunResponse, DryRunAnnotation } from '../types';
import type { AssertionQueryEntry, TableQueryEntry, IncrementalQueryEntry, OperationQueryEntry, TestQueryEntry } from '../types';

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
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        logger.debug('No cached compilation available for autocompletion');
        return;
    }
    logger.debug('Using cached compilation for autocompletion metadata');
    // all 2 of these together take approx less than 0.35ms (Dataform repository with 285 nodes)
    let [declarationsAndTargets, dataformTags] = await Promise.all([
        getDependenciesAutoCompletionItems(CACHED_COMPILED_DATAFORM_JSON),
        getDataformTags(CACHED_COMPILED_DATAFORM_JSON),
    ]);
    return {
        declarationsAndTargets: declarationsAndTargets, dataformTags: dataformTags
    };

}



export async function dryRunAndShowDiagnostics(curFileMeta: any, document: vscode.TextDocument, diagnosticCollection: any, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
    let sqlxBlockMetadata: SqlxBlockMetadata | undefined = undefined;
    //NOTE: Currently inline diagnostics are only supported for .sqlx files
    if (curFileMeta.pathMeta.extension === "sqlx") {
        sqlxBlockMetadata = getMetadataForSqlxFileBlocks(document); //Takes less than 2ms (Dataform with 285 nodes)
    }

    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
    }

    const type = curFileMeta.fileMetadata.queryMeta.type;
    const fileMetadata = curFileMeta.fileMetadata;

    let isJsWithTests = type === "js" && fileMetadata.tables.some((table: any) => {
        return table.type === "test";
    });

    const skipPreOpsInDryRun = vscode.workspace.getConfiguration('vscode-dataform-tools').get('skipPreOpsInDryRun');
    logger.debug(`skipPreOpsInDryRun: ${skipPreOpsInDryRun}`);



    const withPreOps = (preOpsQuery: string, query: string) => {
        if (skipPreOpsInDryRun || !preOpsQuery) { return query; }
        const p = /;\s*$/.test(preOpsQuery) ? preOpsQuery : preOpsQuery + ";";
        return p + "\n" + query;
    };

    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    // Per-node dry runs run in parallel with the aggregate dry runs to avoid duplication
    const emptyDryRunResponse: BigQueryDryRunResponse = { error: { hasError: false, message: "" } } as BigQueryDryRunResponse;
    const shouldSkipAggregatePreOps = !!skipPreOpsInDryRun && !!fileMetadata.queryMeta.preOpsQuery?.trim();

    const [aggregateDryRunResults, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults] = await Promise.all([
        Promise.all([
            //TODO: If pre_operations block has an error the diagnostics wont be placed at correct place in main query block
            shouldSkipAggregatePreOps ? Promise.resolve(emptyDryRunResponse) : queryDryRun(fileMetadata.queryMeta.preOpsQuery),
            // To enable to use of variables declared in preOps.
            // Would result in incorrect cost for post operation though a tradeoff Im willing to have atm
            // See https://github.com/ashish10alex/vscode-dataform-tools/issues/175
            (fileMetadata.queryMeta.postOpsQuery && fileMetadata.queryMeta.postOpsQuery !== "")
                ? (shouldSkipAggregatePreOps ? Promise.resolve(emptyDryRunResponse) : queryDryRun(fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.postOpsQuery))
                : Promise.resolve(emptyDryRunResponse),
            ((type === "test" || isJsWithTests) && fileMetadata.queryMeta.testQuery) ? queryDryRun(fileMetadata.queryMeta.testQuery) : Promise.resolve(emptyDryRunResponse),
            ((type === "test" || isJsWithTests) && fileMetadata.queryMeta.expectedOutputQuery) ? queryDryRun(fileMetadata.queryMeta.expectedOutputQuery) : Promise.resolve(emptyDryRunResponse),
        ]),
        Promise.all((fileMetadata.queryMeta.assertionQueries ?? []).map((aq: AssertionQueryEntry) => queryDryRun(aq.query))),
        Promise.all((fileMetadata.queryMeta.tableQueries ?? []).map((tq: TableQueryEntry) => queryDryRun(withPreOps(tq.preOpsQuery, tq.query)))),
        Promise.all((fileMetadata.queryMeta.incrementalQueries ?? []).map((iq: IncrementalQueryEntry) => queryDryRun(withPreOps(iq.preOpsQuery, iq.nonIncrementalQuery)))),
        Promise.all((fileMetadata.queryMeta.incrementalQueries ?? []).map((iq: IncrementalQueryEntry) => queryDryRun(withPreOps(iq.incrementalPreOpsQuery, iq.incrementalQuery)))),
        Promise.all((fileMetadata.queryMeta.operationQueries ?? []).map((oq: OperationQueryEntry) => queryDryRun(withPreOps(oq.preOpsQuery, oq.query)))),
        Promise.all((fileMetadata.queryMeta.testQueries ?? []).map((tq: TestQueryEntry) => tq.testQuery ? queryDryRun(tq.testQuery) : Promise.resolve(emptyDryRunResponse))),
        Promise.all((fileMetadata.queryMeta.testQueries ?? []).map((tq: TestQueryEntry) => tq.expectedOutputQuery ? queryDryRun(tq.expectedOutputQuery) : Promise.resolve(emptyDryRunResponse))),
    ]);

    const [preOpsDryRunResult, postOpsDryRunResult, testDryRunResult, expectedOutputDryRunResult] = aggregateDryRunResults;

    // Enrich each query entry with the result of its dry run so callers
    // can access query + error as one cohesive object instead of separate maps.
    const toAnnotation = (r: BigQueryDryRunResponse): DryRunAnnotation | undefined =>
        r?.error?.hasError ? { message: r.error.message, location: r.error.location } : undefined;

    (fileMetadata.queryMeta.assertionQueries ?? []).forEach((aq: AssertionQueryEntry, i: number) => {
        aq.dryRunQuery = aq.query;
        aq.error = toAnnotation(perAssertionDryRunResults[i]);
    });
    (fileMetadata.queryMeta.tableQueries ?? []).forEach((tq: TableQueryEntry, i: number) => {
        tq.dryRunQuery = withPreOps(tq.preOpsQuery, tq.query);
        tq.error = toAnnotation(perTableDryRunResults[i]);
    });
    (fileMetadata.queryMeta.incrementalQueries ?? []).forEach((iq: IncrementalQueryEntry, i: number) => {
        iq.dryRunNonIncrementalQuery = withPreOps(iq.preOpsQuery, iq.nonIncrementalQuery);
        iq.dryRunIncrementalQuery = withPreOps(iq.incrementalPreOpsQuery, iq.incrementalQuery);
        iq.nonIncrementalError = toAnnotation(perNonIncrementalDryRunResults[i]);
        iq.incrementalError = toAnnotation(perIncrementalDryRunResults[i]);
    });
    (fileMetadata.queryMeta.operationQueries ?? []).forEach((oq: OperationQueryEntry, i: number) => {
        oq.dryRunQuery = withPreOps(oq.preOpsQuery, oq.query);
        oq.error = toAnnotation(perOperationDryRunResults[i]);
    });
    (fileMetadata.queryMeta.testQueries ?? []).forEach((tq: TestQueryEntry, i: number) => {
        tq.testError = toAnnotation(perTestDryRunResults[i]);
        tq.expectedOutputError = toAnnotation(perExpectedOutputDryRunResults[i]);
    });

    // Derive results from per-node arrays instead of running separate aggregate queries
    const dryRunResult = perTableDryRunResults[0] ?? perAssertionDryRunResults[0] ?? perOperationDryRunResults[0] ?? perIncrementalDryRunResults[0] ?? emptyDryRunResponse;
    const incrementalDryRunResult = perIncrementalDryRunResults[0] ?? emptyDryRunResponse;
    const nonIncrementalDryRunResult = perNonIncrementalDryRunResults[0] ?? emptyDryRunResponse;
    const assertionDryRunResult = perAssertionDryRunResults[0] ?? emptyDryRunResponse;

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

    // check if we need to handle errors from non incremental query here
    if (dryRunResult.error.hasError || preOpsDryRunResult.error.hasError || postOpsDryRunResult.error.hasError || incrementalDryRunResult.error.hasError || assertionDryRunResult.error.hasError || testDryRunResult.error.hasError || expectedOutputDryRunResult.error.hasError) {
        if (!sqlxBlockMetadata && curFileMeta.pathMeta.extension === ".sqlx") {
            vscode.window.showErrorMessage("Could not parse sqlx file");
        }

        let offSet = 0;
        if (type === "table" || type === "view") {
            offSet = tableQueryOffset;
        } else if (type === "assertion") {
            offSet = assertionQueryOffset;
        } else if (type === "incremental") {
            offSet = incrementalTableOffset;
        }

        if (sqlxBlockMetadata) {
            if (type === "incremental") {
                // check if we need to handle errors from non incremental query here
                dryRunResult.error = incrementalDryRunResult.error;
            }
            let errorMeta = {
                mainQueryError: dryRunResult.error,
                preOpsError: preOpsDryRunResult.error,
                postOpsError: postOpsDryRunResult.error,
                nonIncrementalError: nonIncrementalDryRunResult.error,
                incrementalError: incrementalDryRunResult.error,
                assertionError: assertionDryRunResult.error,
                testError: testDryRunResult.error,
                expectedOutputError: expectedOutputDryRunResult.error,
            };

            let compiledPreOpsLineCount: number | undefined = undefined;
            if (type === "incremental") {
                const iq = fileMetadata.queryMeta.incrementalQueries[0];
                if (!skipPreOpsInDryRun) {
                    compiledPreOpsLineCount = calculateIncrementalPreOpsOffset(
                        iq?.incrementalPreOpsQuery,
                        iq?.incrementalQuery,
                        offSet
                    );
                } else {
                    // When pre_ops are skipped, only iq.incrementalQuery is sent to BigQuery.
                    // Compute compiledPreOpsLineCount from the preamble of incrementalQuery alone.
                    compiledPreOpsLineCount = calculateIncrementalSkipPreOpsOffset(iq?.incrementalQuery);
                }
            }

            // When skipPreOpsInDryRun is true for table/view types, only tq.query is sent to BigQuery
            // (no pre_ops). preOpsSkippedInDryRun=true tells setDiagnostics to keep preOpsOffset=0
            // so the diagnostic maps correctly to the main SQL block.
            // For incremental, the offset is computed via compiledPreOpsLineCount above instead.
            const preOpsSkippedInDryRun = shouldSkipAggregatePreOps && (type === "table" || type === "view");
            setDiagnostics(document, errorMeta, diagnosticCollection, sqlxBlockMetadata, offSet, compiledPreOpsLineCount, preOpsSkippedInDryRun);
        }
        return { mainQuery: dryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults };
    }

    if (!showCompiledQueryInVerticalSplitOnSave) {
        let combinedTableIds = "";
        curFileMeta.fileMetadata.tables.forEach((table: { target: import('../types').Target }) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics?.totalBytesProcessed || 0} - ${combinedTableIds}`);
    }
    return { mainQuery: dryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults };
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, showCompiledQueryInVerticalSplitOnSave: boolean) {
    diagnosticCollection.clear();

    let curFileMeta = await getCurrentFileMetadata(true);

    if (!CACHED_COMPILED_DATAFORM_JSON || !curFileMeta) {
        return;
    }

    let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
    if (!queryAutoCompMeta) {
        return;
    }

    dataformTags = queryAutoCompMeta.dataformTags;
    declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

    await dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
}
