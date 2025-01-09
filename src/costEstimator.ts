import { queryDryRun } from "./bigqueryDryRun";
import { DataformCompiledJson, Target } from "./types";

const createFullTargetName = (target: Target) => {
    return `${target.database}.${target.schema}.${target.name}`;
};

export async function costEstimator(jsonData: DataformCompiledJson, selectedTag:string) {
    try{
        const filteredTables = jsonData.tables.filter(table => table.tags.includes(selectedTag));

        const tablePromises = filteredTables.map(async (curTable) => {
            let fullQuery = "";
            const preOpsQuery = curTable.preOps ? curTable.preOps.join("\n") + ";" : "";
            const incrementalPreOpsQuery = curTable.incrementalPreOps ? curTable.incrementalPreOps.join("\n") + ";" : "";
            const incrementalQuery = curTable.incrementalQuery || "";

            if (curTable.type === "view") {
                fullQuery = preOpsQuery + 'CREATE OR REPLACE VIEW ' + createFullTargetName(curTable.target) + ' AS ' + curTable.query;
            } else if (curTable.type === "table" && (curTable?.bigquery?.partitionBy || curTable?.bigquery?.clusterBy)) {
                fullQuery = preOpsQuery + curTable.query;
            } else if (curTable.type === "table") {
                fullQuery = preOpsQuery + 'CREATE OR REPLACE TABLE ' + createFullTargetName(curTable.target) + ' AS ' + curTable.query;
            } else if (curTable.type === "incremental" && (curTable?.bigquery?.partitionBy || curTable?.bigquery?.clusterBy)) {
                fullQuery = incrementalPreOpsQuery + incrementalQuery;
            } else if (curTable.type === "incremental") {
                fullQuery = incrementalPreOpsQuery + 'CREATE OR REPLACE TABLE ' + createFullTargetName(curTable.target) + ' AS ' + incrementalQuery;
            }

            const dryRunOutput = await queryDryRun(fullQuery);
            const costOfRunningModel = dryRunOutput?.statistics?.costInPounds || 0;
            const statementType = dryRunOutput?.statistics?.statementType;
            const totalBytesProcessedAccuracy = dryRunOutput?.statistics?.totalBytesProcessedAccuracy;

            return {
                type: curTable.type,
                targetName: createFullTargetName(curTable.target),
                cost: costOfRunningModel,
                totalBytesProcessedAccuracy: totalBytesProcessedAccuracy,
                statementType: statementType,
            };
        });

        const results = await Promise.all(tablePromises);
        // console.log(results);
        return results;

    }catch(error:any){
        console.error(error);
    }
}
