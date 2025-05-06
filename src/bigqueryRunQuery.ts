import * as vscode from 'vscode';
import { getBigQueryClient, checkAuthentication, handleBigQueryError } from './bigqueryClient';
import { QueryResultsOptions } from '@google-cloud/bigquery';
import { bigQuerytimeoutMs } from './constants';
import { formatBytes } from './utils';

let bigQueryJob: any;
let cancelBigQueryJobSignal = false;
// let queryLimit = 100;

function convertArrayToObject(array: any, columnName: string) {
    if (array.length === 0) {
        return [{ [columnName]: null }];
    }
    return array.map((item: any) => ({ [columnName]: item }));
}

// Function to recursively extract values from nested objects and handle Big objects
const extractValue: any = (value: any) => {
    if (typeof value === 'object' && value !== null) {
        if (value.constructor && value.constructor.name === 'Big') {
            return value.toString();
        } else if (Array.isArray(value)) {
            return value.map(extractValue);
        } else {
            return Object.values(value).map(extractValue).join(', ');
        }
    }
    return value;
};

function parseObject(key:any, obj: any, _childrens: any) {
    // Check if obj is an array of primitive values
    if (Array.isArray(obj) && obj.length > 0 && (typeof obj[0] !== 'object' || obj[0] === null)) {
        obj.forEach((value) => {
            _childrens.push({ [key]: value });
        });
        return _childrens;
    }
    
    let _children: any = {};
    Object.entries(obj).forEach(([key, value]: [any, any]) => {
        if (typeof value === 'object' && value !== null) {
            if (value.constructor && value.constructor.name === 'Big') {
                _children[key] = value.toString();
            }
            else if (value.constructor.name === 'Object') {
                let newValues: any = [];
                for (const [key, val] of Object.entries(value)) {
                    if (val && (typeof val === "object" && val !== null)) {
                        const dateValue = (val as any).value;
                        newValues = { ...newValues, [key]: dateValue };
                    } else {
                        newValues = { ...newValues, [key]: val };
                    }
                }
                _childrens.push({ ..._children, ...newValues });

            }
            else if (value.constructor.name === 'Array') {
                // Handle arrays of primitive values directly
                if (value.length > 0 && (typeof value[0] !== 'object' || value[0] === null)) {
                    value.forEach((item: any) => {
                        _childrens.push({ ..._children, [key]: item });
                    });
                } else {
                    let new_children = parseObject(key, value, _childrens);
                    if (new_children.constructor.name === "Array") {
                        new_children.forEach((_: any, idx: any) => {
                            new_children[idx] = transformBigValues(new_children[idx]);
                            new_children[idx] = { ..._children, ...new_children[idx] };
                        });
                    }
                }
            }
            else {
                _childrens = Object.values(value).map(extractValue).join(', ');
            }
        } else {
            _children[key] = value;
        }
    });
    return _childrens;
}


function createTabulatorColumns(data: any) {
    if (!data) {
        return [];
    }

    const columns = new Set<string>();

    // Add top-level properties (excluding '_children')
    Object.keys(data).forEach(key => {
        if (key !== '_children') {
            columns.add(key);
        }
    });

    // Add all properties from all children
    if (data._children && data._children.length > 0) {
        data._children.forEach((child: any) => {
            Object.keys(child).forEach(key => columns.add(key));
        });
    }

    // Convert Set to array of column objects
    return Array.from(columns).map(key => ({
        title: key,
        field: key,
        headerFilter: "input",
        headerFilterLiveFilter: true
    }));
}

function transformBigValues(obj: any) {
    // TODO: Would need to handle more types ?
    for (const key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (value && value.constructor && value.constructor.name === 'Big') {
                obj[key] = value.toString();
            } else if (value && value.constructor && ["Big", "BigQueryDate", "BigQueryDatetime", "BigQueryTime", "BigQueryTimestamp", "BigQueryRange", "BigQueryInt"].includes(value?.constructor?.name)) {
                obj[key] = Object.values(value).map(extractValue).join(', ');
            }
        }
    }
    return obj;
}

