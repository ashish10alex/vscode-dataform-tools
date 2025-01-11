import { queryDryRun } from "./bigqueryDryRun";
import * as vscode from 'vscode';
import { Assertion, DataformCompiledJson, DryRunError, Operation, Table, Target } from "./types";

const createFullTargetName = (target: Target) => {
    return `${target.database}.${target.schema}.${target.name}`;
};

async function getModelDryRunStats(filteredModels: Table[] | Operation[] | Assertion[], type:string|undefined): Promise<Array<{
  type: string;
  targetName: string;
  cost: number;
  totalGBProcessed: string;
  totalBytesProcessedAccuracy: string | undefined;
  statementType: string | undefined;
  error: string
}>>{
    const modelPromises = filteredModels.map(async (curModel) => {
    let fullQuery = "";
    const preOpsQuery = curModel.preOps ? curModel.preOps.join("\n") + ";" : "";
    const incrementalPreOpsQuery = curModel.incrementalPreOps ? curModel.incrementalPreOps.join("\n") + ";" : "";
    const incrementalQuery = curModel.incrementalQuery || "";

    if (curModel.type === "view") {
        fullQuery = preOpsQuery + 'CREATE OR REPLACE VIEW ' + createFullTargetName(curModel.target) + ' AS ' + curModel.query;
    } else if (curModel.type === "table" && (curModel?.bigquery?.partitionBy || curModel?.bigquery?.clusterBy)) {
        fullQuery = preOpsQuery + curModel.query;
    } else if (curModel.type === "table") {
        fullQuery = preOpsQuery + 'CREATE OR REPLACE TABLE ' + createFullTargetName(curModel.target) + ' AS ' + curModel.query;
    } else if (curModel.type === "incremental" && (curModel?.bigquery?.partitionBy || curModel?.bigquery?.clusterBy)) {
        fullQuery = incrementalPreOpsQuery + incrementalQuery;
    } else if (curModel.type === "incremental") {
        fullQuery = incrementalPreOpsQuery + 'CREATE OR REPLACE TABLE ' + createFullTargetName(curModel.target) + ' AS ' + incrementalQuery;
    } else if (type === "assertion") {
        fullQuery = curModel.query || "";
    } else if (type === "operation") {
        // @ts-ignore -- adding this to avoid type error hassle, we can revisit this later 
        fullQuery = curModel.queries.join("\n") + ";";
    }

    const dryRunOutput = await queryDryRun(fullQuery);
    const costOfRunningModel = dryRunOutput?.statistics?.costInPounds || 0;
    const totalGBProcessed = dryRunOutput?.statistics?.totalGBProcessed;
    const statementType = dryRunOutput?.statistics?.statementType;
    const totalBytesProcessedAccuracy = dryRunOutput?.statistics?.totalBytesProcessedAccuracy;
    const error = dryRunOutput?.error;

    return {
        type: curModel.type || type || "",
        targetName: createFullTargetName(curModel.target),
        cost: costOfRunningModel,
        totalGBProcessed: totalGBProcessed || "0.000",
        totalBytesProcessedAccuracy: totalBytesProcessedAccuracy,
        statementType: statementType,
        error: error.message
    };
    });
    const results = await Promise.all(modelPromises);
    return results;
}

export async function costEstimator(jsonData: DataformCompiledJson, selectedTag:string) {
    try{
        //TODO: perform dry run using `select 1;` to ensure that user has sufficient permissions to perform the action
        //TODO: we need to propogate this error to the web view
        const testQueryToCheckUserAccess = "SELECT 1;";
        const testDryRunOutput = await queryDryRun(testQueryToCheckUserAccess);
        if(testDryRunOutput.error.hasError){
            throw new Error(testDryRunOutput.error.message);
        }

        const filteredTables = jsonData.tables.filter(table => table.tags.includes(selectedTag));
        const filteredOperations = jsonData.operations.filter(operation => operation.tags.includes(selectedTag));
        const filteredAssertions = jsonData.assertions.filter(assertion => assertion.tags.includes(selectedTag));

        let allResults = [];

        if(filteredTables?.length > 0){
            const tableResults = await getModelDryRunStats(filteredTables, undefined);
            allResults.push(...tableResults);
        }

        if(filteredAssertions?.length > 0){
            const assertionResults = await getModelDryRunStats(filteredAssertions, "assertion");
            allResults.push(...assertionResults);
        }

        if(filteredOperations?.length > 0){
            const operationResults = await getModelDryRunStats(filteredOperations, "operation");
            allResults.push(...operationResults);
        }
        return allResults;
    }catch(error:any){
        //TODO: return error and show in the web view
        vscode.window.showErrorMessage(error.message);
    }
}
