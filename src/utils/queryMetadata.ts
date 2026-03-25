import * as vscode from 'vscode';
import path from 'path';
import { logger } from '../logger';
import { DataformCompiledJson, TablesWtFullQuery, Table, Operation, Assertion, Notebook } from '../types';

function createQueryMetaErrorString(modelObj: Table | Operation | Assertion, relativeFilePath: string, modelObjType: string, isJsFile: boolean) {
    return isJsFile
        ? ` Query could not be determined for ${modelObjType} in  ${relativeFilePath} <br>
        Canonical target: ${modelObj.canonicalTarget.database}.${modelObj.canonicalTarget.schema}.${modelObj.canonicalTarget.name} <br>
        <a href="https://cloud.google.com/dataform/docs/javascript-in-dataform#set-object-properties">Check if the sytax used for publish, operate, assert in js file is correct here.</a> <br>
    `
        : ` Query could not be determined for  ${relativeFilePath} <br>.
        Canonical target: ${modelObj.canonicalTarget.database}.${modelObj.canonicalTarget.schema}.${modelObj.canonicalTarget.name} <br>
    `;
}

function parseNotebookFilenames(content: string): string[] {
  const filenames: string[] = [];

  const matches = content.match(/notebook\(\s*\{[\s\S]*?\}\s*\)/g);

  if (matches) {
    for (const match of matches) {
      // Extract the content inside the notebook(...) block
      const innerContentMatch = match.match(/\{\s*([\s\S]*?)\s*\}/);
      if (innerContentMatch) {
        const innerContent = innerContentMatch[1];

        // Match the filename property
        const filenameMatch = innerContent.match(/filename\s*:\s*['"]([^'"]+)['"]/);
        if (filenameMatch) {
          filenames.push(filenameMatch[1]);
        }
      }
    }
  }

  return filenames;
}

