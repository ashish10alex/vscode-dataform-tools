import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { DataformCompiledJson, TablesWtFullQuery, SqlxBlockMetadata, GraphError, Target, Table, Assertion, Operation, CompiledQuerySchema } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { setDiagnostics } from './setDiagnostics';
import { assertionQueryOffset, tableQueryOffset, incrementalTableOffset } from './constants';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';
import { GitHubContentResponse } from './types';
import { checkAuthentication, getBigQueryClient } from './bigqueryClient';

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

export async function getTableSchema(projectId: string, datasetId: string, tableId: string): Promise<{name: string, metadata: {fullTableId: string}}[]> {
    try {
        await checkAuthentication();
        const bigquery = getBigQueryClient();
        if (!bigquery) {
            vscode.window.showErrorMessage('BigQuery client not available. Please check your authentication.');
            return [];
        }
        const dataset = bigquery.dataset(datasetId, { projectId: projectId });
        const [table] = await dataset.table(tableId).get();
        return table.metadata.schema.fields.map((field: {name: string, type:string, description:string}) => {
            return {
                name: field.name,
                metadata: {
                    fullTableId: `${projectId}.${datasetId}.${tableId}`,
                    type: `${field.type}`,
                    description: `${field?.description || ""}`

                }
            };
        });
    } catch (error) {
        // we donot want to throw an error as it would be an annoying editing experience to have this error constantly popping up
        return [];
    }
}


export function sendNotifactionToUserOnExtensionUpdate(context: vscode.ExtensionContext){
    const extensionPath = context.extensionPath;
    const packageJsonPath = path.join(extensionPath, 'package.json');
    const userConfigPath = path.join(extensionPath, 'user_config.json');

    // Read the current version from package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;

    // Check if user_config.json exists, if not create it
    if (!fs.existsSync(userConfigPath)) {
        fs.writeFileSync(userConfigPath, JSON.stringify({ lastVersion: '0.0.0' }));
    }

    // Read the last shown version from user_config.json
    const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));
    const lastVersion = userConfig.lastVersion;

    if (currentVersion !== lastVersion) {
        vscode.window.showInformationMessage(
        `Dataform tools extension updated to version ${currentVersion}. Check out the new features!`,
        'View Changelog'
        ).then(selection => {
        if (selection === 'View Changelog') {
            // Open changelog or release notes
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/ashish10alex/vscode-dataform-tools/releases'));
        }
        });
        userConfig.lastVersion = currentVersion;
        fs.writeFileSync(userConfigPath, JSON.stringify(userConfig));
    }
}

export function getHighlightJsThemeUri(){
    let themeKind = vscode.window.activeColorTheme.kind;
    let highlighJstThemeUri = "";
    switch(themeKind){
        case 1:
            highlighJstThemeUri = cdnLinks.highlightJsOneLightThemeUri;
            break;
        default:
            highlighJstThemeUri = cdnLinks.highlightJsOneDarkThemeUri;
    }
    return highlighJstThemeUri;
}

function getTreeRootFromWordInStruct(struct: any, searchTerm: string): string | undefined {
    if (struct) {
        for (let i = 0; i < struct.length; i++) {
            let declarationName = struct[i].target.name;
            if (searchTerm === declarationName) {
                return `${struct[i].target.database}.${struct[i].target.schema}.${struct[i].target.name}`;
            }
        }
    }
}

function updateDependentsGivenObj(dependents:Target[], targetObjList:Table[]|Assertion[]|Operation[], targetToSearch:Target){
    if(!targetObjList?.length){
        return dependents;
    }
    for(let i=0; i<targetObjList.length; i++){
        const tableTargets = targetObjList[i].dependencyTargets;
        if(!tableTargets || tableTargets.length === 0){
            continue;
        } else {
            tableTargets.forEach((tableTarget:Target) => {
                if(tableTarget.name===targetToSearch.name && tableTarget.schema===targetToSearch.schema  && tableTarget.database===targetToSearch.database){
                    dependents.push(targetObjList[i].target);
                }
            });
        }
    }
    return dependents;
}

async function getDependentsOfTarget(targetToSearch: Target, dataformCompiledJson: DataformCompiledJson) {
  const { tables, assertions, operations } = dataformCompiledJson;

  return Promise.all([
    updateDependentsGivenObj([], tables, targetToSearch),
    updateDependentsGivenObj([], assertions, targetToSearch),
    updateDependentsGivenObj([], operations, targetToSearch)
  ]).then(results => results.flat());
}