export async function runQueryInBigQuery(
    query: string,
    pageToken?: string,
    jobIdForPagination?: string
): Promise<{
    rows: any[] | undefined,
    jobStats: {
        bigQueryJobEndTime: Date | undefined,
        bigQueryJobId: string | undefined,
        jobCostMeta: string | undefined
    } | undefined,
    errorMessage: string | undefined,
    pageToken?: string
}> {
    await checkAuthentication();

    const bigquery = getBigQueryClient();
    if (!bigquery) {
        vscode.window.showErrorMessage('BigQuery client not available. Please check your authentication.');
        return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery client not available. Please check your authentication." };
    }

    if (cancelBigQueryJobSignal && !(pageToken && jobIdForPagination)) {
        vscode.window.showInformationMessage(`BigQuery query execution aborted before job creation/retrieval.`);
        return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery query execution aborted, job not created" };
    }

    let jobToProcess: any;

    if (pageToken && jobIdForPagination) {
        try {
            jobToProcess = bigquery.job(jobIdForPagination);
            bigQueryJob = jobToProcess;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error referencing existing BigQuery job ${jobIdForPagination}: ${error.message}`);
            return { rows: undefined, jobStats: undefined, errorMessage: `Error referencing job ${jobIdForPagination}: ${error.message}` };
        }
    } else if (pageToken && !jobIdForPagination) {
        vscode.window.showErrorMessage('Pagination error: pageToken was provided without a job ID.');
        return { rows: undefined, jobStats: undefined, errorMessage: 'Pagination error: pageToken provided without a job ID.' };
    } else {
        if (cancelBigQueryJobSignal) {
            vscode.window.showInformationMessage(`BigQuery query execution aborted before new job creation.`);
            cancelBigQueryJobSignal = false;
            return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery query execution aborted, job not created" };
        }
        try {
            [jobToProcess] = await bigquery.createQueryJob({ query, jobTimeoutMs: bigQuerytimeoutMs });
            bigQueryJob = jobToProcess;
        } catch (error: any) {
            try {
                await handleBigQueryError(error);
                return await runQueryInBigQuery(query, pageToken, undefined);
            } catch (finalError: any) {
                vscode.window.showErrorMessage(`Error creating BigQuery job: ${finalError.message}`);
                return { rows: undefined, jobStats: undefined, errorMessage: finalError.message };
            }
        }
    }

    if (!jobToProcess) {
        vscode.window.showErrorMessage('BigQuery job could not be established.');
        return { rows: undefined, jobStats: undefined, errorMessage: 'BigQuery job could not be established.' };
    }
    
    if (cancelBigQueryJobSignal) {
        if (bigQueryJob) {
            await cancelBigQueryJob();
        }
        cancelBigQueryJobSignal = false;
        return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery query execution aborted." };
    }

    const options: QueryResultsOptions = {
        maxResults: 50,
        timeoutMs: bigQuerytimeoutMs,
        pageToken: pageToken
    };

    let rows;
    let queryResultsResponseMetadata;

    try {
        [rows, queryResultsResponseMetadata] = await jobToProcess.getQueryResults(options);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error executing BigQuery query: ${error.message}`);
        if (bigQueryJob === jobToProcess) {
             bigQueryJob = undefined;
        }
        return { rows: undefined, jobStats: undefined, errorMessage: error.message };
    }
    const nextPageToken = queryResultsResponseMetadata?.pageToken;

    let totalBytesBilled;
    let returnedJobId;
    let bigQueryJobEndTime;

    if (jobToProcess) {
        try {
            let jobMetadataResponse = await jobToProcess.getMetadata();
            const jobMetadata = jobMetadataResponse[0];
            
            if (jobMetadata && jobMetadata.statistics && jobMetadata.statistics.query) {
                let jobQueryStats = jobMetadata.statistics.query;
                returnedJobId = jobMetadata.id || jobToProcess.id;
                totalBytesBilled = jobQueryStats.totalBytesBilled;
                if (jobMetadata.statistics.endTime) {
                    try {
                        const jobEndTimeMs = parseInt(jobMetadata.statistics.endTime, 10);
                        bigQueryJobEndTime = !isNaN(jobEndTimeMs) ? new Date(jobEndTimeMs) : new Date();
                    } catch (e) {
                        bigQueryJobEndTime = new Date();
                    }
                } else {
                    bigQueryJobEndTime = new Date();
                }
            } else {
                returnedJobId = jobToProcess.id;
                bigQueryJobEndTime = new Date();
                console.warn("Detailed query statistics not available in job metadata for job:", returnedJobId);
            }
        } catch (metaError: any) {
            vscode.window.showErrorMessage(`Error fetching job metadata: ${metaError.message}`);
            returnedJobId = jobToProcess.id;
            bigQueryJobEndTime = new Date();
        }
        if (bigQueryJob === jobToProcess) {
             bigQueryJob = undefined;
        }
    }

    return {
        rows: rows,
        jobStats: returnedJobId ? {
            bigQueryJobEndTime: bigQueryJobEndTime,
            bigQueryJobId: returnedJobId,
            jobCostMeta: formatBytes(Number(totalBytesBilled))
        } : undefined,
        errorMessage: undefined,
        pageToken: nextPageToken
    };
}

