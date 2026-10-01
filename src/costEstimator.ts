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
    const modelFns = filteredModels.map(curModel => async () => {
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
    // BigQuery reports 0 bytes when it cannot compute them statically. Leaving the figures
    // undefined keeps them out of the table totals instead of understating the tag's cost.
    const bytesEstimateUnknown = dryRunOutput?.statistics?.bytesEstimateUnknown === true;
    const costOfRunningModel = bytesEstimateUnknown ? undefined : (dryRunOutput?.statistics?.cost?.value || 0);
    // 1024 bytes ** 3 = 1GiB
    const totalGBProcessed = bytesEstimateUnknown
        ? undefined
        : ((dryRunOutput?.statistics?.totalBytesProcessed || 0) / (1024 ** 3)).toFixed(3);
    const statementType = dryRunOutput?.statistics?.statementType;
    const totalBytesProcessedAccuracy = dryRunOutput?.statistics?.totalBytesProcessedAccuracy;
    const error = dryRunOutput?.error;

    return {
        type: curModel.type || type || "",
        targetName: createFullTargetName(curModel.target),
        schema: curModel.target.schema,
        costOfRunningModel: costOfRunningModel,
        currency: dryRunOutput?.statistics?.cost?.currency as SupportedCurrency,
        totalGBProcessed: totalGBProcessed,
        totalBytesProcessedAccuracy: totalBytesProcessedAccuracy,
        statementType: statementType,
        bytesEstimateUnknown: bytesEstimateUnknown,
        error: error.message
    };
    });

    // queryDryRun limits how many run at once
    return Promise.all(modelFns.map(fn => fn()));
}

export async function costEstimator(jsonData: DataformCompiledJson, selectedTags: string[], includeDependencies: boolean = false, includeDependents: boolean = false): Promise<TagDryRunStatsMeta|undefined>  {
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
            if (model?.tags?.some(tag => selectedTags.includes(tag)) && model.target) {
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

        const filteredTables = (jsonData?.tables ?? []).filter(
        ({ target }) =>
            target && targetSet.has(createFullTargetName(target))
        );

        const filteredOperations = (jsonData?.operations ?? []).filter(
        operation =>
            operation.target &&
            targetSet.has(createFullTargetName(operation.target))
        );

        const filteredAssertions = (jsonData?.assertions ?? []).filter(
        assertion =>
            assertion.target &&
            targetSet.has(createFullTargetName(assertion.target))
        );

        // Tables, assertions and operations share the dry run pool rather than waiting for each other
        const [tableResults, assertionResults, operationResults] = await Promise.all([
            filteredTables.length > 0 ? getModelDryRunStats(filteredTables, undefined) : [],
            filteredAssertions.length > 0 ? getModelDryRunStats(filteredAssertions, "assertion") : [],
            filteredOperations.length > 0 ? getModelDryRunStats(filteredOperations, "operation") : [],
        ]);
        const allResults = [...tableResults, ...assertionResults, ...operationResults];
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