export async function getCurrentFileMetadata(freshCompilation: boolean) {
    let document = activeDocumentObj || vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }

    var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, false);
    if (!filename || !relativeFilePath || !extension) { return {isDataformWorkspace: false };};

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) { return {isDataformWorkspace: false}; }
    workspaceFolder = `"${workspaceFolder}"`;


    if (freshCompilation || !CACHED_COMPILED_DATAFORM_JSON) {
        let {dataformCompiledJson, errors, possibleResolutions} = await runCompilation(workspaceFolder); // Takes ~1100ms
            if(dataformCompiledJson){
                let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);

                const targetToSearch = fileMetadata?.tables[0]?.target;
                let dependents = undefined;
                if(targetToSearch){
                    dependents = await getDependentsOfTarget(targetToSearch, dataformCompiledJson);
                }

                return {
                    isDataformWorkspace: true,
                    dataformCompilationErrors:errors,
                    possibleResolutions:possibleResolutions,
                    fileMetadata: fileMetadata,
                    dependents: dependents,
                    lineageMetadata: {
                        dependencies: undefined,
                        error: undefined,
                    },
                    pathMeta: {
                        filename: filename,
                        extension: extension,
                        relativeFilePath: relativeFilePath
                    },
                    document: document
                };
            }
        else if (errors?.length!==0){
            CACHED_COMPILED_DATAFORM_JSON = undefined;
            return {
                isDataformWorkspace: true,
                dataformCompilationErrors:errors,
                possibleResolutions:possibleResolutions,
                fileMetadata: undefined,
                dependents: undefined,
                lineageMetadata: undefined,
                pathMeta: {
                    filename: filename,
                    extension: extension,
                    relativeFilePath: relativeFilePath
                },
                document: document
            };
        }
        } else {
            let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, CACHED_COMPILED_DATAFORM_JSON);

            const targetToSearch = fileMetadata?.tables[0]?.target;
            let dependents = undefined;
            if(targetToSearch){
                dependents = await getDependentsOfTarget(targetToSearch, CACHED_COMPILED_DATAFORM_JSON);
            }

            return {
                isDataformWorkspace: true,
                fileMetadata: fileMetadata,
                dependents: dependents,
                lineageMetadata: {
                    dependencies: undefined,
                    error: undefined,
                },
                pathMeta: {
                    filename: filename,
                    extension: extension,
                    relativeFilePath: relativeFilePath
                },
                document: document
            };
        }
    }

export async function getPostionOfSourceDeclaration(sourcesJsUri: vscode.Uri, searchTerm: string) {
    let sourcesDocument = await vscode.workspace.openTextDocument(sourcesJsUri);

    let line = null;
    let character = null;

    for (let lineNum = 0; lineNum < sourcesDocument.lineCount; lineNum++) {
        const lineText = sourcesDocument.lineAt(lineNum).text;
        const wordIndex = lineText.indexOf(searchTerm);

        if (wordIndex !== -1) {
            line = lineNum;
            character = wordIndex;
            return new vscode.Position(line, character);
        }
    }
    if (line === null || character === null) {
        return undefined;
    }
}

export async function getPostionOfVariableInJsFileOrBlock(document:vscode.TextDocument | vscode.Uri, searchTerm:string, startLine:number, endLine:number) {
    if (document instanceof vscode.Uri){
        document = await vscode.workspace.openTextDocument(document);
    }

    if (endLine === -1){
        endLine = document.lineCount;
    }

    let line = null;
    let character = null;

    const varRegex = new RegExp(`(var|let|const)\\s+${searchTerm}\\s*=`, 'i');
    const funcRegex = new RegExp(`function\\s+${searchTerm}\\s*\\(`, 'i');

    for (let lineNum = startLine; lineNum < endLine; lineNum++) {
        const lineText = document.lineAt(lineNum).text;

        if ( (varRegex.test(lineText) || funcRegex.test(lineText))) {
            line = lineNum;
            const wordIndex = lineText.indexOf(searchTerm);
            character = wordIndex;
            return new vscode.Position(line, character);
        }
    }
    if (line === null || character === null) {
        return undefined;
    }
}

