import * as vscode from 'vscode';
import { queryDryRun } from '../bigqueryDryRun';
import { setDiagnostics } from '../setDiagnostics';
import { getMetadataForSqlxFileBlocks } from '../sqlxFileParser';
import { logger } from '../logger';
import { assertionQueryOffset, tableQueryOffset, incrementalTableOffset } from '../constants';
import { calculateIncrementalPreOpsOffset } from '../offsetCalculations';
import { getDependenciesAutoCompletionItems, getDataformTags } from './queryMetadata';
import { getCurrentFileMetadata } from './dataformHelpers';
import { TablesWtFullQuery, SqlxBlockMetadata, BigQueryDryRunResponse } from '../types';

export function handleSemicolonPrePostOps(fileMetadata: TablesWtFullQuery) {
    const preOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.preOpsQuery);
    const icrementalPreOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.incrementalPreOpsQuery);
    const postOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.postOpsQuery);

    if (!preOpsEndsWithSemicolon && fileMetadata.queryMeta.preOpsQuery !== "") {
        fileMetadata.queryMeta.preOpsQuery = fileMetadata.queryMeta.preOpsQuery.trimEnd() + ";" + "\n";
    }

    if (!icrementalPreOpsEndsWithSemicolon && fileMetadata.queryMeta.incrementalPreOpsQuery !== "") {
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

function replaceQueryLabelWtEmptyStringForDryRun(query: string) {
    return query.replace(/SET\s+@@query_label\s*=\s*(['"]).*?\1\s*;/gi, '');
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

    if (type === "incremental") {
        let incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimStart();
        if (skipPreOpsInDryRun) {
            incrementalPreOpsQuery = "";
        } else if (incrementalPreOpsQuery) {
            incrementalPreOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(incrementalPreOpsQuery);
        }

    }

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
        Promise.all((fileMetadata.queryMeta.assertionQueries ?? []).map((aq: any) => queryDryRun(aq.query))),
        Promise.all((fileMetadata.queryMeta.tableQueries ?? []).map((tq: any) => queryDryRun(withPreOps(tq.preOpsQuery, tq.query)))),
        Promise.all((fileMetadata.queryMeta.incrementalQueries ?? []).map((iq: any) => queryDryRun(withPreOps(iq.preOpsQuery, iq.nonIncrementalQuery)))),
        Promise.all((fileMetadata.queryMeta.incrementalQueries ?? []).map((iq: any) => queryDryRun(withPreOps(iq.incrementalPreOpsQuery, iq.incrementalQuery)))),
        Promise.all((fileMetadata.queryMeta.operationQueries ?? []).map((oq: any) => queryDryRun(withPreOps(oq.preOpsQuery, oq.query)))),
        Promise.all((fileMetadata.queryMeta.testQueries ?? []).map((tq: any) => tq.testQuery ? queryDryRun(tq.testQuery) : Promise.resolve(emptyDryRunResponse))),
        Promise.all((fileMetadata.queryMeta.testQueries ?? []).map((tq: any) => tq.expectedOutputQuery ? queryDryRun(tq.expectedOutputQuery) : Promise.resolve(emptyDryRunResponse))),
    ]);

    const [preOpsDryRunResult, postOpsDryRunResult, testDryRunResult, expectedOutputDryRunResult] = aggregateDryRunResults;

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
            if (type === "incremental" && !skipPreOpsInDryRun) {
                const iq = fileMetadata.queryMeta.incrementalQueries[0];
                compiledPreOpsLineCount = calculateIncrementalPreOpsOffset(
                    iq?.incrementalPreOpsQuery,
                    iq?.incrementalQuery,
                    offSet
                );
            }

            setDiagnostics(document, errorMeta, diagnosticCollection, sqlxBlockMetadata, offSet, compiledPreOpsLineCount);
        }
        return { mainQuery: dryRunResult, preOps: preOpsDryRunResult, postOps: postOpsDryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults};
    }

    if (!showCompiledQueryInVerticalSplitOnSave) {
        let combinedTableIds = "";
        curFileMeta.fileMetadata.tables.forEach((table: { target: import('../types').Target }) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics?.totalBytesProcessed || 0} - ${combinedTableIds}`);
    }
    return { mainQuery: dryRunResult, preOps: preOpsDryRunResult, postOps: postOpsDryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults};
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

    dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
}
