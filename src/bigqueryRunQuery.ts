import * as vscode from 'vscode';
import { getBigQueryClient, getBigQueryClientFor, checkAuthentication, handleBigQueryError } from './bigqueryClient';
import type { JobPlace } from './bigquery/jobPlace';
import { Job, QueryResultsOptions, Table } from '@google-cloud/bigquery';
import type { Target } from './shared/compiledGraph';
import { getBigQueryTimeoutMs } from './constants';
import { formatBytes } from './utils';
import { RESULT_CHUNK_ROWS, type JobStats, type ResultFilter, type ResultSort } from './shared/queryResultsView';
import { QueryResult, columnExprs, viewQuery, type ResultColumn, type SchemaField, type TableRef } from './bigquery/queryResult';

let cancelBigQueryJobSignal = false;

function convertArrayToObject(array: any, columnName: string) {
    if (array.length === 0) {
        return [{ [columnName]: null }];
    }
    return array.map((item: any) => ({ [columnName]: item }));
}

// Helper to identify BigQuery wrapper types (Numeric, BigQueryDate, etc.)
const isBigQueryWrapperType = (value: any) => {
    if (typeof value !== 'object' || value === null) {return false;}
    const constructorName = value?.constructor?.name;

    // Check for Big.js (Numeric) properties if constructor name is not available or differs
    if (constructorName === 'Big' || (value.s !== undefined && value.e !== undefined && value.c !== undefined)) {
        return true;
    }

    // Check for other BigQuery specific wrapper types
    if (constructorName && (constructorName.startsWith('BigQuery') || ["Big", "BigNumber"].includes(constructorName))) {
        return true;
    }

    // Check for plain value wrapper used by some BQ types
    if (constructorName && constructorName !== 'Object' && Object.keys(value).length === 1 && "value" in value) {
        return true;
    }

    return false;
};