export async function getTextByLineRange(filePathUri: vscode.Uri, startLine: number, endLine: number): Promise<string | undefined> {
  // Get the document from the workspace using the URI
  const document = await vscode.workspace.openTextDocument(filePathUri);
  if(endLine === -1){
    endLine = document.lineCount-1;
  }

  // Check if the document is valid and has enough lines
  if (document && startLine >= 0 && endLine < document.lineCount) {
    const start = new vscode.Position(startLine, 0);
    const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);
    const range = new vscode.Range(start, end);
    return document.getText(range);
  } else {
    console.error('Invalid document or line range.');
    return undefined; // Return undefined if the document is invalid or line range is out of bounds
  }
}

export async function getTreeRootFromRef(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return undefined;
    }
    const position = editor.selection.active;
    const wordRange = editor.document.getWordRangeAtPosition(position);
    if (!wordRange) {
        return undefined;
    }

    let searchTerm = editor.document.getText(wordRange);

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }
    let dataformCompiledJson: DataformCompiledJson | undefined;

    if (!CACHED_COMPILED_DATAFORM_JSON) {
        vscode.window.showWarningMessage('Compile the Dataform project once for faster go to definition');
        let {dataformCompiledJson, errors} = await runCompilation(workspaceFolder);
        if (dataformCompiledJson) {
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
    if (treeRoot) { return treeRoot; };

    if (tablePrefix) {
        searchTerm = tablePrefix + "_" + searchTerm;
    }

    if (tables) {
        treeRoot = getTreeRootFromWordInStruct(tables, searchTerm);
    }
    if (treeRoot) { return treeRoot; };

    if (operations) {
        treeRoot = getTreeRootFromWordInStruct(operations, searchTerm);
    }
    if (treeRoot) { return treeRoot; };

    if (assertions) {
        treeRoot = getTreeRootFromWordInStruct(assertions, searchTerm);
    }
    if (treeRoot) { return treeRoot; };
    return undefined;
}

export function getVSCodeDocument(): vscode.TextDocument | undefined {
    let document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }
    return document;
}

export function getLineUnderCursor(): string | undefined {
    let document = getVSCodeDocument();
    if (!document) {
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
    vscode.window.showErrorMessage(`${name} cli not found in path`, "Installation steps").then(selection => {
        if (selection === "Installation steps") {
            vscode.env.openExternal(vscode.Uri.parse("https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#requirements"));
        }
    });
    return false;
    }
}

function getRelativePath(filePath: string) {
    const fileUri = vscode.Uri.file(filePath);
    let relativePath = vscode.workspace.asRelativePath(fileUri);
    if (isRunningOnWindows) {
        relativePath = path.win32.normalize(relativePath);
    }
    return relativePath;
}

export function getFileNameFromDocument(document: vscode.TextDocument, showErrorMessage: boolean): string[] | [undefined, undefined, undefined] {
    var filePath = document.uri.fsPath;
    let basenameSplit = path.basename(filePath).split('.');
    let extension = basenameSplit[1];
    let relativeFilePath = getRelativePath(filePath);
    let validFileType = supportedExtensions.includes(extension);
    if (!validFileType) {
        if (showErrorMessage) {
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

export async function writeCompiledSqlToFile(compiledQuery: string, filePath: string) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '', 'utf8');
    }
    fs.writeFileSync(filePath, compiledQuery, 'utf8');
}

