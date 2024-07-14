import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { DataformCompiledJson, ConfigBlockMetadata, Table, TablesWtFullQuery } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { setDiagnostics } from './setDiagnostics';
import { assertionQueryOffset } from './constants';
export let CACHED_COMPILED_DATAFORM_JSON:DataformCompiledJson;

let supportedExtensions = ['sqlx', 'js'];

export let declarationsAndTargets: string[] = [];

export function executableIsAvailable(name: string) {
    const shell = (cmd: string) => execSync(cmd, { encoding: 'utf8' });
    try { shell(`which ${name}`); return true; }
    catch (error) {
        if (name === 'formatdataform') {
            vscode.window.showWarningMessage('Install formatdataform to enable sqlfluff formatting');
            return;
        } else {
            vscode.window.showErrorMessage(`${name} cli not found in path`);
        }
        return false;
    }
}

export function getFileNameFromDocument(document: vscode.TextDocument): string[] {
    var filename = document.uri.fsPath;
    let basenameSplit = path.basename(filename).split('.');
    let extension = basenameSplit[1];
    let validFileType = supportedExtensions.includes(extension);
    if (!validFileType) {
        // vscode.window.showWarningMessage(`vscode-dataform-tools extension currently only supports ${supportedExtensions} files`);
        return ["", ""];
    }
    filename = basenameSplit[0];
    return [filename, extension];
}

