import { getBigQueryClient, checkAuthentication, handleBigQueryError } from './bigqueryClient';
import { costInPoundsForOneGb } from './constants';
import { BigQueryDryRunResponse } from './types';

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

export async function queryDryRun(query: string) : Promise<BigQueryDryRunResponse> {
    if (query === "" || !query) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: "0 GB" },
            error: { hasError: false, message: "" }
        };
    }

    await checkAuthentication();

    const bigqueryClient = getBigQueryClient();
    if (!bigqueryClient) {
        return {
            schema: undefined,
            location: undefined,
            statistics: { totalBytesProcessed: "" },
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

    try {
        const [job] = await bigqueryClient.createQueryJob({
            query,
            dryRun: true
        });

        const parsedTotalBytesProcessed = Number(parseFloat(job.metadata.statistics.totalBytesProcessed));
        const costInPounds = Number((parsedTotalBytesProcessed) / 10 ** 9) * costInPoundsForOneGb;

        return {
            schema: job.metadata.statistics.query.schema,
            location: job.metadata.jobReference.location,
            statistics: {
                totalBytesProcessed: (parsedTotalBytesProcessed/ 10 ** 9).toFixed(3) + " GB",
                costInPounds: costInPounds,
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
                statistics: { totalBytesProcessed: "" },
                error: { hasError: true, message: finalError.message, location: errorLocation }
            };
        }
    }
}