// Optimized getQueryMetaForCurrentFile using FILE_NODE_MAP cache
export async function getQueryMetaForCurrentFile(relativeFilePath: string, compiledJson: DataformCompiledJson, workspaceFolder:string): Promise<TablesWtFullQuery> {

    const { notebooks } = compiledJson;

    let queryMeta = {
        type: "",
        incrementalPreOpsQuery: "",
        preOpsQuery: "",
        postOpsQuery: "",
        assertionQuery: "",
        assertionQueries: [] as { targetName: string; query: string }[],
        tableQueries: [] as { targetName: string; query: string; preOpsQuery: string }[],
        incrementalQueries: [] as { targetName: string; incrementalQuery: string; nonIncrementalQuery: string; preOpsQuery: string; incrementalPreOpsQuery: string }[],
        operationQueries: [] as { targetName: string; query: string; preOpsQuery: string }[],
        operationsQuery: "",
        testQuery: "",
        expectedOutputQuery: "",
        testQueries: [] as { name: string; testQuery: string; expectedOutputQuery: string }[],
        error: "",
    };
    let finalTables: any[] = [];

    const isJsFile = relativeFilePath.endsWith('.js');
    const isSqlxFile = relativeFilePath.endsWith('.sqlx');

    if (isJsFile) {
        queryMeta.type = "js";
    }

    // O(1) Lookup from cache
    const fileNodes = FILE_NODE_MAP.get(relativeFilePath) || [];

    if (fileNodes.length > 0) {
        // 1. Tables/Views/Incremental
        // Cast to 'any' to safely check 'type' as Notebook doesn't have it in type definition
        const tableNodes = fileNodes.filter((n: any) => !n.type || n.type === 'table' || n.type === 'view' || n.type === 'incremental') as Table[];
        if (tableNodes.length > 0) {
            logger.debug(`Found ${tableNodes.length} table(s) with filename: ${relativeFilePath}`);
            if(queryMeta.type !== "js"){
                // Default to table if type is entirely missing, otherwise use the found type
                queryMeta.type = tableNodes[0].type || "table";
            }

            tableNodes.forEach(table => {
                const tableTypeToUse = table.type || "table";
                switch (tableTypeToUse) {
                    case "table":
                    case "view":
                        if (!table?.query) {
                            // queryMeta.tableOrViewQuery = "";
                            queryMeta.error += createQueryMetaErrorString(table, relativeFilePath, tableTypeToUse, isJsFile);
                        } else {
                            const curTableQuery  = (table.query.trimStart() !== "" ? table.query.trimStart() + "\n;" : "");
                            queryMeta.tableQueries.push({
                                targetName: `${table.target.database}.${table.target.schema}.${table.target.name}`,
                                query: curTableQuery,
                                preOpsQuery: table.preOps?.join("\n") ?? "",
                            });
                        }
                        break;
                    case "incremental":
                        if (table.incrementalPreOps) {
                            queryMeta.incrementalPreOpsQuery += (queryMeta.incrementalPreOpsQuery ? "\n" : "") + table.incrementalPreOps.join("\n") + "\n";
                        }
                        queryMeta.incrementalQueries.push({
                            targetName: `${table.target.database}.${table.target.schema}.${table.target.name}`,
                            incrementalQuery: table.incrementalQuery ?? "",
                            nonIncrementalQuery: table.query ?? "",
                            preOpsQuery: table.preOps?.join("\n") ?? "",
                            incrementalPreOpsQuery: table.incrementalPreOps?.join("\n") ?? "",
                        });
                        break;
                    default:
                        logger.debug(`Unexpected table type: ${tableTypeToUse}`);
                }

                if (table.preOps) {
                    queryMeta.preOpsQuery += (queryMeta.preOpsQuery ? "\n" : "") + table.preOps.join("\n") + "\n";
                }
                if (table.postOps) {
                    queryMeta.postOpsQuery += (queryMeta.postOpsQuery ? "\n" : "") + table.postOps.join("\n") + "\n";
                }

                finalTables.push({
                    type: tableTypeToUse,
                    tags: table.tags,
                    fileName: relativeFilePath,
                    target: table.target,
                    query: table.query ?? "",
                    preOps: table.preOps,
                    postOps: table.postOps,
                    dependencyTargets: table.dependencyTargets,
                    incrementalQuery: table.incrementalQuery ?? "",
                    incrementalPreOps: table.incrementalPreOps ?? [],
                    actionDescriptor: table.actionDescriptor
                });
            });
        }

        // 2. Assertions
        const assertionNodes = fileNodes.filter((n: any) => n.type === 'assertion') as Assertion[];
        if (assertionNodes.length > 0) {
            // Logic regarding type setting
            if(queryMeta.type !== "js" && queryMeta.tableQueries.length === 0 && queryMeta.incrementalQueries.length === 0) {
                queryMeta.type = "assertion";
            }

            assertionNodes.forEach((assertion, index) => {
                if (assertion?.query) {
                    finalTables.push({
                        type: "assertion",
                        tags: assertion.tags,
                        fileName: relativeFilePath,
                        query: assertion.query,
                        target: assertion.target,
                        dependencyTargets: assertion.dependencyTargets,
                        incrementalQuery: "",
                        incrementalPreOps: []
                    });
                    logger.debug(`Assertion found: ${assertion.fileName}`);
                    queryMeta.assertionQuery += `\n -- Assertions: [${index + 1}] \n${assertion.query.trimStart()}; \n`;
                    queryMeta.assertionQueries.push({
                        targetName: `${assertion.target.database}.${assertion.target.schema}.${assertion.target.name}`,
                        query: assertion.query.trimStart(),
                    });
                } else {
                    let errorString = createQueryMetaErrorString(assertion, relativeFilePath, "assertions", isJsFile);
                    queryMeta.error += errorString;
                    finalTables.push({
                        type: "assertion",
                        tags: assertion.tags,
                        fileName: relativeFilePath,
                        query: assertion.query,
                        target: assertion.target,
                        dependencyTargets: assertion.dependencyTargets,
                        incrementalQuery: "",
                        incrementalPreOps: [],
                        error: errorString
                    });
                    logger.debug(`Assertion found: ${assertion.fileName}`);
                    logger.debug(`Error in assertion: ${errorString}`);
                    queryMeta.assertionQuery += `\n -- Assertions: [${index + 1}] \n ${errorString}; \n`;
                }
            });
        }

        // 3. Operations
        const operationNodes = fileNodes.filter((n: any) => n.type === 'operations') as Operation[];
        if (operationNodes.length > 0) {
             if ((isSqlxFile && finalTables.length === 0) || isJsFile) {
                logger.debug(`Found ${operationNodes.length} operation(s) with filename: ${relativeFilePath}`);
                if(queryMeta.type !== "js"){
                    queryMeta.type = "operations";
                }

                operationNodes.forEach(operation => {
                    if (operation?.queries) {
                        const finalOperationQuery = operation.queries.reduce((acc, query, index) => {
                            return acc + `\n -- Operations: [${index + 1}] \n${query}\n`;
                        }, "");

                        queryMeta.operationsQuery += finalOperationQuery;
                        queryMeta.operationQueries.push({
                            targetName: `${operation.target.database}.${operation.target.schema}.${operation.target.name}`,
                            query: finalOperationQuery,
                            preOpsQuery: operation.preOps?.join("\n") ?? "",
                        });

                        finalTables.push({
                            type: "operations",
                            tags: operation.tags,
                            fileName: relativeFilePath,
                            query: finalOperationQuery,
                            target: operation.target,
                            dependencyTargets: operation.dependencyTargets,
                            incrementalQuery: "",
                            incrementalPreOps: []
                        });
                    } else {
                        let errorString = createQueryMetaErrorString(operation, relativeFilePath, "operations", isJsFile);
                        queryMeta.error += errorString;
                        finalTables.push({
                            type: "operations",
                            tags: operation.tags,
                            fileName: relativeFilePath,
                            query: undefined,
                            target: operation.target,
                            dependencyTargets: operation.dependencyTargets,
                            incrementalQuery: "",
                            incrementalPreOps: [],
                            error: errorString,
                        });
                    }
                });
             }
        }

        // 4. Tests
        const testNodes = fileNodes.filter((n: any) => n.type === 'test') as any[];
        if (testNodes.length > 0) {
            if (queryMeta.type === "" || (queryMeta.type === "js" && finalTables.length === 0)) {
                queryMeta.type = "test";
            }

            testNodes.forEach((test, index) => {
                const testLabel = ` -- Test: [${index + 1}] ${test.name || ""} \n`;
                if (test.testQuery) {
                    queryMeta.testQuery += (queryMeta.testQuery ? "\n" : "") + testLabel + test.testQuery + "\n ;";
                }
                if (test.expectedOutputQuery) {
                    queryMeta.expectedOutputQuery += (queryMeta.expectedOutputQuery ? "\n" : "") + testLabel + test.expectedOutputQuery + "\n ;";
                }

                queryMeta.testQueries.push({ name: test.name, testQuery: test.testQuery, expectedOutputQuery: test.expectedOutputQuery });
                finalTables.push({
                    type: "test",
                    name: test.name,
                    fileName: relativeFilePath,
                    testQuery: test.testQuery,
                    expectedOutputQuery: test.expectedOutputQuery,
                    target: test.target // dataset name
                });
            });
        }
    }

    // 4. Notebooks (Special JS parsing logic retained)
    if(notebooks && notebooks.length > 0 && workspaceFolder && isJsFile){
        const fileContents = await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(workspaceFolder, relativeFilePath)));
        const content = Buffer.from(fileContents).toString('utf8');
        const fileNames = parseNotebookFilenames(content);

        notebooks.forEach((notebook: Notebook) => {
            const notebookFileName = notebook.fileName;
            for (const fileName of fileNames){
                if(notebookFileName.endsWith(fileName) || notebookFileName === fileName){

                    const tableFound = {
                        type: "notebook",
                        query: `Open: ${notebook.fileName} \n`,
                        tags: notebook.tags,
                        fileName: notebook.fileName,
                        target: notebook.target,
                        preOps: undefined,
                        postOps: undefined,
                        dependencyTargets: notebook.dependencyTargets,
                        incrementalQuery: undefined,
                        incrementalPreOps: undefined,
                        actionDescriptor: undefined,
                    };
                    finalTables.push(tableFound);

                    queryMeta.type = "notebook";
                }
            }
      });
    }
    return { tables: finalTables, queryMeta: queryMeta };
}