export function getWorkspaceFolder(): string {
    let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (workspaceFolder !== undefined) {
        if (isDataformWorkspace(workspaceFolder) === false) {
            vscode.window.showWarningMessage(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json`);
            return "";
        }
        return workspaceFolder;
    }
    return "";
}

export function isDataformWorkspace(workspacePath: string) {
    const dataformSignatureFiles = ['workflow_settings.yaml', 'dataform.json'];
    let fileExists = false;

    for (let i = 0; dataformSignatureFiles.length; i++) {
        const filePath = path.join(workspacePath, dataformSignatureFiles[i]);
        let fileExists = fs.existsSync(filePath);
        if (fileExists) {
            return fileExists;
        }
    }
    return fileExists;
}

export function runCommandInTerminal(command: string) {
    if (vscode.window.activeTerminal === undefined) {
        const terminal = vscode.window.createTerminal('dataform');
        terminal.sendText(command);
        terminal.show();
    } else {
        const terminal = vscode.window.activeTerminal;
        vscode.window.activeTerminal.sendText(command);
        terminal.show();
    }
}

/**
    Suggestion if provided from dry is expected to along the lines of

    `googleapi: Error 400: Unrecognized name: MODELID; Did you mean MODEL_ID? at [27:28], invalidQuery`

    From the above string the function attempts to extract the suggestion which we assumed based on observations to be separated by ";"
    followed by `Did you mean **fix**? at [lineNumber:columnNumber]`
**/
export function extractFixFromDiagnosticMessage(diagnosticMessage: string) {
    const diagnosticSuggestion = diagnosticMessage.split(';')[1];

    if (!diagnosticSuggestion) {
        return null;
    }

    const regex = /Did you mean (\w+)\?/;
    const match = diagnosticSuggestion.match(regex);
    const fix = match ? match[1] : null;
    return fix;
}


// Get start and end line number of the config block in the .sqlx file
// This assumes that the user is using config { } block at the top of the .sqlx file
//
// @return [start_of_config_block: number, end_of_config_block: number]
export const getLineNumberWhereConfigBlockTerminates = async (): Promise<ConfigBlockMetadata> => {
    let startOfConfigBlock = 0;
    let endOfConfigBlock = 0;
    let isInInnerConfigBlock = false;
    let innerConfigBlockCount = 0;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return { startLine: 0, endLine: 0 };
    }

    const document = editor.document;
    document.save();
    const totalLines = document.lineCount;

    for (let i = 0; i < totalLines; i++) {
        const lineContents = document.lineAt(i).text;

        if (lineContents.match("config")) {
            startOfConfigBlock = i + 1;
        } else if (lineContents.match("{")) {
            isInInnerConfigBlock = true;
            innerConfigBlockCount += 1;
        } else if (lineContents.match("}") && isInInnerConfigBlock && innerConfigBlockCount >= 1) {
            innerConfigBlockCount -= 1;
        } else if (lineContents.match("}") && innerConfigBlockCount === 0) {
            endOfConfigBlock = i + 1;
            return { startLine: startOfConfigBlock, endLine: endOfConfigBlock };
        }
    }

    return { startLine: startOfConfigBlock, endLine: endOfConfigBlock };
};

export function isNotUndefined(value: unknown): any {
    if (typeof value === undefined) { throw new Error("Not a string"); }
}

export async function writeCompiledSqlToFile(compiledQuery: string, filePath: string) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
    }

    // Write the compiled output to the file
    fs.writeFileSync(filePath, compiledQuery, 'utf8');

    // Open the output file in a vertical split
    const outputDocument = await vscode.workspace.openTextDocument(filePath);
    vscode.window.showTextDocument(outputDocument, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
}

export async function getStdoutFromCliRun(exec: any, cmd: string): Promise<any> {
    // const workingDirectory = path.dirname(vscode.window.activeTextEditor?.document.uri.fsPath);
    let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    if (!workspaceFolder) {
        return;
    }

    return new Promise((resolve, reject) => {

        exec(cmd, { cwd: workspaceFolder }, (err: any, stdout: any, stderr: any) => {
            if (stderr) {
                reject(new Error(stderr));
                return;
            }

            try {
                const output = stdout.toString();
                resolve(output);
            } catch (parseError) {
                reject(parseError);
            }
        });
    });
}

export async function runCurrentFile(includDependencies: boolean, includeDownstreamDependents: boolean) {

    let document = vscode.window.activeTextEditor?.document;
    if (document === undefined) {
        vscode.window.showErrorMessage('No active document');
        return;
    }
    var [filename, extension] = getFileNameFromDocument(document);
    let workspaceFolder = getWorkspaceFolder();

    let tableMetadata;
    let dataformCompiledJson = await runCompilation(workspaceFolder);
    if (dataformCompiledJson) {
        tableMetadata = await getMetadataForCurrentFile(filename, dataformCompiledJson);
    }

    if (tableMetadata) {
        let actionsList: string[] = [];
        for (let i = 0; i < tableMetadata.tables.length; i++) {
            let table = tableMetadata.tables[i];
            let fullTableId = `${table.target.database}.${table.target.schema}.${table.target.name}`;
            actionsList.push(fullTableId);
        }

        let dataformActionCmd = "";

        // create the dataform run command for the list of actions from actionsList
        for (let i = 0; i < actionsList.length; i++) {
            let fullTableName = actionsList[i];
            if (i === 0) {
                if (includDependencies) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --actions "${fullTableName}" --include-deps`);
                } else if (includeDownstreamDependents) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --actions "${fullTableName}" --include-dependents`);
                }
                else {
                    dataformActionCmd = `dataform run ${workspaceFolder} --actions "${fullTableName}"`;
                }
            } else {
                if (includDependencies) {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                } else {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                }
            }
        }
        runCommandInTerminal(dataformActionCmd);
    }
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
    return dataformTags;
}


async function getMetadataForCurrentFile(fileName: string, compiledJson: DataformCompiledJson): Promise<TablesWtFullQuery> {

    let tables = compiledJson.tables;
    let assertions = compiledJson.assertions;
    let operations = compiledJson.operations;
    // let tablePrefix = compiledJson?.projectConfig?.tablePrefix;
    let finalQuery = "";
    let finalTables: Table[] = [];

    if (tables === undefined) {
        return { tables: finalTables, fullQuery: finalQuery };
    }

    for (let i = 0; i < tables.length; i++) {
        let table = tables[i];
        let tableFileName = path.basename(table.fileName).split('.')[0];
        if (fileName === tableFileName) {
            if (table.type === "table" || table.type === "view") {
                finalQuery = table.query + "\n ;";
            } else if (table.type === "incremental") {
                finalQuery += "\n-- Non incremental query \n";
                finalQuery += table.query;
                finalQuery += "; \n-- Incremental query \n";
                finalQuery += table.incrementalQuery;
                if (table?.incrementalPreOps) {
                    table.incrementalPreOps.forEach((query, idx) => {
                        finalQuery += `; \n -- Incremental pre operations: [${idx}] \n`;
                        finalQuery += query;
                    });
                }
            }
            let tableFound = { type: table.type, tags: table.tags, fileName: fileName, query: table.query, target: table.target, dependencyTargets: table.dependencyTargets, incrementalQuery: table?.incrementalQuery ?? "", incrementalPreOps: table?.incrementalPreOps ?? [] };
            finalTables.push(tableFound);
            break;
        }
    }

    if (assertions === undefined) {
        return { tables: finalTables, fullQuery: finalQuery };
    }



    let assertionCountForFile = 0;
    for (let i = 0; i < assertions.length; i++) {
        //TODO: check if we can break early, maybe not as a table can have multiple assertions ?
        let assertion = assertions[i];
        let assertionFileName = path.basename(assertion.fileName).split('.')[0];
        if (assertionFileName === fileName) {
            let assertionFound = { type: "assertion", tags: assertion.tags, fileName: fileName, query: assertion.query, target: assertion.target, dependencyTargets: assertion.dependencyTargets, incrementalQuery: "", incrementalPreOps: [] };
            finalTables.push(assertionFound);
            assertionCountForFile += 1;
            finalQuery += `\n -- Assertions: [${assertionCountForFile}] \n`;
            finalQuery += assertion.query + "\n ;";
        }
    }

    for (let i = 0; i < operations.length; i++){
        let operation = operations[i];
        let operationFileName = path.basename(operation.fileName).split('.')[0];
        if (operationFileName === fileName){
            let operationsCountForFile = 0;
            let opQueries = operation.queries;
            let finalOperationQuery = "";
            for (let i = 0; i < opQueries.length; i++){
                operationsCountForFile += 1;
                finalOperationQuery += `\n -- Operations: [${operationsCountForFile}] \n`;
                finalOperationQuery += opQueries[i] + "\n ;";
            }
            finalQuery += finalOperationQuery;
            let operationFound = { type: "operation", tags: operation.tags, fileName: fileName, query: finalOperationQuery, target: operation.target, dependencyTargets: operation.dependencyTargets, incrementalQuery: "", incrementalPreOps: [] };
            finalTables.push(operationFound);
            break;
        }
    }

    return { tables: finalTables, fullQuery: finalQuery };
};


function compileDataform(workspaceFolder: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const command = process.platform !== "win32" ? "dataform" : "dataform.cmd";
        const spawnedProcess = spawn(command, ["compile", workspaceFolder, "--json"]);
        let stdOut = '';
        let errorOutput = '';

        spawnedProcess.stdout.on('data', (data: string) => {
            stdOut += data.toString();
        });

        spawnedProcess.stderr.on('data', (data: string) => {
            errorOutput += data.toString();
        });

        spawnedProcess.on('close', (code: number) => {
            if (code === 0) {
                resolve(stdOut);
            } else {
                if (stdOut !== '') {
                    let compiledJson = JSON.parse(stdOut.toString());
                    let graphErrors = compiledJson.graphErrors.compilationErrors;
                    graphErrors.forEach((graphError: any) => {
                        vscode.window.showErrorMessage(`Error compiling Dataform: ${graphError.message}:   at ${graphError.fileName}`);
                    });
                } else {
                    vscode.window.showErrorMessage(`Error compiling Dataform: ${errorOutput}`);
                }
                reject(new Error(`Process exited with code ${code}`));
            }
        });

        spawnedProcess.on('error', (err: Error) => {
            reject(err);
        });
    });
}

// Usage
export async function runCompilation(workspaceFolder: string) {
    try {
        let compileResult = await compileDataform(workspaceFolder);
        const dataformCompiledJson: DataformCompiledJson = JSON.parse(compileResult);
        return dataformCompiledJson;
    } catch (error) {
        vscode.window.showErrorMessage(`Error compiling Dataform: ${error}`);
    }
}

export async function getDependenciesAutoCompletionItems(compiledJson: DataformCompiledJson) {
    let targets = compiledJson.targets;
    let declarations = compiledJson.declarations;
    let dependencies: string[] = [];
    for (let i = 0; i < targets.length; i++) {
        let targetName = targets[i].name;
        if (dependencies.includes(targetName) === false) {
            dependencies.push(targetName);
        }
    }

    for (let i = 0; i < declarations.length; i++) {
        let targetName = declarations[i].target.name;
        if (dependencies.includes(targetName) === false) {
            dependencies.push(targetName);
        }
    }
    return dependencies;
}

export async function getTableMetadata(document: vscode.TextDocument) {
    let tableMetadata;
    var [filename, extension] = getFileNameFromDocument(document);
    if (filename === "" || extension === "") { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder === "") { return; }

    let dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms
    if (dataformCompiledJson) {
        // let declarationsAndTargets = await getDependenciesAutoCompletionItems(dataformCompiledJson);
        // let dataformTags = await getDataformTags(dataformCompiledJson);
        tableMetadata = await getMetadataForCurrentFile(filename, dataformCompiledJson);
        // COMPILED_DATAFORM_METADATA = tableMetadata;
    }
    return tableMetadata;
}


export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, tableQueryOffset: number, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
    diagnosticCollection.clear();

    var [filename, extension] = getFileNameFromDocument(document);
    if (filename === "" || extension === "") { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder === "") { return; }

    let configLineOffset = 0;


    let dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms
    if (dataformCompiledJson) {
        CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;

        let declarationsAndTargets = await getDependenciesAutoCompletionItems(dataformCompiledJson);
        let dataformTags = await getDataformTags(dataformCompiledJson);
        let tableMetadata = await getMetadataForCurrentFile(filename, dataformCompiledJson);

        // Currently inline diagnostics are only supported for .sqlx files
        if (extension === "sqlx") {
            let configBlockRange = await getLineNumberWhereConfigBlockTerminates(); // Takes less than 2ms
            let configBlockStart = configBlockRange.startLine || 0;
            let configBlockEnd = configBlockRange.endLine || 0;
            let configBlockOffset = (configBlockEnd - configBlockStart) + 1;

            if (tableMetadata.tables[0].type === "table") {
                configLineOffset = configBlockOffset - tableQueryOffset;
            } else if (tableMetadata.tables[0].type === "assertion") {
                configLineOffset = configBlockOffset - assertionQueryOffset;
            }
        }

        if (tableMetadata.fullQuery === "") {
            vscode.window.showErrorMessage(`Query for ${filename} not found in compiled json`);
            return;
        }

        if (showCompiledQueryInVerticalSplitOnSave !== true) {
            showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        }
        if (showCompiledQueryInVerticalSplitOnSave) {
            writeCompiledSqlToFile(tableMetadata.fullQuery, compiledSqlFilePath);
        }

        let dryRunResult = await queryDryRun(tableMetadata.fullQuery); // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
        if (dryRunResult.error.hasError) {
            setDiagnostics(document, dryRunResult.error, compiledSqlFilePath, diagnosticCollection, configLineOffset);
            return;
        }
        let combinedTableIds = "";
        tableMetadata.tables.forEach((table) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics.totalBytesProcessed} - ${combinedTableIds}`);
        return [dataformTags, declarationsAndTargets];
    } else {
        return;
    }
}
