import * as vscode from 'vscode';
import { getBigQueryClient, checkAuthentication, handleBigQueryError } from './bigqueryClient';
import { bigQueryDryRunCostOneGiBByCurrency } from './constants';
import { formatTimestamp } from './utils';
import { BigQueryDryRunResponse, LastModifiedTimeMeta, SupportedCurrency, Target } from './types';
import { perfCount } from './perf';

export function getLineAndColumnNumberFromErrorMessage(errorMessage: string) {
    //e.g. error 'Unrecognized name: SSY_LOC_ID; Did you mean ASSY_LOC_ID? at [65:7]'
    let lineAndColumn = errorMessage.match(/\[(\d+):(\d+)\]/);
    if (lineAndColumn) {
        return {
            line: parseInt(lineAndColumn[1]),
            column: parseInt(lineAndColumn[2])
        };
    }
    return {
        line: 0,
        column: 0
    };
}

/**
 * At most this many dry runs in flight, shared by every caller, so a JS file that generates many actions or a
 * cost estimate of a whole tag cannot flood the BigQuery API. A finished dry run hands its slot to the next.
 */
export const DRY_RUN_CONCURRENCY = 16;
let dryRunsInFlight = 0;
const dryRunQueue: (() => void)[] = [];

export async function withDryRunSlot<T>(run: () => Promise<T>): Promise<T> {
    if (dryRunsInFlight < DRY_RUN_CONCURRENCY) {
        dryRunsInFlight++;
    } else {
        await new Promise<void>((resolve) => dryRunQueue.push(resolve));
    }
    try {
        return await run();
    } finally {
        const next = dryRunQueue.shift();
        if (next) {
            next();
        } else {
            dryRunsInFlight--;
        }
    }
}

export async function queryDryRun(query: string, alreadyRetried: boolean = false): Promise<BigQueryDryRunResponse> {
    if (query === "" || !query) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: 0 },
            error: { hasError: false, message: "" }
        };
    }

    perfCount('bq.dryRun');
    const errorMessage = await checkAuthentication();

    const bigqueryClient = getBigQueryClient();
    if (!bigqueryClient) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: 0 },
            error: { hasError: true, message: errorMessage || "Error creating BigQuery client" }
        };
    }

    // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
    /*
    const options = {
        query: query,
        Location must match that of the dataset(s) referenced in the query.
        location: '',
        dryRun: true,
    };
    */

    let currencyFoDryRunCost: SupportedCurrency | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('currencyFoDryRunCost');
    if (!currencyFoDryRunCost) {
        currencyFoDryRunCost = "USD" as SupportedCurrency;
    }
    try {
        const [job] = await withDryRunSlot(() => bigqueryClient.createQueryJob({
            query,
            dryRun: true
        }));

        const totalBytesProcessedAccuracy = job.metadata.statistics.query?.totalBytesProcessedAccuracy;
        const rawBytesProcessed = parseFloat(job.metadata.statistics.totalBytesProcessed);
        const totalBytesProcessed = Number.isFinite(rawBytesProcessed) ? rawBytesProcessed : 0;
        // When BigQuery cannot compute bytes statically it reports accuracy UNKNOWN and 0 bytes,
        // even though the query will scan real data when executed. Flag it so consumers do not
        // present the 0 as a genuine estimate.
        const bytesEstimateUnknown = totalBytesProcessedAccuracy === 'UNKNOWN';
        // 1024 bytes ** 3 = 1GiB
        const cost = Number((totalBytesProcessed) / (1024 ** 3)) * bigQueryDryRunCostOneGiBByCurrency[currencyFoDryRunCost];

        return {
            schema: job.metadata.statistics.query.schema,
            location: job.metadata.jobReference.location,
            statistics: {
                totalBytesProcessed: totalBytesProcessed,
                cost: {
                    currency: currencyFoDryRunCost,
                    value: cost
                },
                statementType: job.metadata.statistics.query.statementType,
                totalBytesProcessedAccuracy: totalBytesProcessedAccuracy,
                bytesEstimateUnknown: bytesEstimateUnknown
            },
            error: { hasError: false, message: "" }
        };
    } catch (error: any) {
        try {
            await handleBigQueryError(error, alreadyRetried);
            return await queryDryRun(query, true);
        } catch (finalError: any) {
            const errorLocation = getLineAndColumnNumberFromErrorMessage(finalError.message);
            return {
                schema: undefined,
                location: undefined,
                statistics: {
                    totalBytesProcessed: 0,
                    cost: {
                        currency: currencyFoDryRunCost,
                        value: 0
                    }
                },
                error: { hasError: true, message: finalError.message, location: errorLocation }
            };
        }
    }
}

function isModelWasUpdatedToday(lastModifiedTime:Date) {
    const today = new Date();
    return lastModifiedTime.toDateString() === today.toDateString();
}


export async function getModelLastModifiedTime(targetTablesOrViews: Target[]): Promise<LastModifiedTimeMeta | undefined> {
    const bigqueryClient = getBigQueryClient();
    if (!bigqueryClient) {
        return undefined;
    }
    // In parallel, in the order of the targets
    const lastModifiedTimeMeta: LastModifiedTimeMeta = await Promise.all(targetTablesOrViews.map(async (targetTableOrView) => {
        const projectId = targetTableOrView.database;
        const datasetId = targetTableOrView.schema;
        const tableId = targetTableOrView.name;

        try {
            perfCount('bq.tableGet');
            const [table] = await bigqueryClient.dataset(datasetId, { projectId }).table(tableId).get();
            let lastModifiedTime = table?.metadata?.lastModifiedTime;
            lastModifiedTime = new Date(parseInt(lastModifiedTime));
            return {
                lastModifiedTime: formatTimestamp(lastModifiedTime),
                modelWasUpdatedToday: isModelWasUpdatedToday(lastModifiedTime),
                error: { message: undefined }
            };
        } catch (error: any) {
            return {
                lastModifiedTime: undefined,
                modelWasUpdatedToday: undefined,
                error: {
                    message: `Could not retrieve lastModifiedTime for ${projectId}.${datasetId}.${tableId}`
                }
            };
        }
    }));
    return lastModifiedTimeMeta;
}

