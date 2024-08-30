import { BigQuery } from '@google-cloud/bigquery';
const bigquery = new BigQuery();
import {  BigQueryDryRunResponse } from './types';

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

export async function queryDryRun(query: string) {

    if (query === "" || !query){
        let dryRunResponse: BigQueryDryRunResponse = {
            statistics: {
                totalBytesProcessed: "0 GB",
            },
            error: {
                hasError: false,
                message: ""
            }
        };
        return dryRunResponse;
    }

    // For all options, see https://cloud.google.com/bigquery/docs/reference/rest/v2/jobs/query
    const options = {
        query: query,
        // Location must match that of the dataset(s) referenced in the query.
        //location: '',
        dryRun: true,
    };

    try {
        const [job] = await bigquery.createQueryJob(options);
        let dryRunResponse: BigQueryDryRunResponse = {
            statistics: {
                totalBytesProcessed: (parseFloat(job.metadata.statistics.totalBytesProcessed) / 10 ** 9).toFixed(3) + " GB",
            },
            error: {
                hasError: false,
                message: ""
            }
        };
        return dryRunResponse;
    } catch (error: any) {
        let errorLocation  = getLineAndColumnNumberFromErrorMessage(error.message);
        let dryRunResponse: BigQueryDryRunResponse = {
            statistics: {
                totalBytesProcessed: "",
            },
            error: {
                hasError: true,
                message: error.message,
                location: errorLocation
            }
        };
        return dryRunResponse;
    }
}