export async function getStdoutFromCliRun(exec: any, cmd: string): Promise<any> {
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

export async function getAllFilesWtAnExtension(workspaceFolder: string, extension: string) {
    const globPattern = new vscode.RelativePattern(workspaceFolder, `**/*${extension}`);
    let files = await vscode.workspace.findFiles(globPattern);
    const fileList = files.map(file => vscode.workspace.asRelativePath(file));
    return fileList;
}

export function getDataformActionCmdFromActionList(actionsList: string[], workspaceFolder: string, dataformCompilationTimeoutVal: string, includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {
    let dataformCompilerOptions = getDataformCompilerOptions();
    let cmd = `dataform run ${workspaceFolder} ${dataformCompilerOptions} --timeout=${dataformCompilationTimeoutVal}`;
    for (let i = 0; i < actionsList.length; i++) {
        let fullTableName = actionsList[i];
        if (i === 0) {
            if (includDependencies) {
                cmd += ` --include-deps`;
            }
            if (includeDownstreamDependents) {
                cmd += ` --include-dependents`;
            }
            if (fullRefresh) {
                cmd += ` --full-refresh`;
            }
            cmd += ` --actions "${fullTableName}"`;
        } else {
            cmd += ` --actions "${fullTableName}"`;
        }
    }
    return cmd;
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


export async function getQueryMetaForCurrentFile(relativeFilePath: string, compiledJson: DataformCompiledJson): Promise<TablesWtFullQuery> {

    let tables = compiledJson.tables;
    let assertions = compiledJson.assertions;
    let operations = compiledJson.operations;
    //TODO: This can be deprecated in favour of queryMetadata in future ?
    let queryMeta = {
        type: "",
        tableOrViewQuery: "",
        nonIncrementalQuery: "",
        incrementalQuery: "",
        incrementalPreOpsQuery: "",
        preOpsQuery: "",
        postOpsQuery: "",
        assertionQuery: "",
        operationsQuery: "",
    };
    let finalTables: any[] = [];

    if (tables === undefined) {
        return { tables: finalTables, queryMeta: queryMeta };
    }

    for (let i = 0; i < tables.length; i++) {
        let table = tables[i];
        let tableRelativeFilePath = table.fileName;
        if (relativeFilePath === tableRelativeFilePath) {
            if (table.type === "table" || table.type === "view") {
                queryMeta.type = table.type;
                queryMeta.tableOrViewQuery = table.query.trimStart() + "\n ;";
            } else if (table.type === "incremental") {
                queryMeta.type = table.type;
                queryMeta.nonIncrementalQuery = table.query + ";";
                queryMeta.incrementalQuery = table.incrementalQuery + ";";
                if (table?.incrementalPreOps) {
                    table.incrementalPreOps.forEach((query, idx) => {
                        queryMeta.incrementalPreOpsQuery += query + "\n";
                    });
                }
            }

            if (table.preOps) {
                table.preOps.forEach((query, idx) => {
                    queryMeta.preOpsQuery += query + "\n";
                });
            }
            if (table.postOps) {
                table.postOps.forEach((query, idx) => {
                    queryMeta.postOpsQuery += query + "\n";
                });
            }
            let tableFound = {
                type: table.type,
                tags: table.tags,
                fileName: relativeFilePath,
                target: table.target,
                preOps: table.preOps,
                postOps: table.postOps,
                dependencyTargets: table.dependencyTargets,
                incrementalQuery: table?.incrementalQuery ?? "",
                incrementalPreOps: table?.incrementalPreOps ?? [],
                actionDescriptor: table?.actionDescriptor
            };
            finalTables.push(tableFound);
            break;
        }
    }

    if (assertions === undefined) {
        return { tables: finalTables, queryMeta: queryMeta };
    }

    let assertionCountForFile = 0;
    let assertionQuery = "";
    for (let i = 0; i < assertions.length; i++) {
        //TODO: check if we can break early, maybe not as a table can have multiple assertions ?
        let assertion = assertions[i];
        if (assertion.fileName === relativeFilePath) {
            if (queryMeta.tableOrViewQuery === "" && queryMeta.incrementalQuery === "") {
                queryMeta.type = "assertion";
            }
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
    queryMeta.assertionQuery = assertionQuery;

    if (operations === undefined) {
        return { tables: finalTables, queryMeta: queryMeta };
    }

    for (let i = 0; i < operations.length; i++) {
        let operation = operations[i];
        if (operation.fileName === relativeFilePath) {
            queryMeta.type = "operation";
            let operationsCountForFile = 0;
            let opQueries = operation.queries;
            let finalOperationQuery = "";
            for (let i = 0; i < opQueries.length; i++) {
                operationsCountForFile += 1;
                finalOperationQuery += `\n -- Operations: [${operationsCountForFile}] \n`;
                finalOperationQuery += opQueries[i] + "\n ;";
            }
            queryMeta.operationsQuery += finalOperationQuery;
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

    return { tables: finalTables, queryMeta: queryMeta };
};


export function getDataformCompilationTimeoutFromConfig() {
    let dataformCompilationTimeoutVal: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('defaultDataformCompileTime');
    if (dataformCompilationTimeoutVal) {
        return dataformCompilationTimeoutVal;
    }
    return "5m";
}

export function getDataformCompilerOptions() {
    let dataformCompilerOptions: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('compilerOptions');
    if (dataformCompilerOptions) {
        return dataformCompilerOptions;
    }
    return "";
}

export function getSqlfluffConfigPathFromSettings() {
    let defaultSqlfluffConfigPath = ".vscode-dataform-tools/.sqlfluff";
    let sqlfluffConfigPath: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sqlfluffConfigPath');
    if (sqlfluffConfigPath) {
        if (isRunningOnWindows) {
            sqlfluffConfigPath = path.win32.normalize(sqlfluffConfigPath);
        }
        return sqlfluffConfigPath;
    }
    if (!isRunningOnWindows) {
        return defaultSqlfluffConfigPath;
    }
    return path.win32.normalize(defaultSqlfluffConfigPath);
}

function compileDataform(workspaceFolder: string): Promise<{compiledString:string|undefined, errors:GraphError[]|undefined, possibleResolutions:string[]|undefined}> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    let dataformCompilerOptions = getDataformCompilerOptions();
    let compilerOptions:string[] = [];
    if (dataformCompilerOptions !== ""){
        compilerOptions.push(dataformCompilerOptions);
    }

    return new Promise((resolve, reject) => {
        let spawnedProcess;
        if (isRunningOnWindows) {
            const command = "dataform.cmd";
            // windows seems to require shell: true
            spawnedProcess = spawn(command, ["compile", workspaceFolder, ...compilerOptions , "--json", "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });
        } else {
            const command = "dataform";
            spawnedProcess = spawn(command, ["compile", workspaceFolder, ...compilerOptions , "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });
        }

        let stdOut = '';
        let errorOutput = '';

        spawnedProcess.stdout.on('data', (data: string) => {
            stdOut += data.toString();
        });

        spawnedProcess.stderr.on('data', (data: string) => {
            errorOutput += data.toString();
        });

        spawnedProcess.on('close', async (code: number) => {
            if (code === 0) {
                resolve({compiledString: stdOut, errors:undefined, possibleResolutions:undefined});
            } else {
                if (stdOut !== '') {
                    let compiledJson = JSON.parse(stdOut.toString());
                    let graphErrors = compiledJson.graphErrors.compilationErrors;
                    let errors:GraphError[] = [];
                    graphErrors.forEach((graphError: {message:string, fileName:string}) => {
                        errors.push({error: graphError.message, fileName: graphError.fileName});
                    });
                    resolve({compiledString: undefined, errors:errors, possibleResolutions:undefined});
                } else {
                    let possibleResolutions = [];
                    const dataformInstallHint = "If using `package.json`, then run `dataform install`";
                    const installDataformCliHint = "dataform: command not found"; // TODO: check what is the eror message in windows
                    if(errorOutput.includes(dataformInstallHint)){
                        const _workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if(_workspaceFolder){
                            const filePath = path.join(_workspaceFolder, 'package.json');
                            const packageJsonExsists =  await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                            if(packageJsonExsists){
                                possibleResolutions.push("run `<b>dataform install</b>` in terminal");
                            }
                        }
                    }else if (errorOutput.includes(installDataformCliHint)){
                        possibleResolutions.push("Run `<b>npm install -g @dataform/cli</b>` in terminal");
                    };
                    resolve({compiledString: undefined, errors:[{error:`Error compiling Dataform: ${errorOutput}`, fileName:""}], possibleResolutions:possibleResolutions});
                }
            }
        });

        spawnedProcess.on('error', (err: Error) => {
            reject(err);
        });
    });
}

// Usage
export async function runCompilation(workspaceFolder: string): Promise<{dataformCompiledJson:DataformCompiledJson|undefined, errors:GraphError[]|undefined, possibleResolutions:string[]|undefined}> {
    try {
        let {compiledString, errors, possibleResolutions} = await compileDataform(workspaceFolder);
        if(compiledString){
            const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            return {dataformCompiledJson: dataformCompiledJson, errors:errors, possibleResolutions:possibleResolutions};
        }
        return {dataformCompiledJson: undefined, errors:errors, possibleResolutions:possibleResolutions};
    } catch (error:any) {
        return {dataformCompiledJson: undefined, errors:[{error: `Error compiling Dataform`, fileName: ""}], possibleResolutions:undefined};
    }
}

export async function getDependenciesAutoCompletionItems(compiledJson: DataformCompiledJson) {

    let sourceAutoCompletionPreference = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sourceAutoCompletionPreference');

    let targets = compiledJson.targets;
    let declarations = compiledJson.declarations;
    let dependencies: string[] = [];

    if (sourceAutoCompletionPreference === "${ref('table_name')}") {
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

export function readFile(filePath: string) {
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


export async function getTextForBlock(document: vscode.TextDocument, blockRangeWtMeta: { startLine: number, endLine: number, exists: boolean }): Promise<string> {
    if (!blockRangeWtMeta.exists) {
        return "";
    }
    const startPosition = new vscode.Position(blockRangeWtMeta.startLine - 1, 0);
    const endPosition = new vscode.Position(blockRangeWtMeta.endLine - 1, document.lineAt(blockRangeWtMeta.endLine - 1).text.length);
    let range = new vscode.Range(startPosition, endPosition);
    return document.getText(range);
}

export function getActiveFilePath() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.uri.fsPath;
    }
    return undefined;
}

export function checkIfFileExsists(filePath: string) {
    if (fs.existsSync(filePath)) {
        return true;
    }
    return false;
}

const ensureDirectoryExistence = (filePath: string) => {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    fs.mkdirSync(dirname, { recursive: true });
};

export function writeContentsToFile(filePath: string, content: string) {
    ensureDirectoryExistence(filePath);
    fs.writeFile(filePath, content, (err) => {
        if (err) { throw err; };
        return;
    });
}

export async function getMultipleFileSelection(workspaceFolder: string) {
    const fileList = await getAllFilesWtAnExtension(workspaceFolder, "sqlx");
    let options = {
        canPickMany: true,
        ignoreFocusOut: true,
    };
    let selectedFiles = await vscode.window.showQuickPick(fileList, options);
    return selectedFiles;
}

export async function runMultipleFilesFromSelection(workspaceFolder: string, selectedFiles: string, includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {
    workspaceFolder = `"${workspaceFolder}"`;
    let fileMetadatas: any[] = [];

    let dataformCompiledJson = await runCompilation(workspaceFolder);

    if (selectedFiles && dataformCompiledJson.dataformCompiledJson !== undefined) {
        for (let i = 0; i < selectedFiles.length; i++) {
            let relativeFilepath = selectedFiles[i];
            if (dataformCompiledJson && relativeFilepath) {
                fileMetadatas.push(await getQueryMetaForCurrentFile(relativeFilepath, dataformCompiledJson.dataformCompiledJson));
            }
        }
    }

    let actionsList: string[] = [];
    fileMetadatas.forEach(fileMetadata => {
        if (fileMetadata) {
            fileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; }) => {
                const action = `${table.target.database}.${table.target.schema}.${table.target.name}`;
                actionsList.push(action);
            });
        }
    });

    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    let dataformActionCmd = "";
    dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includDependencies, includeDownstreamDependents, fullRefresh);
    runCommandInTerminal(dataformActionCmd);
}

export function handleSemicolonPrePostOps(fileMetadata: TablesWtFullQuery){
    const preOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.preOpsQuery);
    const icrementalPreOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.incrementalPreOpsQuery);
    const postOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.postOpsQuery);

    if(!preOpsEndsWithSemicolon && fileMetadata.queryMeta.preOpsQuery !== "" ){
        fileMetadata.queryMeta.preOpsQuery = fileMetadata.queryMeta.preOpsQuery + ";";
    }

    if(!icrementalPreOpsEndsWithSemicolon && fileMetadata.queryMeta.incrementalPreOpsQuery !== "" ){
        fileMetadata.queryMeta.incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery + ";";
    }

    if(!postOpsEndsWithSemicolon && fileMetadata.queryMeta.postOpsQuery !== "" ){
        fileMetadata.queryMeta.postOpsQuery = fileMetadata.queryMeta.postOpsQuery + ";";
    }
    return fileMetadata;
}

export async function gatherQueryAutoCompletionMeta(curFileMeta:any){
    if (!CACHED_COMPILED_DATAFORM_JSON){
        return;
    }
    // all 3 of these togather take less than 0.35ms (dataform wt 285 nodes)
    let [declarationsAndTargets, dataformTags, currFileMetadata] = await Promise.all([
        getDependenciesAutoCompletionItems(CACHED_COMPILED_DATAFORM_JSON),
        getDataformTags(CACHED_COMPILED_DATAFORM_JSON),
        getQueryMetaForCurrentFile(curFileMeta.pathMeta.relativeFilePath, CACHED_COMPILED_DATAFORM_JSON)
    ]);
    return {
        declarationsAndTargets: declarationsAndTargets, dataformTags: dataformTags, currFileMetadata: currFileMetadata
    };

}

export async function dryRunAndShowDiagnostics(curFileMeta:any, queryAutoCompMeta:any, document:vscode.TextDocument, diagnosticCollection:any, showCompiledQueryInVerticalSplitOnSave:boolean|undefined){
    let sqlxBlockMetadata: SqlxBlockMetadata | undefined = undefined;
    //NOTE: Currently inline diagnostics are only supported for .sqlx files
    if (curFileMeta.pathMeta.extension === "sqlx") {
        sqlxBlockMetadata = getMetadataForSqlxFileBlocks(document); //Takes less than 2ms (dataform wt 285 nodes)
    }

    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
    }

    let currFileMetadata = handleSemicolonPrePostOps(queryAutoCompMeta.currFileMetadata);

    let queryToDryRun = "";
    if (currFileMetadata.queryMeta.type === "table" || currFileMetadata.queryMeta.type === "view") {
        queryToDryRun = currFileMetadata.queryMeta.preOpsQuery + currFileMetadata.queryMeta.tableOrViewQuery;
    } else if (currFileMetadata.queryMeta.type === "assertion") {
        queryToDryRun = currFileMetadata.queryMeta.assertionQuery;
    } else if (currFileMetadata.queryMeta.type === "operation") {
        queryToDryRun = currFileMetadata.queryMeta.preOpsQuery + currFileMetadata.queryMeta.operationsQuery;
    } else if (currFileMetadata.queryMeta.type === "incremental") {
        //TODO: defaulting to using incremental query to dry run for now
        // let nonIncrementalQuery = currFileMetadata.queryMeta.preOpsQuery + currFileMetadata.queryMeta.nonIncrementalQuery;
        let incrementalQuery = currFileMetadata.queryMeta.incrementalPreOpsQuery.trimStart() + currFileMetadata.queryMeta.incrementalQuery.trimStart();
        queryToDryRun = incrementalQuery;
    }

    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    let [dryRunResult, dryRunResultMainQuery, preOpsDryRunResult, postOpsDryRunResult] = await Promise.all([
        queryDryRun(queryToDryRun),
        queryDryRun(currFileMetadata.queryMeta.tableOrViewQuery),
        //TODO: If pre_operations block has an error the diagnostics wont be placed at correct place in main query block
        queryDryRun(currFileMetadata.queryMeta.preOpsQuery),
        queryDryRun(currFileMetadata.queryMeta.postOpsQuery)
    ]);

    compiledQuerySchema = dryRunResult.schema || dryRunResultMainQuery.schema;

    if (dryRunResult.error.hasError || preOpsDryRunResult.error.hasError || postOpsDryRunResult.error.hasError) {
        if (!sqlxBlockMetadata && curFileMeta.pathMeta.extension === ".sqlx") {
            vscode.window.showErrorMessage("Could not parse sqlx file");
            return;
        }

        let offSet = 0;
        if (currFileMetadata.queryMeta.type === "table" || currFileMetadata.queryMeta.type === "view") {
            offSet = tableQueryOffset;
        } else if (currFileMetadata.queryMeta.type === "assertion") {
            offSet = assertionQueryOffset;
        } else if (currFileMetadata.queryMeta.type === "incremental") {
            offSet = incrementalTableOffset;
        }

        if (sqlxBlockMetadata) {
            setDiagnostics(document, dryRunResult.error, preOpsDryRunResult.error, postOpsDryRunResult.error, diagnosticCollection, sqlxBlockMetadata, offSet);
        }
        return dryRunResult;
    }

    if (!showCompiledQueryInVerticalSplitOnSave) {
        let combinedTableIds = "";
        currFileMetadata.tables.forEach((table) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics.totalBytesProcessed} - ${combinedTableIds}`);
    }
    return dryRunResult;
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, showCompiledQueryInVerticalSplitOnSave: boolean) {
    diagnosticCollection.clear();

    let curFileMeta = await getCurrentFileMetadata(true);

    if(!CACHED_COMPILED_DATAFORM_JSON || !curFileMeta){
        return;
    }

    let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
    if (!queryAutoCompMeta){
        return;
    }

    dataformTags = queryAutoCompMeta.dataformTags;
    declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

    dryRunAndShowDiagnostics(curFileMeta, queryAutoCompMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
}
