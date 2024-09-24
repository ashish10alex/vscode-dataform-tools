import * as vscode from 'vscode';
const {BigQuery} = require('@google-cloud/bigquery');

export async function queryBigQuery(query:string) {
  const bigqueryClient = new BigQuery();

  if (cancelBigQueryJobSignal){
    vscode.window.showInformationMessage(`BigQuery query execution aborted, job not created`);
    cancelBigQueryJobSignal = false;
    return { results: undefined, jobStats: {totalBytesBilled: undefined} };
  }

  [bigQueryJob] = await bigqueryClient.createQueryJob(query);

  if (cancelBigQueryJobSignal){
      cancelBigQueryJob(); 
      cancelBigQueryJobSignal = false;
  };

  const [rows] = await bigQueryJob.getQueryResults();

  let jobMetadata = await bigQueryJob.getMetadata();
  let jobStats = jobMetadata[0].statistics.query;
  let totalBytesBilled = jobStats.totalBytesBilled;
  bigQueryJob = undefined;

  if (rows.length === 0){
    return { results: undefined, jobStats: {totalBytesBilled: totalBytesBilled} };
  }

  // Function to recursively extract values from nested objects and handle Big objects
  const extractValue:any = (value:any) => {
    if (typeof value === 'object' && value !== null) {
      if (value.constructor && value.constructor.name === 'Big') {
        // Handle Big objects
        return value.toString();
      } else if (Array.isArray(value)) {
        return value.map(extractValue);
      } else {
        return Object.values(value).map(extractValue).join(', ');
      }
    }
    return value;
  };

  // Transform rows into the desired format for Datatables
  // const results = [
  //    {col1:col1_val, col2:col2_val, ...},
  //    ...
  // ];

  const results = rows.map((row: { [s: string]: unknown }) => {
    const obj: { [key: string]: any } = {};
    Object.entries(row).forEach(([key, value]) => {
      obj[key] = extractValue(value);
    });
    return obj;
  });

  return { results: results, jobStats: {totalBytesBilled: totalBytesBilled} };
}

export async function cancelBigQueryJob() {
  if (!cancelBigQueryJobSignal){
    vscode.window.showInformationMessage(`Trying to cacel query execution`);
  }
  cancelBigQueryJobSignal = true;
  if (bigQueryJob) {
    let bigQueryJobId = bigQueryJob.id;
    await bigQueryJob.cancel();
    vscode.window.showInformationMessage(`Cancelled BigQuery job with id ${bigQueryJobId}`);
  }
}