// Function to recursively extract values from nested objects and handle Big objects
const extractValue: any = (value: any) => {
    if (typeof value === 'object' && value !== null) {
        if (isBigQueryWrapperType(value)) {
            if (typeof value.toString === 'function' && value.toString() !== '[object Object]') {
                return value.toString();
            }
            if ("value" in value) {
                return extractValue(value.value);
            }
            return Object.values(value).map(extractValue).join(', ');
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
            if (isBigQueryWrapperType(value)) {
                _children[key] = extractValue(value);
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


function createDataColumns(data: any | any[]) {
    if (!data) {
        return [];
    }

    const columns = new Set<string>();
    const rowsToScan = Array.isArray(data) ? data.slice(0, 100) : [data];

    rowsToScan.forEach(row => {
        if (!row) {return;};

        // Add top-level properties (excluding '_children')
        Object.keys(row).forEach(key => {
            if (key !== '_children') {
                columns.add(key);
            }
        });

        // Add all properties from all children
        if (row._children && row._children.length > 0) {
            row._children.forEach((child: any) => {
                Object.keys(child).forEach(key => columns.add(key));
            });
        }
    });

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
            if (isBigQueryWrapperType(value)) {
                obj[key] = extractValue(value);
            }
        }
    }
    return obj;
}

/** What a job that ran leaves to read the rest of its result with */
interface JobResult {
    job: Job;
    schema: SchemaField[] | undefined;
    /** The temporary table of the result. A statement that returns no rows has none. */
    table: TableRef | undefined;
}

/**
 * Runs the query and reads its rows: up to the row limit, or the first `firstRows` of them when given, the rest
 * being read later from `result.job`.
 */
export async function runQueryInBigQuery(query: string, alreadyRetried: boolean = false, place?: JobPlace, firstRows?: number, params?: Record<string, string>): Promise<{rows: any[] | undefined, jobStats: JobStats | undefined, errorMessage: string | undefined, result?: JobResult}> {
    await checkAuthentication();

    const bigquery = await getBigQueryClientFor(place);
    if (!bigquery) {
        vscode.window.showErrorMessage('Error creating BigQuery client Please check your authentication.');
        return { rows: undefined, jobStats: undefined, errorMessage: "Error creating BigQuery client Please check your authentication." };
    }

    if (cancelBigQueryJobSignal) {
        vscode.window.showInformationMessage(`BigQuery query execution aborted, job not created`);
        cancelBigQueryJobSignal = false;
        return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery query execution aborted, job not created" };
    }

    // Capture job in a local variable so concurrent calls don't overwrite each other's reference
    let localJob: typeof bigQueryJob;
    try {
        [localJob] = await bigquery.createQueryJob({query, jobTimeoutMs: getBigQueryTimeoutMs(), ...(params ? { params } : {}), ...(place?.location ? { location: place.location } : {}) });
        bigQueryJob = localJob;  // keep global updated for cancellation
        _bigQueryJobId = localJob?.id;
    } catch (error: any) {
        try {
            await handleBigQueryError(error, alreadyRetried);
            // The client was recreated after an authentication error: retry once
            return await runQueryInBigQuery(query, true, place, firstRows, params);
        } catch (finalError: any) {
            // vscode.window.showErrorMessage(`Error creating BigQuery job: ${finalError.message}`);
            return { rows: undefined, jobStats: undefined, errorMessage: finalError.message};
        }
    }

    //TODO: Not sure if this is needed as if the job is created the job id should be removed when cancelBigQueryJob() is called
    if (cancelBigQueryJobSignal) {
        await cancelBigQueryJob();
        cancelBigQueryJobSignal = false;
        return { rows: undefined, jobStats: undefined, errorMessage: "BigQuery query execution aborted, job not created" };
    }

    // One page is asked for by itself, which is also what makes BigQuery's answer, with the row count and the schema, come back
    const options:QueryResultsOptions = firstRows !== undefined
        ? { maxResults: firstRows, autoPaginate: false, timeoutMs: getBigQueryTimeoutMs() }
        : { maxResults: queryLimit, timeoutMs: getBigQueryTimeoutMs() };

    //TODO: even when the job has been cancelled it might return results, handle this
    //TODO: Can we not await and hence avoid the network transfer of data if job is cancelled ?
    let rows;
    let totalRows: number | undefined;
    let schema: SchemaField[] | undefined;
    try {
        let response;
        [rows, , response] = await localJob!.getQueryResults(options);
        schema = response?.schema?.fields;
        const total = Number(response?.totalRows);
        totalRows = response?.totalRows !== undefined && !isNaN(total) ? total : undefined;
    } catch (error: any) {
        // vscode.window.showErrorMessage(`Error executing BigQuery query: ${error.message}`);
        return { rows: undefined, jobStats: undefined, errorMessage: error.message };
    }

    let totalBytesBilled: string | undefined;
    let bigQueryJobId: string | undefined;
    let bigQueryJobEndTime: Date | undefined;
    let durationMs: number | undefined;
    let cacheHit: boolean | undefined;
    let table: TableRef | undefined;

    if (localJob) {
        const jobMetadata = await localJob.getMetadata();
        table = jobMetadata[0]?.configuration?.query?.destinationTable;
        const queryStats = jobMetadata[0]?.statistics?.query;
        bigQueryJobId = jobMetadata[0]?.id;
        totalBytesBilled = queryStats?.totalBytesBilled;
        cacheHit = queryStats?.cacheHit;
        try {
            const jobEndTime = parseInt(jobMetadata[0].statistics.endTime, 10);
            bigQueryJobEndTime = new Date(jobEndTime);
            const jobBegan = parseInt(jobMetadata[0].statistics.creationTime ?? jobMetadata[0].statistics.startTime, 10);
            durationMs = isNaN(jobEndTime - jobBegan) ? undefined : jobEndTime - jobBegan;
        } catch (error:any) {
            bigQueryJobEndTime = new Date();
        }
        bigQueryJob = undefined;
    }

    const bytesBilled = Number(totalBytesBilled);
    const jobCostMeta = totalBytesBilled !== undefined && !isNaN(bytesBilled)
        ? formatBytes(bytesBilled)
        : undefined;

    return { rows: rows, jobStats: { bigQueryJobEndTime, bigQueryJobId, jobCostMeta, durationMs, cacheHit, totalRows }, errorMessage: undefined, result: localJob ? { job: localJob, schema, table } : undefined };
}

export function processQueryResults(rows: any[]): { results: any[], columns: any[] } {
    let results = rows.map((row: { [s: string]: unknown }) => {
        const obj: { [key: string]: any } = {};
        Object.entries(row).forEach(([key, value]: [any, any]) => {
            const isBqWrapperType = isBigQueryWrapperType(value);
            
            //TODO:  Handling nested BigQuery rows. This if statement might not be robust
            if (typeof (value) === "object" && value !== null && !isBqWrapperType) {
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

                // Nested object support. This if statement might not be robust
                if (obj._children) {
                    for (let i = 0; i < _childrens.length; i++) {
                        if (obj._children[i]) {
                            obj._children[i] = { ...obj._children[i], ..._childrens[i] };
                        } else {
                            // we need to fill the _children to have all the data for each column so we will fill null values for the rest of the keys
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
        
        if (obj._children && obj._children.length > 0) {
            const parentKeys = new Set(Object.keys(obj));
            parentKeys.delete('_children');

            const keysToRename = new Map<string, string>();
            obj._children.forEach((child: any) => {
                Object.keys(child).forEach(childKey => {
                    if (parentKeys.has(childKey) && !keysToRename.has(childKey)) {
                        let newKey = childKey;
                        let counter = 1;
                        while (parentKeys.has(newKey) || keysToRename.has(newKey)) {
                            newKey = `${childKey}_${counter}`;
                            counter++;
                        }
                        keysToRename.set(childKey, newKey);
                    }
                });
            });

            if (keysToRename.size > 0) {
                obj._children = obj._children.map((child: any) => {
                    const newChild: any = {};
                    Object.entries(child).forEach(([childKey, childValue]) => {
                        const renamedKey = keysToRename.get(childKey);
                        if (renamedKey) {
                            newChild[renamedKey] = childValue;
                        } else {
                            newChild[childKey] = childValue;
                        }
                    });
                    return newChild;
                });
            }

            const firstChild = obj._children.shift();
            if (firstChild) {
                // Safely merge child fields, completely avoiding silent overwrites
                Object.entries(firstChild).forEach(([childKey, childValue]) => {
                    if (!(childKey in obj)) {
                        obj[childKey] = childValue;
                    }
                });
            }
            
            if (obj._children.length === 0) {
                delete obj._children;
            }
        }
        
        return obj;
    });

    let columns = createDataColumns(results);
    return { results, columns };
}

export async function queryBigQuery(query: string, place?: JobPlace): Promise<{results: any[] | undefined, columns: any[] | undefined, jobStats: JobStats | undefined, errorMessage: string | undefined}> {

    let { rows, jobStats, errorMessage } = await runQueryInBigQuery(query, false, place);

    if (errorMessage) {
        return { results: undefined, columns: undefined, jobStats: jobStats, errorMessage: errorMessage };
    }

    if (!rows || rows.length === 0) {
        return { results: undefined, columns: undefined, jobStats: jobStats, errorMessage: undefined};
    }

    const { results, columns } = processQueryResults(rows);

    return { results: results, columns: columns, jobStats: jobStats, errorMessage: errorMessage };
}

/** The result is kept by BigQuery for a day */
const resultGone = (error: any) => /not found: (table|job)/i.test(error?.message ?? '')
    ? new Error('BigQuery no longer keeps this result. Run the query again.')
    : error;

/**
 * Runs the query and reads the first rows of its result. The rest are read from BigQuery when they are looked at,
 * and a sort or a filter runs as a query over the temporary table that holds the result.
 */
export async function openQueryResult(query: string, place?: JobPlace, params?: Record<string, string>, columns?: ResultColumn[]): Promise<{result: QueryResult | undefined, jobStats: JobStats | undefined, errorMessage: string | undefined}> {
    const { rows, jobStats, errorMessage, result: ran } = await runQueryInBigQuery(query, false, place, RESULT_CHUNK_ROWS, params);
    if (errorMessage || !rows || !ran) {
        return { result: undefined, jobStats, errorMessage };
    }

    const exprs = columnExprs(ran.schema);
    const first = processQueryResults(rows);
    // A sorted, filtered result keeps the columns of the result it is of, also when no row is left to tell them from
    const resultColumns: ResultColumn[] = columns ?? first.columns.map((column: ResultColumn) => ({ ...column, sortable: column.field in exprs }));
    const { job, table } = ran;

    const read = async (startIndex: number, maxResults: number) => {
        try {
            const [more] = await job.getQueryResults({ startIndex: String(startIndex), maxResults, autoPaginate: false, timeoutMs: getBigQueryTimeoutMs() });
            return processQueryResults(more).results;
        } catch (error: any) {
            throw resultGone(error);
        }
    };

    const openView = table && Object.keys(exprs).length > 0
        ? async (sorting: ResultSort[], filters: ResultFilter[]) => {
            const view = viewQuery(table, sorting, filters, exprs);
            if (!view) {
                return { result };
            }
            // The table is in the place its job ran in
            const viewPlace = { ...place, location: job.location ?? place?.location } as JobPlace;
            const opened = await openQueryResult(view.query, viewPlace, view.params, resultColumns);
            if (opened.errorMessage) {
                throw resultGone(new Error(opened.errorMessage));
            }
            return {
                result: opened.result ?? new QueryResult(0, resultColumns, async () => []),
                billed: opened.jobStats?.jobCostMeta === '0 B' ? undefined : opened.jobStats?.jobCostMeta,
            };
        }
        : undefined;

    const result: QueryResult = new QueryResult(jobStats?.totalRows ?? first.results.length, resultColumns, read, first.results, openView);
    return { result, jobStats, errorMessage: undefined };
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

/** Calls BigQuery about a table, once more with a new client after an authentication error */
async function withTable<T>(target: Target, call: (table: Table) => Promise<T>, alreadyRetried = false): Promise<T> {
    await checkAuthentication();
    const bigquery = getBigQueryClient();
    if (!bigquery) {
        throw new Error('Error creating BigQuery client Please check your authentication.');
    }
    try {
        return await call(bigquery.dataset(target.schema, { projectId: target.database }).table(target.name));
    } catch (error: any) {
        await handleBigQueryError(error, alreadyRetried);
        return withTable(target, call, true);
    }
}

/** The `type` of the table's metadata: `TABLE`, `VIEW`, `MATERIALIZED_VIEW`, `EXTERNAL`, ... */
export async function getTableType(target: Target): Promise<string | undefined> {
    return withTable(target, async (table) => (await table.getMetadata())[0]?.type);
}

/**
 * Reads the first rows of a base table without a query job, so nothing is billed. The result has no more rows
 * than the view can hold, and the view sorts and filters it by itself.
 */
export async function openTableRows(target: Target): Promise<{result: QueryResult | undefined, jobStats: JobStats | undefined, errorMessage: string | undefined}> {
    try {
        const [rows] = await withTable(target, (table) => table.getRows({ maxResults: RESULT_CHUNK_ROWS, autoPaginate: false }));
        const first = processQueryResults(rows);
        const result = new QueryResult(first.results.length, first.columns, async () => [], first.results);
        return { result, jobStats: { totalRows: first.results.length, jobCostMeta: formatBytes(0) }, errorMessage: undefined };
    } catch (error: any) {
        return { result: undefined, jobStats: undefined, errorMessage: error?.message ?? String(error) };
    }
}