export async function queryBigQuery(
    query: string,
    pageToken?: string,
    jobIdForPagination?: string
): Promise<{
    results: any[] | undefined,
    columns: any[] | undefined,
    jobStats: {
        bigQueryJobEndTime: Date | undefined,
        bigQueryJobId: string | undefined,
        jobCostMeta: string | undefined
    } | undefined,
    errorMessage: string | undefined,
    pageToken?: string,
    nextPageToken?: string
}> {
    // queryLimit = 100;

    let { rows, jobStats, errorMessage, pageToken: nextPageToken } = 
        await runQueryInBigQuery(query, pageToken, jobIdForPagination);

    if (errorMessage) {
        return { results: undefined, columns: undefined, jobStats: jobStats, errorMessage: errorMessage };
    }

    if (!rows || rows.length === 0) {
        return { results: undefined, columns: undefined, jobStats: jobStats, errorMessage: undefined};
    }

    let results = rows.map((row: { [s: string]: unknown }) => {
        const obj: { [key: string]: any } = {};
        Object.entries(row).forEach(([key, value]: [any, any]) => {
            if (typeof (value) === "object" && value !== null && !["Big", "BigQueryDate", "BigQueryDatetime", "BigQueryTime", "BigQueryTimestamp", "BigQueryRange", "BigQueryInt"].includes(value?.constructor?.name)) {
                if (Array.isArray(value) && ((value[0] && typeof value[0] === "string") || (value.length === 0) || (value[0] && Object.keys(value[0])[0] === "value"))) {
                    value = convertArrayToObject(value, key);
                } else if (typeof value === "object" && !Array.isArray(value) && value !== null) {
                    Object.entries(value).forEach(([fieldName, fieldValue]) => {
                        const fullFieldName = `${key}_x_${fieldName}`;
                        obj[fullFieldName] = fieldValue;
                    });
                    return;
                }

                let _childrens: any = [];
                _childrens = parseObject(key, value, _childrens);

                if (obj._children) {
                    for (let i = 0; i < _childrens.length; i++) {
                        if (obj._children[i]) {
                            obj._children[i] = { ...obj._children[i], ..._childrens[i] };
                        } else {
                            let keys = Object.keys(obj._children[0]);
                            let newChildren = {};
                            keys.forEach((_key: string) => {
                                if (_key !== key) {
                                    newChildren = { ...newChildren, [_key]: null };
                                }
                            });
                            obj._children[i] = { ...newChildren, ..._childrens[i] };
                        }
                    }
                } else {
                    obj._children = _childrens;
                }
            } else {
                obj[key] = extractValue(value);
            }
        });
        return obj;
    });

    let columns = createTabulatorColumns(results[0]);

    return { 
        results: results, 
        columns: columns, 
        jobStats: jobStats, 
        errorMessage: errorMessage,
        pageToken: nextPageToken 
    };
}

export async function cancelBigQueryJob() {
    if (!cancelBigQueryJobSignal) {
        vscode.window.showInformationMessage(`Trying to cacel query execution`);
    }
    cancelBigQueryJobSignal = true;
    if (bigQueryJob) {
        let bigQueryJobId = bigQueryJob.id;
        await bigQueryJob.cancel();
        bigQueryJob = undefined;
        vscode.window.showInformationMessage(`Cancelled BigQuery job with id ${bigQueryJobId}`);
        return { cancelled: true, bigQueryJobId: bigQueryJobId };
    } else {
        vscode.window.showInformationMessage(`Was unable to cancel job, please check for your job in BigQuery console`);
        return { cancelled: undefined, bigQueryJobId: undefined };
    }
}
