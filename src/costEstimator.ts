import { queryDryRun } from "./bigqueryDryRun";
import * as vscode from 'vscode';
import { Assertion, DataformCompiledJson, TagDryRunStats, TagDryRunStatsMeta, Operation, Table, Target, SupportedCurrency } from "./types";

const createFullTargetName = (target: Target) => {
    return `${target.database}.${target.schema}.${target.name}`;
};

export function handleSemicolonInQuery(query: string){
    query = query.trimStart();
    const queryWithSemicolon = /;\s*$/.test(query);
    if(!queryWithSemicolon && query !== "" ){
        query = query + ";";
    }
    return query;
}


async function getModelDryRunStats(filteredModels: Table[] | Operation[] | Assertion[], type:string|undefined): Promise<Array<TagDryRunStats>>{
    const modelPromises = filteredModels.map(async (curModel) => {
    let fullQuery = "";
    let preOpsQuery = curModel.preOps ? curModel.preOps.join("\n") : "";
    preOpsQuery = handleSemicolonInQuery(preOpsQuery);

    let incrementalPreOpsQuery = curModel.incrementalPreOps ? curModel.incrementalPreOps.join("\n") : "";
    incrementalPreOpsQuery = handleSemicolonInQuery(incrementalPreOpsQuery);

    let incrementalQuery = curModel.incrementalQuery || "";
    incrementalQuery = handleSemicolonInQuery(incrementalQuery);

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
    const costOfRunningModel = dryRunOutput?.statistics?.cost?.value || 0;
    // 1024 bytes ** 3 = 1GiB
    const totalGBProcessed = ((dryRunOutput?.statistics?.totalBytesProcessed || 0) / (1024 ** 3)).toFixed(3);
    const statementType = dryRunOutput?.statistics?.statementType;
    const totalBytesProcessedAccuracy = dryRunOutput?.statistics?.totalBytesProcessedAccuracy;
    const error = dryRunOutput?.error;

    return {
        type: curModel.type || type || "",
        targetName: createFullTargetName(curModel.target),
        costOfRunningModel: costOfRunningModel,
        currency: dryRunOutput?.statistics?.cost?.currency as SupportedCurrency,
        totalGBProcessed: totalGBProcessed || "0.000",
        totalBytesProcessedAccuracy: totalBytesProcessedAccuracy,
        statementType: statementType,
        error: error.message
    };
    });
    const results = await Promise.all(modelPromises);
    return results;
}

export async function costEstimator(jsonData: DataformCompiledJson, selectedTag:string, includeDependencies: boolean = false, includeDependents: boolean = false): Promise<TagDryRunStatsMeta|undefined>  {
    try{
        const testQueryToCheckUserAccess = "SELECT 1;";
        const testDryRunOutput = await queryDryRun(testQueryToCheckUserAccess);
        if(testDryRunOutput.error.hasError){
            return {
                tagDryRunStatsList: undefined,
                error: testDryRunOutput.error.message,
            };
        }

        // Build target graph to support includes
        const allModels = [...(jsonData.tables || []), ...(jsonData.operations || []), ...(jsonData.assertions || [])];
        const targetToDependencies = new Map<string, string[]>();
        const targetToDependents = new Map<string, string[]>();

        allModels.forEach(model => {
            if (model.target) {
                const targetName = createFullTargetName(model.target);
                const deps = model.dependencyTargets?.map(createFullTargetName) || [];
                targetToDependencies.set(targetName, deps);
                
                deps.forEach(dep => {
                    if (!targetToDependents.has(dep)) {
                        targetToDependents.set(dep, []);
                    }
                    targetToDependents.get(dep)!.push(targetName);
                });
            }
        });

        // Initialize queue with tag models
        const targetSet = new Set<string>();
        const queueForDependencies: string[] = [];
        const queueForDependents: string[] = [];

        allModels.forEach(model => {
            if (model?.tags?.includes(selectedTag) && model.target) {
                const targetName = createFullTargetName(model.target);
                targetSet.add(targetName);
                if (includeDependencies) {
                    queueForDependencies.push(targetName);
                }
                if (includeDependents) {
                    queueForDependents.push(targetName);
                }
            }
        });

        if (includeDependencies) {
            let i = 0;
            while (i < queueForDependencies.length) {
                const current = queueForDependencies[i++];
                const deps = targetToDependencies.get(current) || [];
                deps.forEach(dep => {
                    if (!targetSet.has(dep)) {
                        targetSet.add(dep);
                        queueForDependencies.push(dep);
                    }
                });
            }
        }

        if (includeDependents) {
            let i = 0;
            while (i < queueForDependents.length) {
                const current = queueForDependents[i++];
                const deps = targetToDependents.get(current) || [];
                deps.forEach(dep => {
                    if (!targetSet.has(dep)) {
                        targetSet.add(dep);
                        queueForDependents.push(dep);
                    }
                });
            }
        }

        const filteredTables = jsonData.tables.filter(table => table.target && targetSet.has(createFullTargetName(table.target)));
        const filteredOperations = jsonData.operations.filter(operation => operation.target && targetSet.has(createFullTargetName(operation.target)));
        const filteredAssertions = jsonData.assertions.filter(assertion => assertion.target && targetSet.has(createFullTargetName(assertion.target)));

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
        return {
            tagDryRunStatsList: allResults,
            error: undefined,
        };
    }catch(error:any){
        //TODO: return error and show in the web view ?
        vscode.window.showErrorMessage(error.message);
        return undefined;
    }
}
