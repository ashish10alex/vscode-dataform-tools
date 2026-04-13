import { getBigQueryClient } from '../bigqueryClient';
import { GitService } from '../gitClient';
import { logger } from '../logger';
import * as vscode from 'vscode';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';
import { queryDryRun } from '../bigqueryDryRun';
import { formatSqlQuery } from './sqlFormatter';
export async function orchestrateDataDiff(
    sourceBranch: string,
    targetBranch: string,
    tablePrefix: string,
    targetPrimaryKeysMap: Record<string, string>,
    sourcePrimaryKeysMap: Record<string, string>,
    targetFilterMap: Record<string, string>,
    sourceFilterMap: Record<string, string>,
    excludeColumnsMap: Record<string, string>,
    panel: vscode.WebviewPanel,
    targetFiles?: string[]
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
        const filesToProcess = targetFiles ? modifiedFiles.filter(f => targetFiles.includes(f)) : modifiedFiles;
        const diffResults = [];
        for (const file of filesToProcess) {
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
            
            const workspacePrefix = (dataformCompiledJson.projectConfig as any)?.tablePrefix || (dataformCompiledJson.projectConfig as any)?.defaultTablePrefix;
            let rawTableName = targetNameSource;
            
            if (workspacePrefix && typeof workspacePrefix === 'string') {
                if (rawTableName.startsWith(`${workspacePrefix}_`)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length + 1);
                } else if (rawTableName.startsWith(workspacePrefix)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length);
                }
            }
            
            const baseTableName = rawTableName;
            const featTableName = tablePrefix ? `${tablePrefix}${tablePrefix.endsWith('_') ? '' : '_'}${rawTableName}` : rawTableName;

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
            let baseLastModified: string | null = null;
            let featLastModified: string | null = null;

            try {
                // Fetch schemas via BigQuery INFORMATION_SCHEMA
                const targetSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${baseTableName}'`;
                const sourceSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${featTableName}'`;
                const [targetCols, sourceCols, baseMeta, featMeta] = await Promise.all([
                    bqClient.query(targetSchemaQuery).then(([r]: any) => r),
                    bqClient.query(sourceSchemaQuery).then(([r]: any) => r),
                    bqClient.dataset(targetSchema).table(baseTableName).getMetadata().then(([m]: any) => m).catch(() => null),
                    bqClient.dataset(targetSchema).table(featTableName).getMetadata().then(([m]: any) => m).catch(() => null),
                ]);

                targetSchemaCols = targetCols;
                sourceSchemaCols = sourceCols;

                // lastModifiedTime is returned as an epoch-ms string by the BQ API
                if (baseMeta?.lastModifiedTime) {
                    baseLastModified = new Date(parseInt(baseMeta.lastModifiedTime)).toISOString();
                }
                if (featMeta?.lastModifiedTime) {
                    featLastModified = new Date(parseInt(featMeta.lastModifiedTime)).toISOString();
                }

            } catch (err: any) {
                logger.error(`Error fetching schemas for ${baseTableName} / ${featTableName}: ${err.message}`);
                diffResults.push({
                    file,
                    error: `Error computing schema for diff: ${err.message}`
                });
                continue;
            }

            const excludeCols = (excludeColumnsMap[file] || '').split(',').map((k: string) => k.trim()).filter(Boolean);

            // Union all unique column names (minus excluded)
            const allColNames = Array.from(new Set([
                ...targetSchemaCols.map(c => c.column_name),
                ...sourceSchemaCols.map(c => c.column_name)
            ])).filter((c: string) => !excludeCols.includes(c));

            // Build select lists padding missing columns with NULL
            const buildSelectList = (tableCols: any[], isTarget: boolean) => {
                const colNames = tableCols.map(c => c.column_name);
                return allColNames.map(col => {
                    const tCol = targetSchemaCols.find(c => c.column_name === col);
                    const sCol = sourceSchemaCols.find(c => c.column_name === col);
                    const type = (isTarget ? tCol : sCol)?.data_type || tCol?.data_type || sCol?.data_type || 'STRING';

                    const isComplex = type.match(/^(STRUCT|ARRAY)/i);

                    if (colNames.includes(col)) {
                        if (isComplex) {
                            return `TO_JSON_STRING(\`${col}\`) AS \`${col}\``;
                        }
                        if (tCol && sCol && tCol.data_type !== sCol.data_type) {
                            return `CAST(\`${col}\` AS STRING) AS \`${col}\``;
                        }
                        return `\`${col}\``;
                    }

                    if (isComplex || (tCol && sCol && tCol.data_type !== sCol.data_type)) {
                        return `CAST(NULL AS STRING) AS \`${col}\``;
                    }
                    return `CAST(NULL as ${type}) AS \`${col}\``;
                }).join(', ');
            };

            const sourceSelectList = buildSelectList(sourceSchemaCols, false);
            const targetSelectList = buildSelectList(targetSchemaCols, true);

            const commonColNames = targetSchemaCols.map(c => c.column_name).filter(c => sourceSchemaCols.find(s => s.column_name === c) && !excludeCols.includes(c));
            
            let comparisonQuery = '';

            const targetPrimaryKeys = targetPrimaryKeysMap[file] || '';
            const sourcePrimaryKeys = sourcePrimaryKeysMap[file] || '';
            const defaultPks: string[] = (matchingTable as any).uniqueKey || [];
            const targetPkCols: string[] = targetPrimaryKeys ? targetPrimaryKeys.split(',').map((k: string) => k.trim()).filter(Boolean) : defaultPks;
            const sourcePkCols: string[] = sourcePrimaryKeys ? sourcePrimaryKeys.split(',').map((k: string) => k.trim()).filter(Boolean) : (targetPrimaryKeys ? targetPkCols : defaultPks);
            const pkCols: string[] = targetPkCols; // used for diff column exclusion / summary

            const targetFilter = targetFilterMap[file] || '';
            const sourceFilter = sourceFilterMap[file] || '';
            const targetWhereClause = targetFilter ? ` WHERE ${targetFilter}` : '';
            const sourceWhereClause = sourceFilter ? ` WHERE ${sourceFilter}` : '';

            if (commonColNames.length === 0) {
                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause}),
                 added AS (SELECT 'Added' as _diff_status, * FROM tbl_feat EXCEPT DISTINCT SELECT 'Added', * FROM tbl_tgt),
                 removed AS (SELECT 'Removed' as _diff_status, * FROM tbl_tgt EXCEPT DISTINCT SELECT 'Removed', * FROM tbl_feat)
                 SELECT * FROM added UNION ALL SELECT * FROM removed
                 `;
            } else if (pkCols.length === 0) {
                 // Fall back to EXCEPT DISTINCT without primary keys
                 const structFieldsSource = commonColNames.map(c => `\`${c}\``).join(', ');

                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause}),

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
                 `;
            } else {
                 // FULL OUTER JOIN on Primary Keys (target and source PKs paired positionally)
                 const pkJoinCondition = targetPkCols.map((pk, i) => `tbl_tgt.\`${pk}\` = tbl_feat.\`${sourcePkCols[i] ?? pk}\``).join(' AND ');

                 const pkCoalesceParts = targetPkCols.map((pk, i) => {
                     const sPk = sourcePkCols[i] ?? pk;
                     const isComplex = targetSchemaCols.find(t => t.column_name === pk)?.data_type.match(/^(STRUCT|ARRAY)/i);
                     const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                     const asString = isComplex ? '' : ' AS STRING';
                     return `COALESCE(${castFunc}(tbl_tgt.\`${pk}\`${asString}), ${castFunc}(tbl_feat.\`${sPk}\`${asString}))`;
                 });
                 const pkOrderStr = pkCoalesceParts.length > 1 ? `CONCAT(${pkCoalesceParts.join(", '-', ")})` : pkCoalesceParts[0];

                 const diffConditionParts = commonColNames.filter(c => !pkCols.includes(c)).map(c => {
                     const tType = targetSchemaCols.find(t => t.column_name === c)?.data_type || '';
                     const sType = sourceSchemaCols.find(s => s.column_name === c)?.data_type || '';
                     const isComplex = tType.match(/^(STRUCT|ARRAY)/i) || sType.match(/^(STRUCT|ARRAY)/i);
                     const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                     const asString = isComplex ? '' : ' AS STRING';
                     return `IFNULL(${castFunc}(tbl_tgt.\`${c}\`${asString}), '<null>') != IFNULL(${castFunc}(tbl_feat.\`${c}\`${asString}), '<null>')`;
                 });
                 
                 const finalDiffCondition = diffConditionParts.length > 0 ? `(${diffConditionParts.join(' OR ')})` : 'FALSE';

                 const selectColumns = commonColNames.map(c => `tbl_tgt.\`${c}\` as \`base_${c}\`, tbl_feat.\`${c}\` as \`feat_${c}\``).join(', ');

                 // Build _changed_columns: comma-separated list of column names that differ on each row
                 const nonPkCols = commonColNames.filter(c => !pkCols.includes(c));
                 const changedColsIfs = nonPkCols.map(c => {
                     const tType = targetSchemaCols.find((t: any) => t.column_name === c)?.data_type || '';
                     const sType = sourceSchemaCols.find((s: any) => s.column_name === c)?.data_type || '';
                     const isComplex = tType.match(/^(STRUCT|ARRAY)/i) || sType.match(/^(STRUCT|ARRAY)/i);
                     const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                     const asString = isComplex ? '' : ' AS STRING';
                     return `IF(IFNULL(${castFunc}(tbl_tgt.\`${c}\`${asString}), '<null>') != IFNULL(${castFunc}(tbl_feat.\`${c}\`${asString}), '<null>'), '${c}', NULL)`;
                 });
                 const changedColumnsExpr = changedColsIfs.length > 0
                     ? `(SELECT STRING_AGG(col, ', ' ORDER BY col) FROM UNNEST([${changedColsIfs.join(', ')}]) AS col WHERE col IS NOT NULL)`
                     : `CAST(NULL AS STRING)`;

                 comparisonQuery = `
                 WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                 tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause})

                 SELECT
                    ${pkOrderStr} as _pk,
                    CASE
                        WHEN tbl_tgt.\`${targetPkCols[0]}\` IS NULL THEN 'Added'
                        WHEN tbl_feat.\`${sourcePkCols[0] ?? targetPkCols[0]}\` IS NULL THEN 'Removed'
                        ELSE 'Modified'
                    END as _diff_status,
                    ${changedColumnsExpr} AS _changed_columns,
                    ${selectColumns}
                 FROM tbl_tgt
                 FULL OUTER JOIN tbl_feat ON ${pkJoinCondition}
                 WHERE
                    (tbl_tgt.\`${targetPkCols[0]}\` IS NULL OR tbl_feat.\`${sourcePkCols[0] ?? targetPkCols[0]}\` IS NULL)
                    OR
                    (${finalDiffCondition})
                 `;
            }

            comparisonQuery = formatSqlQuery(comparisonQuery);

            const diffColsSelects = pkCols.length > 0
                ? commonColNames.filter((c: string) => !pkCols.includes(c)).map((c: string) => {
                    const tType = targetSchemaCols.find((t: any) => t.column_name === c)?.data_type || '';
                    const sType = sourceSchemaCols.find((s: any) => s.column_name === c)?.data_type || '';
                    const isComplex = tType.match(/^(STRUCT|ARRAY)/i) || sType.match(/^(STRUCT|ARRAY)/i);
                    const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                    const asString = isComplex ? '' : ' AS STRING';
                    return `COUNTIF(IFNULL(${castFunc}(\`base_${c}\`${asString}), '<null>') != IFNULL(${castFunc}(\`feat_${c}\`${asString}), '<null>')) as \`diff_${c}\``;
                  }).join(', ') 
                : '';

            const summaryQuery = pkCols.length > 0 && diffColsSelects ? `
            SELECT _diff_status, COUNT(*) as row_count,
            ${diffColsSelects}
            FROM (${comparisonQuery})
            GROUP BY _diff_status
            ` : `
            SELECT _diff_status, COUNT(*) as row_count
            FROM (${comparisonQuery})
            GROUP BY _diff_status
            `;

            // Execute the query
            try {
                logger.info(`Executing data diff query for ${file}`);
                const [rows] = await bqClient.query(summaryQuery);
                
                let addedCount = 0;
                let removedCount = 0;
                let modifiedCount = 0;
                const changedColumns: Record<string, number> = {};

                rows.forEach((r: any) => {
                    const count = Number(r.row_count || 0);
                    if (r._diff_status === 'Added') { addedCount += count; }
                    if (r._diff_status === 'Removed') { removedCount += count; }
                    if (r._diff_status === 'Modified' || r._diff_status === 'Modified (+)') { 
                        modifiedCount += count; 
                        if (pkCols.length > 0) {
                             commonColNames.filter((c: string) => !pkCols.includes(c)).forEach((c: string) => {
                                 const diffCountForCol = Number(r[`diff_${c}`] || 0);
                                 if (diffCountForCol > 0) {
                                     changedColumns[c] = diffCountForCol;
                                 }
                             });
                        }
                    }
                });

                const schemaAddedCols = sourceSchemaCols.map((c: any) => c.column_name).filter((c: string) => !targetSchemaCols.find((t: any) => t.column_name === c));
                const schemaRemovedCols = targetSchemaCols.map((c: any) => c.column_name).filter((c: string) => !sourceSchemaCols.find((s: any) => s.column_name === c));

                diffResults.push({
                     file,
                     addedCount,
                     removedCount,
                     modifiedCount,
                     changedColumns,
                     schemaAddedCols,
                     schemaRemovedCols,
                     comparisonQuery,
                     rows: [],
                     baseTableName,
                     featTableName,
                     baseTableFullName: `${targetDatabase}.${targetSchema}.${baseTableName}`,
                     featTableFullName: `${targetDatabase}.${targetSchema}.${featTableName}`,
                     baseLastModified,
                     featLastModified,
                     targetFilter: targetFilter || null,
                     sourceFilter: sourceFilter || null,
                     pkCols,
                     commonColNames,
                     isPairedDiff: pkCols.length > 0
                });
            } catch (queryErr: any) {
                 const errMsg = queryErr?.errors?.[0]?.message || queryErr?.message || String(queryErr);
                 logger.error(`Error executing diff query: ${errMsg}`);
                 diffResults.push({
                     file,
                     error: `Error diffing table data: ${errMsg}`,
                     comparisonQuery,
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

export async function previewDiffModels(
    sourceBranch: string, 
    targetBranch: string, 
    tablePrefix: string,
    panel: vscode.WebviewPanel
) {
    try {
        const gitService = new GitService();
        const modifiedFiles = await gitService.getModifiedFilesBetweenBranches(sourceBranch, targetBranch);
        
        if (modifiedFiles.length === 0) {
            panel.webview.postMessage({ command: 'diffModelsPreview', data: [] });
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            panel.webview.postMessage({ command: 'diffModelsPreview', data: [] });
            return;
        }
        const workspaceFolder = workspaceFolders[0].uri.fsPath;

        const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
        
        if (!dataformCompiledJson) {
            panel.webview.postMessage({ command: 'diffModelsPreview', data: [] });
            return;
        }

        const bqClient = getBigQueryClient();

        const previewResults = [];
        for (const file of modifiedFiles) {
            const matchingTable = dataformCompiledJson.tables.find((t: any) => file.endsWith(t.fileName));
            if (!matchingTable) continue;

            const workspacePrefix = (dataformCompiledJson.projectConfig as any)?.tablePrefix || (dataformCompiledJson.projectConfig as any)?.defaultTablePrefix;
            const targetNameSource = matchingTable.target.name;
            let rawTableName = targetNameSource;

            if (workspacePrefix && typeof workspacePrefix === 'string') {
                if (rawTableName.startsWith(`${workspacePrefix}_`)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length + 1);
                } else if (rawTableName.startsWith(workspacePrefix)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length);
                }
            }

            const targetSchema = matchingTable.target.schema;
            const baseTableName = rawTableName;
            const featTableName = tablePrefix ? `${tablePrefix}${tablePrefix.endsWith('_') ? '' : '_'}${rawTableName}` : rawTableName;

            let targetColumns: string[] = [];
            let sourceColumns: string[] = [];
            let baseExists = false;
            let featExists = false;
            if (bqClient) {
                const [baseMeta, featMeta, baseEx, featEx] = await Promise.all([
                    bqClient.dataset(targetSchema).table(baseTableName).getMetadata().then(([m]: any) => m).catch(() => null),
                    bqClient.dataset(targetSchema).table(featTableName).getMetadata().then(([m]: any) => m).catch(() => null),
                    bqClient.dataset(targetSchema).table(baseTableName).exists().then(([e]: any) => e).catch(() => false),
                    bqClient.dataset(targetSchema).table(featTableName).exists().then(([e]: any) => e).catch(() => false),
                ]);
                targetColumns = baseMeta?.schema?.fields?.map((f: any) => f.name) ?? [];
                sourceColumns = featMeta?.schema?.fields?.map((f: any) => f.name) ?? [];
                baseExists = baseEx;
                featExists = featEx;
            }

            previewResults.push({
                file,
                baseTableName: `${matchingTable.target.database}.${matchingTable.target.schema}.${baseTableName}`,
                featTableName: `${matchingTable.target.database}.${matchingTable.target.schema}.${featTableName}`,
                columns: Array.from(new Set([...targetColumns, ...sourceColumns])),
                targetColumns,
                sourceColumns,
                baseExists,
                featExists,
            });
        }

        panel.webview.postMessage({ command: 'diffModelsPreview', data: previewResults });
    } catch (e: any) {
        logger.error(`Error previewing data diff models: ${e.message}`);
        panel.webview.postMessage({ command: 'diffModelsPreview', data: [] });
    }
}

export async function dryRunSingleModel(
    sourceBranch: string,
    targetBranch: string,
    tablePrefix: string,
    targetPrimaryKeysMap: Record<string, string>,
    sourcePrimaryKeysMap: Record<string, string>,
    targetFilterMap: Record<string, string>,
    sourceFilterMap: Record<string, string>,
    excludeColumnsMap: Record<string, string>,
    panel: vscode.WebviewPanel,
    files: string[]
) {
    try {
        const gitService = new GitService();
        const modifiedFiles = await gitService.getModifiedFilesBetweenBranches(sourceBranch, targetBranch);

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            panel.webview.postMessage({ command: 'dryRunError', data: { file: files[0], error: 'No workspace folder open.' } });
            return;
        }
        const workspaceFolder = workspaceFolders[0].uri.fsPath;

        const dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);
        if (!dataformCompiledJson) {
            panel.webview.postMessage({ command: 'dryRunError', data: { file: files[0], error: 'Failed to compile Dataform workspace.' } });
            return;
        }

        const bqClient = getBigQueryClient();
        if (!bqClient) {
            panel.webview.postMessage({ command: 'dryRunError', data: { file: files[0], error: 'BigQuery client is not initialized.' } });
            return;
        }

        const filesToProcess = files ? modifiedFiles.filter(f => files.includes(f)) : modifiedFiles;

        for (const file of filesToProcess) {
            const matchingTable = dataformCompiledJson.tables.find((t: any) => file.endsWith(t.fileName));
            if (!matchingTable) {
                panel.webview.postMessage({ command: 'dryRunError', data: { file, error: `Could not find compiled table for file: ${file}` } });
                continue;
            }

            const targetDatabase = matchingTable.target.database;
            const targetSchema = matchingTable.target.schema;
            const targetNameSource = matchingTable.target.name;

            const workspacePrefix = (dataformCompiledJson.projectConfig as any)?.tablePrefix || (dataformCompiledJson.projectConfig as any)?.defaultTablePrefix;
            let rawTableName = targetNameSource;
            if (workspacePrefix && typeof workspacePrefix === 'string') {
                if (rawTableName.startsWith(`${workspacePrefix}_`)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length + 1);
                } else if (rawTableName.startsWith(workspacePrefix)) {
                    rawTableName = rawTableName.slice(workspacePrefix.length);
                }
            }

            const baseTableName = rawTableName;
            const featTableName = tablePrefix ? `${tablePrefix}${tablePrefix.endsWith('_') ? '' : '_'}${rawTableName}` : rawTableName;

            const [targetExists] = await bqClient.dataset(targetSchema).table(baseTableName).exists();
            const [sourceExists] = await bqClient.dataset(targetSchema).table(featTableName).exists();

            if (!targetExists || !sourceExists) {
                panel.webview.postMessage({ command: 'dryRunError', data: { file, error: `Tables not materialized. Target exists: ${targetExists}, Source exists: ${sourceExists}` } });
                continue;
            }

            let targetSchemaCols: any[] = [];
            let sourceSchemaCols: any[] = [];

            try {
                const targetSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${baseTableName}'`;
                const sourceSchemaQuery = `SELECT column_name, data_type FROM \`${targetDatabase}.${targetSchema}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = '${featTableName}'`;
                const [targetCols, sourceCols] = await Promise.all([
                    bqClient.query(targetSchemaQuery).then(([r]: any) => r),
                    bqClient.query(sourceSchemaQuery).then(([r]: any) => r),
                ]);
                targetSchemaCols = targetCols;
                sourceSchemaCols = sourceCols;
            } catch (err: any) {
                panel.webview.postMessage({ command: 'dryRunError', data: { file, error: `Error fetching schema: ${err.message}` } });
                continue;
            }

            const excludeCols = (excludeColumnsMap[file] || '').split(',').map((k: string) => k.trim()).filter(Boolean);
            const allColNames = Array.from(new Set([
                ...targetSchemaCols.map(c => c.column_name),
                ...sourceSchemaCols.map(c => c.column_name)
            ])).filter((c: string) => !excludeCols.includes(c));

            const buildSelectList = (tableCols: any[], isTarget: boolean) => {
                const colNames = tableCols.map(c => c.column_name);
                return allColNames.map(col => {
                    const tCol = targetSchemaCols.find(c => c.column_name === col);
                    const sCol = sourceSchemaCols.find(c => c.column_name === col);
                    const type = (isTarget ? tCol : sCol)?.data_type || tCol?.data_type || sCol?.data_type || 'STRING';
                    const isComplex = type.match(/^(STRUCT|ARRAY)/i);
                    if (colNames.includes(col)) {
                        if (isComplex) { return `TO_JSON_STRING(\`${col}\`) AS \`${col}\``; }
                        if (tCol && sCol && tCol.data_type !== sCol.data_type) { return `CAST(\`${col}\` AS STRING) AS \`${col}\``; }
                        return `\`${col}\``;
                    }
                    if (isComplex || (tCol && sCol && tCol.data_type !== sCol.data_type)) { return `CAST(NULL AS STRING) AS \`${col}\``; }
                    return `CAST(NULL as ${type}) AS \`${col}\``;
                }).join(', ');
            };

            const sourceSelectList = buildSelectList(sourceSchemaCols, false);
            const targetSelectList = buildSelectList(targetSchemaCols, true);
            const commonColNames = targetSchemaCols.map(c => c.column_name).filter(c => sourceSchemaCols.find(s => s.column_name === c) && !excludeCols.includes(c));

            const targetPrimaryKeys = targetPrimaryKeysMap[file] || '';
            const sourcePrimaryKeys = sourcePrimaryKeysMap[file] || '';
            const defaultPks: string[] = (matchingTable as any).uniqueKey || [];
            const targetPkCols: string[] = targetPrimaryKeys ? targetPrimaryKeys.split(',').map((k: string) => k.trim()).filter(Boolean) : defaultPks;
            const sourcePkCols: string[] = sourcePrimaryKeys ? sourcePrimaryKeys.split(',').map((k: string) => k.trim()).filter(Boolean) : (targetPrimaryKeys ? targetPkCols : defaultPks);
            const pkCols: string[] = targetPkCols;

            const targetFilter = targetFilterMap[file] || '';
            const sourceFilter = sourceFilterMap[file] || '';
            const targetWhereClause = targetFilter ? ` WHERE ${targetFilter}` : '';
            const sourceWhereClause = sourceFilter ? ` WHERE ${sourceFilter}` : '';

            let comparisonQuery = '';

            if (commonColNames.length === 0) {
                comparisonQuery = `
                WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause}),
                added AS (SELECT 'Added' as _diff_status, * FROM tbl_feat EXCEPT DISTINCT SELECT 'Added', * FROM tbl_tgt),
                removed AS (SELECT 'Removed' as _diff_status, * FROM tbl_tgt EXCEPT DISTINCT SELECT 'Removed', * FROM tbl_feat)
                SELECT * FROM added UNION ALL SELECT * FROM removed
                `;
            } else if (pkCols.length === 0) {
                const structFieldsSource = commonColNames.map(c => `\`${c}\``).join(', ');
                comparisonQuery = `
                WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause}),
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
                `;
            } else {
                const pkJoinCondition = targetPkCols.map((pk, i) => `tbl_tgt.\`${pk}\` = tbl_feat.\`${sourcePkCols[i] ?? pk}\``).join(' AND ');
                const pkCoalesceParts = targetPkCols.map((pk, i) => {
                    const sPk = sourcePkCols[i] ?? pk;
                    const isComplex = targetSchemaCols.find(t => t.column_name === pk)?.data_type.match(/^(STRUCT|ARRAY)/i);
                    const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                    const asString = isComplex ? '' : ' AS STRING';
                    return `COALESCE(${castFunc}(tbl_tgt.\`${pk}\`${asString}), ${castFunc}(tbl_feat.\`${sPk}\`${asString}))`;
                });
                const pkOrderStr = pkCoalesceParts.length > 1 ? `CONCAT(${pkCoalesceParts.join(", '-', ")})` : pkCoalesceParts[0];
                const diffConditionParts = commonColNames.filter(c => !pkCols.includes(c)).map(c => {
                    const tType = targetSchemaCols.find(t => t.column_name === c)?.data_type || '';
                    const sType = sourceSchemaCols.find(s => s.column_name === c)?.data_type || '';
                    const isComplex = tType.match(/^(STRUCT|ARRAY)/i) || sType.match(/^(STRUCT|ARRAY)/i);
                    const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                    const asString = isComplex ? '' : ' AS STRING';
                    return `IFNULL(${castFunc}(tbl_tgt.\`${c}\`${asString}), '<null>') != IFNULL(${castFunc}(tbl_feat.\`${c}\`${asString}), '<null>')`;
                });
                const finalDiffCondition = diffConditionParts.length > 0 ? `(${diffConditionParts.join(' OR ')})` : 'FALSE';
                const selectColumns = commonColNames.map(c => `tbl_tgt.\`${c}\` as \`base_${c}\`, tbl_feat.\`${c}\` as \`feat_${c}\``).join(', ');
                const nonPkCols = commonColNames.filter(c => !pkCols.includes(c));
                const changedColsIfs = nonPkCols.map(c => {
                    const tType = targetSchemaCols.find((t: any) => t.column_name === c)?.data_type || '';
                    const sType = sourceSchemaCols.find((s: any) => s.column_name === c)?.data_type || '';
                    const isComplex = tType.match(/^(STRUCT|ARRAY)/i) || sType.match(/^(STRUCT|ARRAY)/i);
                    const castFunc = isComplex ? 'TO_JSON_STRING' : 'CAST';
                    const asString = isComplex ? '' : ' AS STRING';
                    return `IF(IFNULL(${castFunc}(tbl_tgt.\`${c}\`${asString}), '<null>') != IFNULL(${castFunc}(tbl_feat.\`${c}\`${asString}), '<null>'), '${c}', NULL)`;
                });
                const changedColumnsExpr = changedColsIfs.length > 0
                    ? `(SELECT STRING_AGG(col, ', ' ORDER BY col) FROM UNNEST([${changedColsIfs.join(', ')}]) AS col WHERE col IS NOT NULL)`
                    : `CAST(NULL AS STRING)`;
                comparisonQuery = `
                WITH tbl_feat AS (SELECT ${sourceSelectList} FROM \`${targetDatabase}.${targetSchema}.${featTableName}\`${sourceWhereClause}),
                tbl_tgt AS (SELECT ${targetSelectList} FROM \`${targetDatabase}.${targetSchema}.${baseTableName}\`${targetWhereClause})
                SELECT
                   ${pkOrderStr} as _pk,
                   CASE
                       WHEN tbl_tgt.\`${targetPkCols[0]}\` IS NULL THEN 'Added'
                       WHEN tbl_feat.\`${sourcePkCols[0] ?? targetPkCols[0]}\` IS NULL THEN 'Removed'
                       ELSE 'Modified'
                   END as _diff_status,
                   ${changedColumnsExpr} AS _changed_columns,
                   ${selectColumns}
                FROM tbl_tgt
                FULL OUTER JOIN tbl_feat ON ${pkJoinCondition}
                WHERE
                   (tbl_tgt.\`${targetPkCols[0]}\` IS NULL OR tbl_feat.\`${sourcePkCols[0] ?? targetPkCols[0]}\` IS NULL)
                   OR
                   (${finalDiffCondition})
                `;
            }

            comparisonQuery = formatSqlQuery(comparisonQuery);

            try {
                logger.info(`Dry running diff query for ${file}`);
                const dryRunResponse = await queryDryRun(comparisonQuery);
                if (dryRunResponse.error.hasError) {
                    panel.webview.postMessage({ command: 'dryRunError', data: { file, error: dryRunResponse.error.message } });
                } else {
                    panel.webview.postMessage({
                        command: 'dryRunResult',
                        data: {
                            file,
                            query: comparisonQuery,
                            bytesProcessed: dryRunResponse.statistics?.totalBytesProcessed ?? 0,
                            cost: dryRunResponse.statistics?.cost,
                        }
                    });
                }
            } catch (err: any) {
                panel.webview.postMessage({ command: 'dryRunError', data: { file, error: err.message } });
            }
        }
    } catch (e: any) {
        logger.error(`Error in dry run orchestration: ${e.message}`);
        panel.webview.postMessage({ command: 'dryRunError', data: { file: files[0], error: e.message } });
    }
}
