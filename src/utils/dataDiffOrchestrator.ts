import { getBigQueryClient } from '../bigqueryClient';
import { GitService } from '../gitClient';
import { logger } from '../logger';
import * as vscode from 'vscode';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';
export async function orchestrateDataDiff(
    sourceBranch: string, 
    targetBranch: string, 
    tablePrefix: string,
    primaryKeys: string,
    panel: vscode.WebviewPanel
) {
    try {
        const gitService = new GitService();
        const modifiedFiles = await gitService.getModifiedFilesBetweenBranches(sourceBranch, targetBranch);
        
        logger.info(`Modified .sqlx / .js files between ${targetBranch} and ${sourceBranch}: ${modifiedFiles.join(", ")}`);
        
        if (modifiedFiles.length === 0) {
            panel.webview.postMessage({ command: 'diffError', data: 'No dataform models modified between branches.' });
            return;
        }

        // To map files to targets, we need to compile the current workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            panel.webview.postMessage({ command: 'diffError', data: 'No workspace folder open.' });
            return;
        }
        const workspaceFolder = workspaceFolders[0].uri.fsPath;

        const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
        
        if (!dataformCompiledJson) {
            panel.webview.postMessage({ command: 'diffError', data: 'Failed to compile Dataform workspace to map modified files.' });
            return;
        }
        
        const bqClient = getBigQueryClient();
        if (!bqClient) {
             panel.webview.postMessage({ command: 'diffError', data: 'BigQuery client is not initialized.' });
             return;
        }
        
        // Loop through each modified file and try to diff
        const diffResults = [];
        for (const file of modifiedFiles) {
            // Find the table target from compiled data
            const matchingTable = dataformCompiledJson.tables.find((t: any) => file.endsWith(t.fileName));
            if (!matchingTable) {
                logger.info(`Could not find compiled table for file: ${file}, skipping.`);
                continue;
            }

            const targetDatabase = matchingTable.target.database;
            const targetSchema = matchingTable.target.schema;
            const targetNameSource = matchingTable.target.name; // this will have the prefix based on what was passed or derived

            // The exact prefix handling logic: The target branch has NO prefix. The source branch HAS the prefix.
            // If the table name from compile ALREADY HAS prefix, then targetTable is base name, sourceTable is base name + prefix.
            // Given the user said "--table-prefix should be set", we need to figure out how to name the tables correctly.
            // We use the provided tablePrefix directly.
            
            let baseTableName = targetNameSource;
            let featTableName = targetNameSource;
            
            // Reconstruct table names depending on whether the prefix was naturally applied during compilation
            if (baseTableName.startsWith(`${tablePrefix}_`)) {
                 baseTableName = baseTableName.replace(`${tablePrefix}_`, '');
            } else if (baseTableName.startsWith(tablePrefix) && tablePrefix !== "") {
                 baseTableName = baseTableName.replace(tablePrefix, '');
            } else {
                 featTableName = tablePrefix ? `${tablePrefix}${tablePrefix.endsWith('_') ? '' : '_'}${baseTableName}` : baseTableName;
            }

            logger.info(`Comparing target table \`${targetDatabase}.${targetSchema}.${baseTableName}\` and source table \`${targetDatabase}.${targetSchema}.${featTableName}\``);

            // Verify both tables exist
            const [targetExists] = await bqClient.dataset(targetSchema).table(baseTableName).exists();
            const [sourceExists] = await bqClient.dataset(targetSchema).table(featTableName).exists();

            if (!targetExists || !sourceExists) {
                logger.info(`Missing tables for ${file}. Target Exists: ${targetExists}, Source Exists: ${sourceExists}. Skipping.`);
                diffResults.push({
                    file,
                    error: `Tables not materialized. Target (\`${targetDatabase}.${targetSchema}.${baseTableName}\`) Exists: ${targetExists}, Source (\`${targetDatabase}.${targetSchema}.${featTableName}\`) Exists: ${sourceExists}`
                });
                continue;
            }

            // Tables exist! Now fetch schemas.
            let targetSchemaCols: any[] = [];
            let sourceSchemaCols: any[] = [];
            
            try {
                // Fetch schemas via BigQuery INFORMATION_SCHEMA
                const targetSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${baseTableName}'`;
                const sourceSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${featTableName}'`;
                
                const [targetCols] = await bqClient.query(targetSchemaQuery);
                const [sourceCols] = await bqClient.query(sourceSchemaQuery);
                
                targetSchemaCols = targetCols;
                sourceSchemaCols = sourceCols;
                
            } catch (err: any) {
                logger.error(`Error fetching schemas for ${baseTableName} / ${featTableName}: ${err.message}`);
                diffResults.push({
                    file,
                    error: `Error computing schema for diff: ${err.message}`
                });
                continue;
            }

            // Union all unique column names
            const allColNames = Array.from(new Set([
                ...targetSchemaCols.map(c => c.column_name),
                ...sourceSchemaCols.map(c => c.column_name)
            ]));

            // Build select lists padding missing columns with NULL
            const buildSelectList = (tableCols: any[]) => {
                const colNames = tableCols.map(c => c.column_name);
                return allColNames.map(col => {
                    const cInfo = [...targetSchemaCols, ...sourceSchemaCols].find(c => c.column_name === col);
                    const type = cInfo ? cInfo.data_type : 'STRING';
                    if (colNames.includes(col)) {
                        return `${col}`;
                    }
                    return `CAST(NULL as ${type}) AS ${col}`;
                }).join(', ');
            };

            const sourceSelectList = buildSelectList(sourceSchemaCols);
            const targetSelectList = buildSelectList(targetSchemaCols);

            const commonColNames = targetSchemaCols.map(c => c.column_name).filter(c => sourceSchemaCols.find(s => s.column_name === c));
            const orderByCols = commonColNames.length > 0 ? commonColNames.map(c => `\`${c}\``).join(', ') : '1';
            
            let comparisonQuery = '';

            const pks = primaryKeys ? primaryKeys.split(',').map(k => k.trim()) : ((matchingTable as any).uniqueKey || []);
            const pkCols: string[] = Array.isArray(pks) ? pks : (typeof pks === 'string' ? [pks] : []);

            if (commonColNames.length === 0) {
                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`),
                 added AS (SELECT 'Added' as _diff_status, * FROM tbl_feat EXCEPT DISTINCT SELECT 'Added', * FROM tbl_tgt),
                 removed AS (SELECT 'Removed' as _diff_status, * FROM tbl_tgt EXCEPT DISTINCT SELECT 'Removed', * FROM tbl_feat)
                 SELECT * FROM added UNION ALL SELECT * FROM removed
                 ORDER BY 1, _diff_status
                 `;
            } else if (pkCols.length === 0) {
                 // Fall back to EXCEPT DISTINCT without primary keys
                 const structFieldsSource = commonColNames.map(c => `\`${c}\``).join(', ');
                 
                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`),
                 
                 diff_feat AS (SELECT * FROM tbl_feat EXCEPT DISTINCT SELECT * FROM tbl_tgt),
                 diff_tgt AS (SELECT * FROM tbl_tgt EXCEPT DISTINCT SELECT * FROM tbl_feat),

                 true_added AS (
                    SELECT 'Added' as _diff_status, f.* FROM diff_feat f
                    WHERE TO_JSON_STRING(STRUCT(${structFieldsSource})) NOT IN (SELECT TO_JSON_STRING(STRUCT(${structFieldsSource})) FROM diff_tgt)
                 ),
                 true_removed AS (
                    SELECT 'Removed' as _diff_status, t.* FROM diff_tgt t
                    WHERE TO_JSON_STRING(STRUCT(${structFieldsSource})) NOT IN (SELECT TO_JSON_STRING(STRUCT(${structFieldsSource})) FROM diff_feat)
                 ),
                 modified_old AS (
                    SELECT 'Modified (-)' as _diff_status, t.* FROM diff_tgt t
                    WHERE TO_JSON_STRING(STRUCT(${structFieldsSource})) IN (SELECT TO_JSON_STRING(STRUCT(${structFieldsSource})) FROM diff_feat)
                 ),
                 modified_new AS (
                    SELECT 'Modified (+)' as _diff_status, f.* FROM diff_feat f
                    WHERE TO_JSON_STRING(STRUCT(${structFieldsSource})) IN (SELECT TO_JSON_STRING(STRUCT(${structFieldsSource})) FROM diff_tgt)
                 )

                 SELECT * FROM true_added
                 UNION ALL SELECT * FROM true_removed
                 UNION ALL SELECT * FROM modified_old
                 UNION ALL SELECT * FROM modified_new
                 ORDER BY ${orderByCols}, _diff_status DESC
                 `;
            } else {
                 // FULL OUTER JOIN on Primary Keys
                 const pkJoinCondition = pkCols.map(pk => `tbl_tgt.\`${pk}\` = tbl_feat.\`${pk}\``).join(' AND ');
                 
                 const pkCoalesceParts = pkCols.map(pk => `COALESCE(CAST(tbl_tgt.\`${pk}\` AS STRING), CAST(tbl_feat.\`${pk}\` AS STRING))`);
                 const pkOrderStr = pkCoalesceParts.length > 1 ? `CONCAT(${pkCoalesceParts.join(", '-', ")})` : pkCoalesceParts[0];

                 const diffConditionParts = commonColNames.filter(c => !pkCols.includes(c)).map(c => `IFNULL(CAST(tbl_tgt.\`${c}\` AS STRING), '<null>') != IFNULL(CAST(tbl_feat.\`${c}\` AS STRING), '<null>')`);
                 const finalDiffCondition = diffConditionParts.length > 0 ? `(${diffConditionParts.join(' OR ')})` : 'FALSE';

                 const selectColumns = commonColNames.map(c => `tbl_tgt.\`${c}\` as \`base_${c}\`, tbl_feat.\`${c}\` as \`feat_${c}\``).join(', ');

                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`)
                 
                 SELECT 
                    ${pkOrderStr} as _pk,
                    CASE 
                        WHEN tbl_tgt.\`${pkCols[0]}\` IS NULL THEN 'Added'
                        WHEN tbl_feat.\`${pkCols[0]}\` IS NULL THEN 'Removed'
                        ELSE 'Modified'
                    END as _diff_status,
                    ${selectColumns}
                 FROM tbl_tgt
                 FULL OUTER JOIN tbl_feat ON ${pkJoinCondition}
                 WHERE 
                    (tbl_tgt.\`${pkCols[0]}\` IS NULL OR tbl_feat.\`${pkCols[0]}\` IS NULL)
                    OR
                    (${finalDiffCondition})
                 ORDER BY _pk, _diff_status DESC
                 `;
            }

            // Execute the query
            try {
                logger.info(`Executing data diff query for ${file}`);
                const [rows] = await bqClient.query(comparisonQuery);
                
                let addedCount = 0;
                let removedCount = 0;
                let modifiedCount = 0;
                rows.forEach((r: any) => {
                    if (r._diff_status === 'Added') { addedCount++; }
                    if (r._diff_status === 'Removed') { removedCount++; }
                    if (r._diff_status === 'Modified' || r._diff_status === 'Modified (+)') { modifiedCount++; }
                });

                diffResults.push({
                     file,
                     addedCount,
                     removedCount,
                     modifiedCount,
                     rows,
                     baseTableName,
                     featTableName,
                     pkCols,
                     commonColNames,
                     isPairedDiff: pkCols.length > 0
                });
            } catch (queryErr: any) {
                 logger.error(`Error executing diff query: ${queryErr}`);
                 diffResults.push({
                     file,
                     error: `Error diffing table data: ${queryErr.message}`
                 });
            }
        }

        if (diffResults.length === 0) {
            panel.webview.postMessage({ command: 'diffError', data: 'No diffable dataform models were found among the modified files.' });
            return;
        }

        panel.webview.postMessage({
            command: 'diffComplete',
            data: { results: diffResults }
        });

    } catch (e: any) {
        logger.error(`Error in data diff orchestration: ${e.message}`);
        panel.webview.postMessage({ command: 'diffError', data: e.message });
    }
}