export async function getDataformTags(compiledJson: DataformCompiledJson) {
    let dataformTags: string[] = [];
    let tables = compiledJson?.tables;
    if (tables) {
        tables.forEach((table) => {
            table?.tags?.forEach((tag) => {
                if (dataformTags.includes(tag) === false) {
                    dataformTags.push(tag);
                }
            });
        });
    };
    let assertions = compiledJson?.assertions;
    if (assertions) {
        assertions.forEach((assertion) => {
            assertion?.tags?.forEach((tag) => {
                if (dataformTags.includes(tag) === false) {
                    dataformTags.push(tag);
                }
            });
        });
    }
    return dataformTags.sort();
}

export async function getDependenciesAutoCompletionItems(compiledJson: DataformCompiledJson) {

    let sourceAutoCompletionPreference = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sourceAutoCompletionPreference');

    let targets = compiledJson.targets;
    let declarations = compiledJson.declarations;
    let dependencySet = new Set<string>();

    if (sourceAutoCompletionPreference === "${ref('table_name')}") {
        if (targets?.length) {
            for (let i = 0; i < targets.length; i++) {
                dependencySet.add(targets[i].name);
            }
        }

        if (declarations?.length) {
            for (let i = 0; i < declarations.length; i++) {
                dependencySet.add(declarations[i].target.name);
            }
        }
    } else {
        if (targets?.length) {
            for (let i = 0; i < targets.length; i++) {
                dependencySet.add(`${targets[i].schema}.${targets[i].name}`);
            }
        }
        if (declarations?.length) {
            for (let i = 0; i < declarations.length; i++) {
                dependencySet.add(`${declarations[i].target.schema}.${declarations[i].target.name}`);
            }
        }
    }
    return Array.from(dependencySet);
}
