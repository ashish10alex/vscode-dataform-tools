import * as vscode from 'vscode';
const { BigQuery } = require('@google-cloud/bigquery');

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
        field: key
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

export async function queryBigQuery(query: string) {
    const bigqueryClient = new BigQuery();

    if (cancelBigQueryJobSignal) {
        vscode.window.showInformationMessage(`BigQuery query execution aborted, job not created`);
        cancelBigQueryJobSignal = false;
        return { results: undefined, jobStats: { totalBytesBilled: undefined } };
    }

    [bigQueryJob] = await bigqueryClient.createQueryJob(query);

    if (cancelBigQueryJobSignal) {
        cancelBigQueryJob();
        cancelBigQueryJobSignal = false;
    };

    const [rows] = await bigQueryJob.getQueryResults();

    let jobMetadata = await bigQueryJob.getMetadata();
    let jobStats = jobMetadata[0].statistics.query;
    let totalBytesBilled = jobStats.totalBytesBilled;
    bigQueryJob = undefined;

    if (rows.length === 0) {
        return { results: undefined, jobStats: { totalBytesBilled: totalBytesBilled } };
    }

    function parseObject(obj: any, _childrens: any) {
        let _children: any = {};
        Object.entries(obj).forEach(([key, value]: [any, any]) => {
            if (typeof value === 'object' && value !== null) {
                if (value.constructor && value.constructor.name === 'Big') {
                    _children[key] = value.toString();
                }
                else if (value.constructor.name === 'Object') {
                    _childrens.push({ ..._children, ...value });
                }
                else if (value.constructor.name === 'Array') {
                    let new_children = parseObject(value, _childrens);
                    if (new_children.constructor.name === "Array") {
                        new_children.forEach((c: any, idx: any) => {
                            new_children[idx] = transformBigValues(new_children[idx]);
                            new_children[idx] = { ..._children, ...new_children[idx] };
                        });
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

    // Transform rows into the desired format for Datatables
    // const results = [
    //    {col1:col1_val, col2:col2_val, ...},
    //    ...
    // ];

    const results = rows.map((row: { [s: string]: unknown }) => {
        const obj: { [key: string]: any } = {};
        Object.entries(row).forEach(([key, value]: [any, any]) => {
            if (typeof (value) === "object" && value !== null && !["Big", "BigQueryDate", "BigQueryDatetime", "BigQueryTime", "BigQueryTimestamp", "BigQueryRange", "BigQueryInt"].includes(value?.constructor?.name)) {
                let _childrens: any = [];
                _childrens = parseObject(value, _childrens);
                obj["_children"] = _childrens;
            } else {
                obj[key] = extractValue(value);
            }
        });
        return obj;
    });
    let columns = createTabulatorColumns(results[0]);

    return { results: results, columns: columns, jobStats: { totalBytesBilled: totalBytesBilled } };
}

export async function cancelBigQueryJob() {
    if (!cancelBigQueryJobSignal) {
        vscode.window.showInformationMessage(`Trying to cacel query execution`);
    }
    cancelBigQueryJobSignal = true;
    if (bigQueryJob) {
        let bigQueryJobId = bigQueryJob.id;
        await bigQueryJob.cancel();
        vscode.window.showInformationMessage(`Cancelled BigQuery job with id ${bigQueryJobId}`);
    }
}
