import * as vscode from 'vscode';
import fs from 'fs';
import { exec as exec } from 'child_process';
import path from 'path';
import beautify from 'js-beautify';
import { execSync, spawn } from 'child_process';
import { DataformCompiledJson, Table, TablesWtFullQuery, Operation, Assertion, Declarations, Target, DependancyTreeMetadata, DeclarationsLegendMetadata, SqlxBlockMetadata} from './types';
import { queryDryRun } from './bigqueryDryRun';
import { setDiagnostics } from './setDiagnostics';
import { assertionQueryOffset, tableQueryOffset, sqlFileToFormatPath } from './constants';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';
import { GitHubContentResponse } from './types';

let supportedExtensions = ['sqlx', 'js'];

export let declarationsAndTargets: string[] = [];

export function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

function getTreeRootFromWordInStruct(struct:any, searchTerm:string): string | undefined{
    if (struct){
        for (let i = 0; i < struct.length; i++) {
            let declarationName = struct[i].target.name;
            if (searchTerm === declarationName) {
                return `${struct[i].target.database}.${struct[i].target.schema}.${struct[i].target.name}`;
            }
        }
    }
}

export async function getPostionOfSourceDeclaration(sourcesJsUri:vscode.Uri, searchTerm:string){
    let sourcesDocument = await vscode.workspace.openTextDocument(sourcesJsUri);

    let line = null;
    let character = null;

    for (let lineNum = 0; lineNum < sourcesDocument.lineCount; lineNum++) {
        const lineText = sourcesDocument.lineAt(lineNum).text;
        const wordIndex = lineText.indexOf(searchTerm);

        if (wordIndex !== -1) {
            line = lineNum;
            character = wordIndex;
        }
    }
    if (line === null || character === null) {
        return undefined;
    }
    return new vscode.Position(line, character);
}

export async function getTreeRootFromRef(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor){
        return undefined;
    }
    const position = editor.selection.active;
    const wordRange = editor.document.getWordRangeAtPosition(position);
    if (!wordRange){
        return undefined;
    }

    let searchTerm = editor.document.getText(wordRange);

    let workspaceFolder = getWorkspaceFolder();
    if(!workspaceFolder){
        return;
    }
    let dataformCompiledJson: DataformCompiledJson | undefined;

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        vscode.window.showWarningMessage('Compile the Dataform project once for faster go to definition');
        dataformCompiledJson = await runCompilation(workspaceFolder);
        if (dataformCompiledJson){
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    } else {
        dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;
    }

    let declarations = dataformCompiledJson?.declarations;
    let tables = dataformCompiledJson?.tables;
    let operations = dataformCompiledJson?.operations;
    let assertions = dataformCompiledJson?.assertions;
    let tablePrefix = dataformCompiledJson?.projectConfig?.tablePrefix;

    let treeRoot: string | undefined;
    if (declarations) {
        treeRoot = getTreeRootFromWordInStruct(declarations, searchTerm);
    }
    if (treeRoot){return treeRoot;};

    if (tablePrefix) {
        searchTerm = tablePrefix + "_" + searchTerm;
    }

    if (tables) {
        treeRoot = getTreeRootFromWordInStruct(tables, searchTerm);
    }
    if (treeRoot){return treeRoot;};

    if (operations) {
        treeRoot = getTreeRootFromWordInStruct(operations, searchTerm);
    }
    if (treeRoot){return treeRoot;};

    if (assertions) {
        treeRoot = getTreeRootFromWordInStruct(assertions, searchTerm);
    }
    if (treeRoot){return treeRoot;};
    return undefined;
}

export function getVSCodeDocument(): vscode.TextDocument | undefined {
  let document = vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showErrorMessage("VS Code document object was undefined");
    return;
  }
  return document;
}

export function getLineUnderCursor(): string | undefined {
    let document = getVSCodeDocument();
    if(!document){
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor");
        return;
    }

    const position = editor.selection.active;
    const line = editor.document.lineAt(position.line).text;
    return line;

}

export async function fetchGitHubFileContent(): Promise<string> {
    //TODO: Should we move .sqlfluff to assets folder?
    const repo = 'vscode-dataform-tools';
    const filePath = 'src/test/test-workspace/.sqlfluff';
    const response = await fetch(`https://api.github.com/repos/ashish10alex/${repo}/contents/${filePath}`);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as GitHubContentResponse;
    return Buffer.from(data.content, 'base64').toString('utf-8');
  }

