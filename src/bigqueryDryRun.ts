import * as vscode from 'vscode';
import { getBigQueryClient, checkAuthentication, handleBigQueryError } from './bigqueryClient';
import { bigQueryDryRunCostOneGbByCurrency } from './constants';
import { BigQueryDryRunResponse, LastModifiedTimeMeta, SupportedCurrency } from './types';
import { error } from 'console';

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

export async function queryDryRun(query: string): Promise<BigQueryDryRunResponse> {
    if (query === "" || !query) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: 0 },
            error: { hasError: false, message: "" }
        };
    }

    await checkAuthentication();

    const bigqueryClient = getBigQueryClient();
    if (!bigqueryClient) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: 0 },
            error: { hasError: true, message: "BigQuery client not available." }
        };
    }

    // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
    const options = {
        query: query,
        // Location must match that of the dataset(s) referenced in the query.
        //location: '',
        dryRun: true,
    };

    let currencyFoDryRunCost: SupportedCurrency | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('currencyFoDryRunCost');
    if (!currencyFoDryRunCost) {
        currencyFoDryRunCost = "USD" as SupportedCurrency;
    }
    try {
        const [job] = await bigqueryClient.createQueryJob({
            query,
            dryRun: true
        });

        const totalBytesProcessed = Number(parseFloat(job.metadata.statistics.totalBytesProcessed));
        const cost = Number((totalBytesProcessed) / 10 ** 9) * bigQueryDryRunCostOneGbByCurrency[currencyFoDryRunCost];

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
                totalBytesProcessedAccuracy: job.metadata.statistics.query.totalBytesProcessedAccuracy
            },
            error: { hasError: false, message: "" }
        };
    } catch (error: any) {
        try {
            await handleBigQueryError(error);
            return await queryDryRun(query);
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


function formatTimestamp(lastModifiedTime:Date) {
    return lastModifiedTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'UTC'
    }) + ' UTC';
}

function isModelWasUpdatedToday(lastModifiedTime:Date) {
    const today = new Date();
    return lastModifiedTime.toDateString() === today.toDateString();
}


export async function getModelLastModifiedTime(projectId: string, datasetId: string, tableId: string): Promise<LastModifiedTimeMeta> {
    const bigqueryClient = getBigQueryClient();
    if (!bigqueryClient) {
        return {
            lastModifiedTime: undefined,
            modelWasUpdatedToday: undefined,
            error: { message: `Could not retrieve lastModifiedTime for ${projectId}.${datasetId}.${tableId}` }
        };
    }

    try {
        const [table] = await bigqueryClient.dataset(datasetId, { projectId }).table(tableId).get();
        let lastModifiedTime = table?.metadata?.lastModifiedTime;
        lastModifiedTime = new Date(parseInt(lastModifiedTime));
        const formattedLastModifiedTime = formatTimestamp(lastModifiedTime);
        const modelWasUpdatedToday = isModelWasUpdatedToday(lastModifiedTime);

        return lastModifiedTime
            ? { lastModifiedTime: formattedLastModifiedTime, modelWasUpdatedToday : modelWasUpdatedToday, error: { message: undefined } }
            : {
                lastModifiedTime: undefined,
                modelWasUpdatedToday: undefined,
                error: {
                    message: `Could not retrieve lastModifiedTime for ${projectId}.${datasetId}.${tableId}`
                }
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
}