export function executableIsAvailable(name: string) {
    const shell = (cmd: string) => execSync(cmd, { encoding: 'utf8' });
    const command = isRunningOnWindows ? "where.exe" : "which";
    try { shell(`${command} ${name}`); return true; }
    catch (error) {
        vscode.window.showErrorMessage(`${name} cli not found in path`);
        return false;
    }
}

function getRelativePath(filePath:string) {
    const fileUri = vscode.Uri.file(filePath);
    const relativePath = vscode.workspace.asRelativePath(fileUri);
    return relativePath;
  }

export function getFileNameFromDocument(document: vscode.TextDocument, showErrorMessage: boolean): string[] | [undefined, undefined, undefined] {
    var filePath = document.uri.fsPath;
    let basenameSplit = path.basename(filePath).split('.');
    let extension = basenameSplit[1];
    let relativeFilePath = getRelativePath(filePath);
    let validFileType = supportedExtensions.includes(extension);
    if (!validFileType) {
        if (showErrorMessage){
            vscode.window.showErrorMessage(`File type not supported. Supported file types are ${supportedExtensions.join(', ')}`);
        }
        return [undefined, undefined, undefined];
    }
    let rawFileName = basenameSplit[0];
    return [rawFileName, relativeFilePath, extension];
}

//
//WARN: What if user has multiple workspaces open in the same window
//TODO: we are taking the first workspace from the active workspaces. Is it possible to handle cases where there are multiple workspaces in the same window ?
//
export function getWorkspaceFolder(): string | undefined {
    let workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (workspaceFolder === undefined) {
        vscode.window.showWarningMessage(`Workspace could not be determined. Please open folder with your dataform project`);
        return undefined;
    }
    if (isDataformWorkspace(workspaceFolder)) {
        return workspaceFolder;
    }
    vscode.window.showWarningMessage(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json at its root`);
    return undefined;
}

export function isDataformWorkspace(workspacePath: string) {
    const dataformSignatureFiles = ['workflow_settings.yaml', 'dataform.json'];
    return dataformSignatureFiles.some(file => {
        let filePath = path.join(workspacePath, file);
        return fs.existsSync(filePath);
    });
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

export async function writeCompiledSqlToFile(compiledQuery: string, filePath: string, showOutputInVerticalSplit: boolean) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
    }

    fs.writeFileSync(filePath, compiledQuery, 'utf8');

    if (showOutputInVerticalSplit){
        const outputDocument = await vscode.workspace.openTextDocument(filePath);
        vscode.window.showTextDocument(outputDocument, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
    }
}

async function getStdoutFromCliRun(exec: any, cmd: string): Promise<any> {
    let workspaceFolder = getWorkspaceFolder();

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

export async function getAllFilesWtAnExtension(workspaceFolder:string, extension:string){
    const globPattern = new vscode.RelativePattern(workspaceFolder, `**/*${extension}`);
    let files = await vscode.workspace.findFiles(globPattern);
    const fileList = files.map(file => vscode.workspace.asRelativePath(file));
    return fileList;
}

export function getDataformActionCmdFromActionList(actionsList:string[], workspaceFolder:string, dataformCompilationTimeoutVal:string, includDependencies:boolean, includeDownstreamDependents:boolean, ){
        let dataformActionCmd = "";
        for (let i = 0; i < actionsList.length; i++) {
            let fullTableName = actionsList[i];
            if (i === 0) {
                if (includDependencies) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --timeout ${dataformCompilationTimeoutVal} --actions "${fullTableName}" --include-deps`);
                } else if (includeDownstreamDependents) {
                    dataformActionCmd = (`dataform run ${workspaceFolder} --timeout ${dataformCompilationTimeoutVal} --actions "${fullTableName}" --include-dependents`);
                }
                else {
                    dataformActionCmd = `dataform run ${workspaceFolder} --timeout ${dataformCompilationTimeoutVal} --actions "${fullTableName}"`;
                }
            } else {
                if (includDependencies) {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                } else {
                    dataformActionCmd += ` --actions "${fullTableName}"`;
                }
            }
        }
        return dataformActionCmd;
}

export async function runCurrentFile(includDependencies: boolean, includeDownstreamDependents: boolean) {


    let document = getVSCodeDocument();
    if (!document) {
        return;
    }
    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
    if (!filename || !relativeFilePath || !extension){
      return;
    }
    let workspaceFolder = getWorkspaceFolder();

    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();

    if (!workspaceFolder){
        return;
    }

    let tableMetadata;
    let dataformCompiledJson = await runCompilation(workspaceFolder);
    if (dataformCompiledJson) {
        tableMetadata = await getMetadataForCurrentFile(relativeFilePath, dataformCompiledJson);
    }

    if (tableMetadata) {
        let actionsList: string[] = tableMetadata.tables.map(table => `${table.target.database}.${table.target.schema}.${table.target.name}`);

        let dataformActionCmd = "";

        // create the dataform run command for the list of actions from actionsList
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDownstreamDependents);
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


export async function getMetadataForCurrentFile(relativeFilePath: string, compiledJson: DataformCompiledJson): Promise<TablesWtFullQuery> {

    let tables = compiledJson.tables;
    let assertions = compiledJson.assertions;
    let operations = compiledJson.operations;
    let queryToDisplay = "";
    let queryToDryRun = "";
    let finalTables: any[] = [];

    if (tables === undefined) {
        return { tables: finalTables, fullQuery: queryToDisplay, queryToDryRun: queryToDryRun };
    }

    for (let i = 0; i < tables.length; i++) {
        let table = tables[i];
        let tableRelativeFilePath = table.fileName;
        if (relativeFilePath === tableRelativeFilePath) {
            if (table.type === "table" || table.type === "view") {
                queryToDisplay = table.query.trimStart() + "\n ;";
            } else if (table.type === "incremental") {
                queryToDisplay += "\n-- Non incremental query \n";
                queryToDisplay += table.query + ";";
                queryToDisplay += "\n-- Incremental query \n";
                queryToDisplay += table.incrementalQuery + ";\n";
                if (table?.incrementalPreOps) {
                    table.incrementalPreOps.forEach((query, idx) => {
                        queryToDisplay += `\n-- Incremental pre operations: [${idx}] \n`;
                        queryToDisplay += query + "\n ;";
                    });
                }
            }

            queryToDryRun += queryToDisplay;
            if (table.preOps){
                table.preOps.forEach((query, idx) => {
                    queryToDisplay += `\n-- Pre operations: [${idx}] \n`;
                    queryToDisplay += query + ";\n";
                });
            }
            if (table.postOps){
                table.postOps.forEach((query, idx) => {
                    queryToDisplay += `\n-- Post operations: [${idx}] \n`;
                    queryToDisplay += query + ";\n";
                });
            }
            let tableFound = {
                              type: table.type,
                              tags: table.tags,
                              fileName: relativeFilePath,
                              query: queryToDisplay,
                              target: table.target,
                              preOps: table.preOps,
                              postOps: table.postOps,
                              dependencyTargets: table.dependencyTargets,
                              incrementalQuery: table?.incrementalQuery ?? "",
                              incrementalPreOps: table?.incrementalPreOps ?? []
                            };
            finalTables.push(tableFound);
            break;
        }
    }

    if (assertions === undefined) {
        return { tables: finalTables, fullQuery: queryToDisplay, queryToDryRun: queryToDryRun };
    }

    let assertionCountForFile = 0;
    let assertionQuery = "";
    for (let i = 0; i < assertions.length; i++) {
        //TODO: check if we can break early, maybe not as a table can have multiple assertions ?
        let assertion = assertions[i];
        let assertionFileName = path.basename(assertion.fileName).split('.')[0];
        if (assertionFileName === relativeFilePath) {
            let assertionFound = {
                        type: "assertion",
                        tags: assertion.tags,
                        fileName: relativeFilePath,
                        query: assertion.query,
                        target: assertion.target,
                        dependencyTargets: assertion.dependencyTargets,
                        incrementalQuery: "", incrementalPreOps: []
                    };
            finalTables.push(assertionFound);
            assertionCountForFile += 1;
            assertionQuery += `\n -- Assertions: [${assertionCountForFile}] \n`;
            assertionQuery += assertion.query.trimStart() + "; \n";
        }
    }
    queryToDisplay += assertionQuery;
    queryToDryRun += assertionQuery;

    if (operations === undefined) {
        return { tables: finalTables, fullQuery: queryToDisplay, queryToDryRun: queryToDryRun };
    }

    for (let i = 0; i < operations.length; i++) {
        let operation = operations[i];
        let operationFileName = path.basename(operation.fileName).split('.')[0];
        if (operationFileName === relativeFilePath) {
            let operationsCountForFile = 0;
            let opQueries = operation.queries;
            let finalOperationQuery = "";
            for (let i = 0; i < opQueries.length; i++) {
                operationsCountForFile += 1;
                finalOperationQuery += `\n -- Operations: [${operationsCountForFile}] \n`;
                finalOperationQuery += opQueries[i] + "\n ;";
            }
            queryToDisplay += finalOperationQuery;
            queryToDryRun += finalOperationQuery;
            let operationFound = {
                    type: "operation",
                    tags: operation.tags,
                    fileName: relativeFilePath,
                    query: finalOperationQuery,
                    target: operation.target,
                    dependencyTargets: operation.dependencyTargets,
                    incrementalQuery: "",
                    incrementalPreOps: []
                };
            finalTables.push(operationFound);
            break;
        }
    }

    return { tables: finalTables, fullQuery: queryToDisplay, queryToDryRun: queryToDryRun };
};


export function getDataformCompilationTimeoutFromConfig(){
    let dataformCompilationTimeoutVal: string|undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('defaultDataformCompileTime');
    if (dataformCompilationTimeoutVal){
        return dataformCompilationTimeoutVal;
    }
    return "5m";
}

export function getSqlfluffConfigPathFromSettings(){
    let defaultSqlfluffConfigPath = ".vscode-dataform-tools/.sqlfluff";
    let sqlfluffConfigPath: string|undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sqlfluffConfigPath');
    if (sqlfluffConfigPath){
        if(isRunningOnWindows){
            sqlfluffConfigPath = path.win32.normalize(sqlfluffConfigPath);
        }
        return sqlfluffConfigPath;
    }
    if(!isRunningOnWindows){
        return defaultSqlfluffConfigPath;
    }
    return path.win32.normalize(defaultSqlfluffConfigPath);
}

function compileDataform(workspaceFolder: string): Promise<string> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    return new Promise((resolve, reject) => {
        let spawnedProcess;
        if (isRunningOnWindows) {
            const command = "dataform.cmd";
            // windows seems to require shell: true
            spawnedProcess = spawn(command, ["compile", workspaceFolder, "--json", "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });
        } else {
            const command = "dataform";
            spawnedProcess = spawn(command, ["compile", workspaceFolder, "--json", `--timeout=${dataformCompilationTimeoutVal}`]);
        }

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
        CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        return dataformCompiledJson;
    } catch (error) {
        vscode.window.showErrorMessage(`Error compiling Dataform: ${error}`);
    }
}

export async function getDependenciesAutoCompletionItems(compiledJson: DataformCompiledJson) {

    let sourceAutoCompletionPreference = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sourceAutoCompletionPreference');

    let targets = compiledJson.targets;
    let declarations = compiledJson.declarations;
    let dependencies: string[] = [];

    if (sourceAutoCompletionPreference === "${ref('table_name')}"){
        if (targets?.length) {
            for (let i = 0; i < targets.length; i++) {
                let targetName = targets[i].name;
                if (dependencies.includes(targetName) === false) {
                    dependencies.push(targetName);
                }
            }
        }

        if (declarations?.length) {
            for (let i = 0; i < declarations.length; i++) {
                let targetName = declarations[i].target.name;
                if (dependencies.includes(targetName) === false) {
                    dependencies.push(targetName);
                }
            }
        }
    } else {
        if (targets?.length) {
            for (let i = 0; i < targets.length; i++) {
                let targetName = `${targets[i].schema}.${targets[i].name}`;
                if (dependencies.includes(targetName) === false) {
                    dependencies.push(targetName);
                }
            }
        }
        if (declarations?.length) {
            for (let i = 0; i < declarations.length; i++) {
                let targetName = `${declarations[i].target.schema}.${declarations[i].target.name}`;
                if (dependencies.includes(targetName) === false) {
                    dependencies.push(targetName);
                }
            }
        }
    }
    return dependencies;
}

function populateDependancyTree(type: string, structs: Table[] | Operation[] | Assertion[] | Declarations[], dependancyTreeMetadata: DependancyTreeMetadata[], schemaDict: any, schemaIdx: number) {
    let declarationsLegendMetadata: DeclarationsLegendMetadata[] = [];
    let addedSchemas: string[] = [];
    let schemaIdxTracker = 0;

    //_schema_idx 0 is reserved for nodes generated by Dataform pipeline
    declarationsLegendMetadata.push({
        "_schema": "dataform",
        "_schema_idx": 0
    });

    structs.forEach((struct) => {
        let tableName = `${struct.target.database}.${struct.target.schema}.${struct.target.name}`;
        let fileName = struct.fileName;
        let schema = `${struct.target.schema}`;

        // NOTE: Only adding colors in web panel for tables declared in declarations
        if (type === "declarations") {
            if (schemaDict.hasOwnProperty(schema)) {
                schemaIdx = schemaDict[schema];
            } else {
                schemaDict[schema] = schemaIdxTracker + 1;
                schemaIdxTracker += 1;
                schemaIdx = schemaIdxTracker;
            }
        }

        let dependancyTargets = struct?.dependencyTargets;

        let depedancyList: string[] = [];
        if (dependancyTargets) {
            dependancyTargets.forEach((dep: Target) => {
                let dependancyTableName = `${dep.database}.${dep.schema}.${dep.name}`;
                depedancyList.push(dependancyTableName);
            });
        }

        if (depedancyList.length === 0) {
            dependancyTreeMetadata.push(
                {
                    "_name": tableName,
                    "_fileName": fileName,
                    "_schema": schema,
                    "_schema_idx": (struct.hasOwnProperty("type")) ? 0 : schemaIdx
                }
            );
        } else {
            dependancyTreeMetadata.push(
                {
                    "_name": tableName,
                    "_fileName": fileName,
                    "_schema": schema,
                    "_deps": depedancyList,
                    "_schema_idx": (struct.hasOwnProperty("type")) ? 0 : schemaIdx
                }
            );
        }

        if (type === "declarations") {
            if (!addedSchemas.includes(schema)) {
                declarationsLegendMetadata.push({
                    "_schema": schema,
                    "_schema_idx": schemaIdx
                });
                addedSchemas.push(schema);
            }
        }
    });
    return { "dependancyTreeMetadata": dependancyTreeMetadata, "schemaIdx": schemaIdx, "declarationsLegendMetadata": declarationsLegendMetadata };
}

export async function generateDependancyTreeMetadata(): Promise<{ dependancyTreeMetadata: DependancyTreeMetadata[], declarationsLegendMetadata: DeclarationsLegendMetadata[] } | undefined> {
    let dependancyTreeMetadata: DependancyTreeMetadata[] = [];
    let schemaDict = {}; // used to keep track of unique schema names ( gcp dataset name ) already seen in the compiled json declarations
    let schemaIdx = 0;   // used to assign a unique index to each unique schema name for color coding dataset in the web panel

    if (!CACHED_COMPILED_DATAFORM_JSON) {

        let workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        let dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    let output;
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        return { "dependancyTreeMetadata": output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, "declarationsLegendMetadata": output ? output["declarationsLegendMetadata"] : [] };
    }
    let tables = CACHED_COMPILED_DATAFORM_JSON.tables;
    let operations = CACHED_COMPILED_DATAFORM_JSON.operations;
    let assertions = CACHED_COMPILED_DATAFORM_JSON.assertions;
    let declarations = CACHED_COMPILED_DATAFORM_JSON.declarations;

    if (tables) {
        output = populateDependancyTree("tables", tables, dependancyTreeMetadata, schemaDict, schemaIdx);
    }
    if (operations) {
        output = populateDependancyTree("operations", operations, output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, schemaDict, output ? output["schemaIdx"] : schemaIdx);
    }
    if (assertions) {
        output = populateDependancyTree("assertions", assertions, output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, schemaDict, output ? output["schemaIdx"] : schemaIdx);
    }
    if (declarations) {
        output = populateDependancyTree("declarations", declarations, output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, schemaDict, output ? output["schemaIdx"] : schemaIdx);
    }
    return { "dependancyTreeMetadata": output ? output["dependancyTreeMetadata"] : dependancyTreeMetadata, "declarationsLegendMetadata": output ? output["declarationsLegendMetadata"] : [] };
}

export async function getTableMetadata(document: vscode.TextDocument, freshCompilation: boolean) {
    let tableMetadata;
    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
    if (!filename || !relativeFilePath || !extension) { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) { return; }

    let dataformCompiledJson;
    if (freshCompilation || !CACHED_COMPILED_DATAFORM_JSON) {
        dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson){
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    } else {
        dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;
    }

    if (dataformCompiledJson) {
        tableMetadata = await getMetadataForCurrentFile(relativeFilePath, dataformCompiledJson);
    }
    return tableMetadata;
}

function readFile(filePath:string) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}


async function getTextForBlock(document: vscode.TextDocument, blockRangeWtMeta:{startLine:number, endLine:number, exists: boolean}): Promise<string>{
    if(!blockRangeWtMeta.exists){
        return "";
    }
    const startPosition = new vscode.Position(blockRangeWtMeta.startLine-1, 0);
    const endPosition = new vscode.Position(blockRangeWtMeta.endLine-1, document.lineAt(blockRangeWtMeta.endLine-1).text.length);
    let range = new vscode.Range(startPosition, endPosition);
    return document.getText(range);
}

function getActiveFilePath() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      return activeEditor.document.uri.fsPath;
    }
    return undefined;
}

export function checkIfFileExsists(filePath:string){
    if(fs.existsSync(filePath)){
        return true;
    }
    return false;
}

const ensureDirectoryExistence = (filePath:string) => {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
      return true;
    }
    fs.mkdirSync(dirname, { recursive: true });
  };

export function writeContentsToFile(filePath:string, content:string){
    ensureDirectoryExistence(filePath);
    fs.writeFile(filePath, content, (err) => {
    if (err) {throw err;};
        return;
    });
}

export async function formatSqlxFile(document:vscode.TextDocument, metadataForSqlxFileBlocks: SqlxBlockMetadata, sqlfluffConfigFilePath:string){

    let configBlockMeta = metadataForSqlxFileBlocks.configBlock;
    let preOpsBlockMeta = metadataForSqlxFileBlocks.preOpsBlock.preOpsList;
    let postOpsBlockMeta = metadataForSqlxFileBlocks.postOpsBlock.postOpsList;
    let sqlBlockMeta = metadataForSqlxFileBlocks.sqlBlock;

    let spaceBetweenBlocks = '\n\n\n';
    let spaceBetweenSameOps = '\n\n';

    let sqlBlockText = await getTextForBlock(document, sqlBlockMeta);
    writeCompiledSqlToFile(sqlBlockText, sqlFileToFormatPath, false);

    let [configBlockText] = await Promise.all([ getTextForBlock(document, configBlockMeta) ]);
    try {
        if (configBlockText && configBlockText !== ""){
            configBlockText = beautify.js(configBlockText, { "indent_size": 2 });
        }
    } catch (error) {
        vscode.window.showErrorMessage("Could to format config block");
    }

    let myPromises:any = [];
    preOpsBlockMeta.forEach((block:any) => {
        myPromises.push(getTextForBlock(document, block));
    });
    let preOpsBlockTextList: string[] = await Promise.all(myPromises);

    myPromises = [];
    postOpsBlockMeta.forEach((block:any) => {
        myPromises.push(getTextForBlock(document, block));
    });
    let postOpsBlockTextList = await Promise.all(myPromises);

    let preOpsBlockText: string = preOpsBlockTextList.map((text: string) => text + spaceBetweenSameOps).join('');
    let postOpsBlockText: string = postOpsBlockTextList.map((text: string) => text + spaceBetweenSameOps).join('');

    (preOpsBlockText === "") ? preOpsBlockText: preOpsBlockText =  (spaceBetweenBlocks + preOpsBlockText).slice(0, -spaceBetweenSameOps.length);
    (postOpsBlockText === "") ? postOpsBlockText: postOpsBlockText = (spaceBetweenBlocks + postOpsBlockText).slice(0, -spaceBetweenSameOps.length);

    let formatCmd = `sqlfluff fix -q --config=${sqlfluffConfigFilePath} ${sqlFileToFormatPath}`;

    await getStdoutFromCliRun(exec, formatCmd).then(async (sources) => {
        let formattedSql = await readFile(sqlFileToFormatPath);
        (formattedSql === "") ? formattedSql: formattedSql = spaceBetweenBlocks + formattedSql;

        if (typeof formattedSql === 'string'){
            let finalFormattedSqlx = configBlockText + preOpsBlockText +  postOpsBlockText + formattedSql;
            let currentActiveEditorFilePath = getActiveFilePath();
            if (!currentActiveEditorFilePath){
                vscode.window.showErrorMessage("Could not determine current active editor to write formatted text to");
                return;
            }
            fs.writeFile(currentActiveEditorFilePath, finalFormattedSqlx, (err) => {
            if (err) {throw err;};
                vscode.window.showInformationMessage(`Formatted: ${path.basename(currentActiveEditorFilePath)}`);
                return;
            });
        }
    }
    ).catch((err) => {
        vscode.window.showErrorMessage(`Error formatting: ${err}`);
        return;
    });
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument,  diagnosticCollection: vscode.DiagnosticCollection, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
    diagnosticCollection.clear();

    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
    if (!filename || !relativeFilePath || !extension) { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) { return; }

    let dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms (dataform wt 285 nodes)

    if (!dataformCompiledJson){
        return undefined;
    }

    CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;

    // all 3 of these togather take less than 0.35ms (dataform wt 285 nodes)
    let [declarationsAndTargets, dataformTags, tableMetadata] = await Promise.all([
        getDependenciesAutoCompletionItems(dataformCompiledJson),
        getDataformTags(dataformCompiledJson),
        getMetadataForCurrentFile(relativeFilePath, dataformCompiledJson)
    ]);

    let sqlxBlockMetadata:SqlxBlockMetadata|undefined = undefined;
    //NOTE: Currently inline diagnostics are only supported for .sqlx files
    if (extension === "sqlx") {
        sqlxBlockMetadata  = getMetadataForSqlxFileBlocks(document); //TODO: Takes less than 2ms (dataform wt 285 nodes)
    }

    if (tableMetadata.fullQuery === "") {
        vscode.window.showErrorMessage(`Query for ${filename} not found in compiled json`);
        return;
    }

    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
    }
    if (showCompiledQueryInVerticalSplitOnSave) {
        writeCompiledSqlToFile(tableMetadata.fullQuery, compiledSqlFilePath, true);
    }
    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    let [dryRunResult, preOpsDryRunResult, postOpsDryRunResult] = await Promise.all([
        queryDryRun(tableMetadata.queryToDryRun),
        //TODO: check if tables[0] is valid ??
        queryDryRun(tableMetadata?.tables[0]?.preOps ? tableMetadata?.tables[0]?.preOps[0]: ""),
        queryDryRun(tableMetadata?.tables[0]?.postOps ? tableMetadata?.tables[0]?.postOps[0]: "")
    ]);

    if (dryRunResult.error.hasError || preOpsDryRunResult.error.hasError || postOpsDryRunResult.error.hasError) {
        if (!sqlxBlockMetadata && extension === ".sqlx"){
            vscode.window.showErrorMessage("Could not parse sqlx file");
            return;
        }

        let offSet = 0;
        if (tableMetadata.tables[0].type === "table" || tableMetadata.tables[0].type === "view") {
            offSet = tableQueryOffset;
        } else if (tableMetadata.tables[0].type === "assertion") {
            offSet = assertionQueryOffset;
        }

        if (sqlxBlockMetadata){
            setDiagnostics(document, dryRunResult.error, preOpsDryRunResult.error, postOpsDryRunResult.error, compiledSqlFilePath, diagnosticCollection, sqlxBlockMetadata, offSet);
        }
        return;
    }
    let combinedTableIds = "";
    tableMetadata.tables.forEach((table) => {
        let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
        combinedTableIds += targetTableId;
    });
    vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics.totalBytesProcessed} - ${combinedTableIds}`);
    return [dataformTags, declarationsAndTargets];
}
