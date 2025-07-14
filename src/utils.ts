import * as vscode from 'vscode';
import { logger } from './logger';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { DataformCompiledJson, TablesWtFullQuery, SqlxBlockMetadata, GraphError, Target, Table, Assertion, Operation, Declarations, CurrentFileMetadata, FileNameMetadataResult, FileNameMetadata } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { setDiagnostics } from './setDiagnostics';
import { assertionQueryOffset, tableQueryOffset, incrementalTableOffset, linuxDataformCliNotAvailableErrorMessage, windowsDataformCliNotAvailableErrorMessage } from './constants';
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

function createQueryMetaErrorString(modelObj:Table | Operation | Assertion, relativeFilePath:string, modelObjType:string, isJsFile:boolean){
    return isJsFile
    ? ` Query could not be determined for ${modelObjType} in  ${relativeFilePath} <br>
        Canonical target: ${modelObj.canonicalTarget.database}.${modelObj.canonicalTarget.schema}.${modelObj.canonicalTarget.name} <br>
        <a href="https://cloud.google.com/dataform/docs/javascript-in-dataform#set-object-properties">Check if the sytax used for publish, operate, assert in js file is correct here.</a> <br>
    `
    : ` Query could not be determined for  ${relativeFilePath} <br>.
        Canonical target: ${modelObj.canonicalTarget.database}.${modelObj.canonicalTarget.schema}.${modelObj.canonicalTarget.name} <br>
    `;
}

export function formatBytes(bytes: number) {
    if (bytes === 0) {return '0 B';}

    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const k = 1024; // Use 1024 for binary prefixes (e.g., KiB) or 1000 for decimal

    // Find the appropriate unit level
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Convert to the unit and round to 2 decimal places
    const value = (bytes / Math.pow(k, i)).toFixed(2);

    return `${value} ${units[i]}`;
  }

export async function getTableSchema(projectId: string, datasetId: string, tableId: string): Promise<{name: string, metadata: {fullTableId: string}}[]> {
    try {
        await checkAuthentication();
        const bigquery = getBigQueryClient();
        if (!bigquery) {
            vscode.window.showErrorMessage('Error creating BigQuery client Please check your authentication.');
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
        // we do not want to throw an error as it would be an annoying editing experience to have this error constantly popping up
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
    if(themeKind === vscode.ColorThemeKind.HighContrastLight || themeKind === vscode.ColorThemeKind.Light){
        return cdnLinks.highlightJsOneLightThemeUri;
    } else {
        return cdnLinks.highlightJsOneDarkThemeUri;
    }
}

export function getTabulatorThemeUri(){
    let themeKind = vscode.window.activeColorTheme.kind;
    if(themeKind === vscode.ColorThemeKind.HighContrastLight || themeKind === vscode.ColorThemeKind.Light){
        return {tabulatorCssUri: cdnLinks.tabulatorLightCssUri, type: "light"};
    } else {
        return {tabulatorCssUri: cdnLinks.tabulatorDarkCssUri, type: "dark"};
    }
}

//@ts-ignore
function getTreeRootFromWordInStruct(struct: Table[]|Operation[]|Assertion[]|Declarations[], searchTerm: string): string | undefined {
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

export async function getCurrentFileMetadata(freshCompilation: boolean): Promise<CurrentFileMetadata | undefined> {
    let document = activeDocumentObj || vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }
    logger.debug(`Getting current file metadata for document: ${document.uri.fsPath}`);

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
         { return {errors: {errorGettingFileNameFromDocument: result.error}}; }
    }

    const [filename, relativeFilePath, extension] = result.value;
    logger.debug(`File name: ${filename}, relative file path: ${relativeFilePath}, extension: ${extension}`);
    if(!workspaceFolder){
        workspaceFolder = await getWorkspaceFolder();
    }
    if (!workspaceFolder) { return {isDataformWorkspace: false}; }
    logger.debug(`Workspace folder: ${workspaceFolder}`);

    if (freshCompilation || !CACHED_COMPILED_DATAFORM_JSON) {
        let {dataformCompiledJson, errors, possibleResolutions} = await runCompilation(workspaceFolder); // Takes ~1100ms
            if(dataformCompiledJson){
                let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);

                if(fileMetadata?.tables?.length === 0){
                    return {
                        errors: { fileNotFoundError: true },
                        pathMeta: {
                            filename: filename,
                            extension: extension,
                            relativeFilePath: relativeFilePath
                        },
                    };
                } else if (fileMetadata?.queryMeta.error !== ""){
                    return {
                        errors: { queryMetaError: fileMetadata?.queryMeta.error },
                        pathMeta: {
                            filename: filename,
                            extension: extension,
                            relativeFilePath: relativeFilePath
                        },
                    };
                };

                const targetToSearch = fileMetadata?.tables[0]?.target;
                let dependents = undefined;
                if(targetToSearch){
                    dependents = await getDependentsOfTarget(targetToSearch, dataformCompiledJson);
                }

                return {
                    isDataformWorkspace: true,
                    errors: { dataformCompilationErrors: errors },
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
                errors: { dataformCompilationErrors: errors },
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


            if (fileMetadata?.queryMeta.error !== ""){
                return {
                    errors: { queryMetaError: fileMetadata?.queryMeta.error },
                    pathMeta: {
                        filename: filename,
                        extension: extension,
                        relativeFilePath: relativeFilePath
                    },
                };
            }

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
        return undefined;
    }

//@ts-ignore
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

//@ts-ignore
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

    if(!workspaceFolder){
        workspaceFolder = await selectWorkspaceFolder();
    }
    if (!workspaceFolder) {
        return;
    }
    let dataformCompiledJson = await getOrCompileDataformJson(workspaceFolder);

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

export function getRelativePath(filePath: string) {
    const fileUri = vscode.Uri.file(filePath);
    let relativePath = vscode.workspace.asRelativePath(fileUri);
    if (isRunningOnWindows) {
        relativePath = path.win32.normalize(relativePath);
    }
    const firstDefinitionIndex = relativePath.indexOf("definitions");
    if (firstDefinitionIndex !== -1) {
        relativePath = relativePath.slice(firstDefinitionIndex);
    }
    return relativePath;
}

export async function selectWorkspaceFolder() {
    const availableFolders = vscode.workspace.workspaceFolders;

    if (availableFolders) {
        let folderOptions = availableFolders.map(folder => {
            return {
                label: folder.name,
                description: folder.uri.fsPath,
                value: folder.uri.fsPath
            };
        });

        if (folderOptions.length === 1) {
            workspaceFolder = folderOptions[0].value;
            return workspaceFolder;
        }

        folderOptions = folderOptions.filter(folder => isDataformWorkspace(folder.description));

        if (folderOptions.length === 1) {
            workspaceFolder = folderOptions[0].value;
            return workspaceFolder;
        }

        const selectedFolder = await vscode.window.showQuickPick(folderOptions, {placeHolder: "Select the Dataform workspace which this file belongs to"});
        if (selectedFolder) {
            workspaceFolder = selectedFolder.value;
            return workspaceFolder;
        }
        return undefined;
    } 
    return undefined;
}

export function getFileNameFromDocument(
  document: vscode.TextDocument,
  showErrorMessage: boolean
): FileNameMetadataResult<FileNameMetadata, string> {
  const filePath = document.uri.fsPath;
  const basenameSplit = path.basename(filePath).split('.');
  const extension = basenameSplit[1];
  const relativeFilePath = getRelativePath(filePath);
  const validFileType = supportedExtensions.includes(extension);

  if (!validFileType) {
    if (showErrorMessage) {
      vscode.window.showErrorMessage(
        `File type not supported. Supported file types are ${supportedExtensions.join(', ')}`
      );
    }
    return { success: false, error: `File type not supported. Supported file types are ${supportedExtensions.join(', ')}` };
  }

  const rawFileName = basenameSplit[0];
  return { success: true, value: [rawFileName, relativeFilePath, extension] };
}

//
//WARN: What if user has multiple workspaces open in the same window
//TODO: we are taking the first workspace from the active workspaces. Is it possible to handle cases where there are multiple workspaces in the same window ?
//
//TODO: What if user has no workspaces open ?
//
export async function getWorkspaceFolder(): Promise<string | undefined> {
    if(!workspaceFolder){
        workspaceFolder = await selectWorkspaceFolder();
    }
    if (workspaceFolder === undefined) {
        logger.debug(`Workspace could not be determined. Please open folder with your dataform project`);
        vscode.window.showWarningMessage(`Workspace could not be determined. Please open folder with your dataform project`);
        return undefined;
    }
    if (isDataformWorkspace(workspaceFolder)) {
        logger.debug(`Workspace: ${workspaceFolder} is a Dataform workspace`);
        return workspaceFolder;
    }
    logger.debug(`Not a Dataform workspace. Workspace: ${workspaceFolder} does not have workflow_settings.yaml or dataform.json at its root`);
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

export async function getOrCompileDataformJson(
    workspaceFolder: string
): Promise<DataformCompiledJson | undefined> {
    if (CACHED_COMPILED_DATAFORM_JSON) {
        return CACHED_COMPILED_DATAFORM_JSON;
    }
    vscode.window.showWarningMessage(
        "Compiling Dataform project, this may take a few moments..."
    );
    const { dataformCompiledJson } = await runCompilation(workspaceFolder);
    return dataformCompiledJson;
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
    let workspaceFolder = await getWorkspaceFolder();

    if (!workspaceFolder) {
        return;
    }

    return new Promise((resolve, reject) => {

        exec(cmd, { cwd: workspaceFolder }, (_: any, stdout: any, stderr: any) => {
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
    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
    let cmd = `${customDataformCliPath} run "${workspaceFolder}" ${dataformCompilerOptions} --timeout=${dataformCompilationTimeoutVal}`;
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
    return dataformTags.sort();
}


export async function getQueryMetaForCurrentFile(relativeFilePath: string, compiledJson: DataformCompiledJson): Promise<TablesWtFullQuery> {

    const { tables, assertions, operations } = compiledJson;

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
        error: "",
    };
    let finalTables: any[] = [];


    const isJsFile = relativeFilePath.endsWith('.js');
    const isSqlxFile = relativeFilePath.endsWith('.sqlx');

    if(isJsFile){
        queryMeta.type = "js";
    }
    
    if(tables?.length > 0){
        let matchingTables;
        if (isJsFile) {
            matchingTables = tables.filter(table => table.fileName === relativeFilePath);
        } else {
           matchingTables = tables.find(table => table.fileName === relativeFilePath);
        }

        // make matchingTables an array if it is not already
        if (matchingTables && !Array.isArray(matchingTables)) {
            matchingTables = [matchingTables];
        }

        if (matchingTables && matchingTables.length > 0) {
            logger.debug(`Found ${matchingTables.length} table(s) with filename: ${relativeFilePath}`);
            queryMeta.type = queryMeta.type === "js" ? "js" : matchingTables[0].type;

            matchingTables.forEach(table => {

                switch (table.type) {
                    case "table":
                    case "view":
                        if(!table?.query){
                            queryMeta.tableOrViewQuery = "";
                            queryMeta.error += createQueryMetaErrorString(table, relativeFilePath, table.type, isJsFile);
                        } else {
                            queryMeta.tableOrViewQuery += (queryMeta.tableOrViewQuery ? "\n" : "") + table.query.trimStart() + "\n;";
                        }
                        break;
                    case "incremental":
                        queryMeta.nonIncrementalQuery += (queryMeta.nonIncrementalQuery ? "\n" : "") + table.query + ";";
                        queryMeta.incrementalQuery += (queryMeta.incrementalQuery ? "\n" : "") + table.incrementalQuery + ";";
                        if (table.incrementalPreOps) {
                            queryMeta.incrementalPreOpsQuery += (queryMeta.incrementalPreOpsQuery ? "\n" : "") + table.incrementalPreOps.join("\n") + "\n";
                        }
                        break;
                    default:
                        console.warn(`Unexpected table type: ${table.type}`);
                }

                if (table.preOps) {
                    queryMeta.preOpsQuery += (queryMeta.preOpsQuery ? "\n" : "") + table.preOps.join("\n") + "\n";
                }
                if (table.postOps) {
                    queryMeta.postOpsQuery += (queryMeta.postOpsQuery ? "\n" : "") + table.postOps.join("\n") + "\n";
                }

                const tableFound = {
                    type: table.type,
                    tags: table.tags,
                    fileName: relativeFilePath,
                    target: table.target,
                    preOps: table.preOps,
                    postOps: table.postOps,
                    dependencyTargets: table.dependencyTargets,
                    incrementalQuery: table.incrementalQuery ?? "",
                    incrementalPreOps: table.incrementalPreOps ?? [],
                    actionDescriptor: table.actionDescriptor
                };
                finalTables.push(tableFound);
            });
        }
    }

    if(assertions?.length > 0){
        const assertionsForFile = assertions.filter(assertion => assertion.fileName === relativeFilePath);
        const assertionCountForFile = assertionsForFile.length;
        if (assertionCountForFile > 0 && queryMeta.tableOrViewQuery === "" && queryMeta.incrementalQuery === "") {
            queryMeta.type = queryMeta.type === "js" ? "js" : "assertion";
        }
        const assertionQueries = assertionsForFile.map((assertion, index) => {
            if(assertion?.query){
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
                return `\n -- Assertions: [${index + 1}] \n${assertion.query.trimStart()}; \n`;
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
                return `\n -- Assertions: [${index + 1}] \n ${errorString}; \n`;
            }
        });
        queryMeta.assertionQuery = assertionQueries.join('');
    }

    if (operations?.length > 0) {
        if ((isSqlxFile && finalTables.length === 0 ) || isJsFile) {
        const operationsForFile = operations.filter(op => op.fileName === relativeFilePath);
        if (operationsForFile.length > 0) {
            logger.debug(`Found ${operationsForFile.length} operation(s) with filename: ${relativeFilePath}`);
            queryMeta.type = queryMeta.type === "js" ? "js" : "operations";
            
            operationsForFile.forEach(operation => {
                if(operation?.queries){
                    const finalOperationQuery = operation.queries.reduce((acc, query, index) => {
                        return acc + `\n -- Operations: [${index + 1}] \n${query}\n`;
                    }, "");

                    queryMeta.operationsQuery += finalOperationQuery;

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
    }

    return { tables: finalTables, queryMeta: queryMeta};
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

export function getSqlfluffExecutablePathFromSettings() {
    let defaultSqlfluffExecutablePath = "sqlfluff";
    let sqlfluffExecutablePath: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sqlfluffExecutablePath');
    logger.debug(`sqlfluffExecutablePath: ${sqlfluffExecutablePath}`);
    if (sqlfluffExecutablePath !== defaultSqlfluffExecutablePath && sqlfluffExecutablePath !== undefined) {
        if (isRunningOnWindows) {
            return sqlfluffExecutablePath = path.win32.normalize(sqlfluffExecutablePath);
        } else {
            return sqlfluffExecutablePath;
        }
    }
    if (!isRunningOnWindows) {
        return defaultSqlfluffExecutablePath;
    }
    return path.win32.normalize(defaultSqlfluffExecutablePath);
}

export function getDataformCliCmdBasedOnScope(workspaceFolder: string): string {
    const dataformCliBase = isRunningOnWindows ? 'dataform.cmd' : 'dataform';
    const dataformCliScope: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('dataformCliScope');
    if (dataformCliScope === 'local') {
        const dataformCliLocalScopePath = isRunningOnWindows
            ? path.join('node_modules', '.bin', 'dataform.cmd')
            : path.join('node_modules', '.bin', 'dataform');
        return path.join(workspaceFolder, dataformCliLocalScopePath);
    }
    return dataformCliBase;
}

export function compileDataform(workspaceFolder: string): Promise<{compiledString:string|undefined, errors:GraphError[]|undefined, possibleResolutions:string[]|undefined}> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    let dataformCompilerOptions = getDataformCompilerOptions();
    let compilerOptions:string[] = [];
    if (dataformCompilerOptions !== ""){
        compilerOptions.push(dataformCompilerOptions);
    }
    logger.debug(`compilerOptions: ${compilerOptions}`);
    return new Promise((resolve, reject) => {
        let spawnedProcess;
        let customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
        logger.debug(`customDataformCliPath: ${customDataformCliPath}`);
        spawnedProcess = spawn(customDataformCliPath, ["compile", '"' + workspaceFolder + '"', ...compilerOptions , "--json", "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });

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
                    let compiledJson:  DataformCompiledJson;
                    try{
                        compiledJson = JSON.parse(stdOut.toString());
                    } catch (parseError) {
                        compiledJson = extractDataformJsonFromMultipleJson(stdOut.toString());
                    }

                    let graphErrors = compiledJson?.graphErrors?.compilationErrors;
                    if(!graphErrors){
                        const dataformPackageJsonMissingHint = "(missing dataform.json file)";
                    const dataformInstallHintv2 = "Could not find a recent installed version of @dataform/core in the project";
                        const possibleResolutions = [];
                        if(errorOutput.includes(dataformPackageJsonMissingHint)){
                            possibleResolutions.push("Run `<b>dataform compile</b>` in terminal to get full error");
                            possibleResolutions.push("Verify the dataform version of the project matches the version used in the project (<b>dataform --version</b> in terminal)");
                            possibleResolutions.push("If your project is using dataform version 3.x run <b>npm i -g @dataform/cli</b> in terminal)");
                        } else if (errorOutput.includes(dataformInstallHintv2)){
                            possibleResolutions.push("run `<b>dataform install</b>` in terminal followed by reload window and compile the file again");
                        }
                        resolve({compiledString: undefined, errors:[{error:`Error compiling Dataform: ${errorOutput}`, fileName:""}], possibleResolutions:possibleResolutions});
                        return;
                    }

                    let errors:GraphError[] = [];
                    graphErrors.forEach((graphError: {message:string, fileName:string}) => {
                        errors.push({error: graphError.message, fileName: graphError.fileName});
                    });
                    resolve({compiledString: undefined, errors:errors, possibleResolutions:undefined});
                } else {
                    let possibleResolutions = [];
                    const dataformInstallHintv3 = "If using `package.json`, then run `dataform install`";
                    if(errorOutput.includes(dataformInstallHintv3)){
                        const _workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if(_workspaceFolder){
                            const filePath = path.join(_workspaceFolder, 'package.json');
                            const packageJsonExsists =  await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                            if(packageJsonExsists){
                                possibleResolutions.push("run `<b>dataform install</b>` in terminal");
                            }
                        }
                    }else if (errorOutput.includes(windowsDataformCliNotAvailableErrorMessage) || errorOutput.includes(linuxDataformCliNotAvailableErrorMessage)){
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

function parseMultipleJSON(str:string) {
    /*
    NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string
    so we need to parse them separately to ensure there is no error in parsing and we get the compilation metadata of Dataform project
    */
    const result = [];
    let startIndex = str.indexOf('{');
    let openBraces = 0;

    for (let i = startIndex; i < str.length; i++) {
      if (str[i] === '{') {
        if (openBraces === 0) {startIndex = i;};
        openBraces++;
      } else if (str[i] === '}') {
        openBraces--;
        if (openBraces === 0) {
          const jsonStr = str.substring(startIndex, i + 1);
          result.push(JSON.parse(jsonStr));
        }
      }
    }

    return result;
  }

  function extractDataformJsonFromMultipleJson(compiledString: string){
    //NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string. From observation, index 1 is the JSON object that has Dataform compilation metadata
    const parsedObjects = parseMultipleJSON(compiledString);
    if (parsedObjects.length > 0) {
        return parsedObjects[1] as DataformCompiledJson;
    } else {
        throw new Error("Failed to parse JSON");
    }
  }

export async function runCompilation(workspaceFolder: string): Promise<{dataformCompiledJson:DataformCompiledJson|undefined, errors:GraphError[]|undefined, possibleResolutions:string[]|undefined}> {
    try {
        let {compiledString, errors, possibleResolutions} = await compileDataform(workspaceFolder);
        if(compiledString){
            let dataformCompiledJson: DataformCompiledJson;
            try {
                dataformCompiledJson = JSON.parse(compiledString);
            } catch (parseError) {
                dataformCompiledJson = extractDataformJsonFromMultipleJson(compiledString);
            }
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            return {dataformCompiledJson: dataformCompiledJson, errors:errors, possibleResolutions:possibleResolutions};
        }
        return {dataformCompiledJson: undefined, errors:errors, possibleResolutions:possibleResolutions};
    } catch (error:any) {
        return {dataformCompiledJson: undefined, errors:[{error: `Error compiling Dataform: ${error.message}`, fileName: ""}], possibleResolutions:undefined};
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

//@ts-ignore
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
        fileMetadata.queryMeta.preOpsQuery = fileMetadata.queryMeta.preOpsQuery.trimEnd() + ";" + "\n";
    }

    if(!icrementalPreOpsEndsWithSemicolon && fileMetadata.queryMeta.incrementalPreOpsQuery !== "" ){
        fileMetadata.queryMeta.incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimEnd() + ";" + "\n";
    }

    if(!postOpsEndsWithSemicolon && fileMetadata.queryMeta.postOpsQuery !== "" ){
        fileMetadata.queryMeta.postOpsQuery = fileMetadata.queryMeta.postOpsQuery.trimEnd() + ";" + "\n";
    }
    return fileMetadata;
}

export async function gatherQueryAutoCompletionMeta(){
    if (!CACHED_COMPILED_DATAFORM_JSON){
        return;
    }
    // all 2 of these together take approx less than 0.35ms (Dataform repository with 285 nodes)
    let [declarationsAndTargets, dataformTags] = await Promise.all([
        getDependenciesAutoCompletionItems(CACHED_COMPILED_DATAFORM_JSON),
        getDataformTags(CACHED_COMPILED_DATAFORM_JSON),
    ]);
    return {
        declarationsAndTargets: declarationsAndTargets, dataformTags: dataformTags
    };

}

function replaceQueryLabelWtEmptyStringForDryRun(query:string) {
    return query.replace(/SET\s+@@query_label\s*=\s*(['"]).*?\1\s*;/gi, '');
}

export async function dryRunAndShowDiagnostics(curFileMeta:any,  document:vscode.TextDocument, diagnosticCollection:any, showCompiledQueryInVerticalSplitOnSave:boolean|undefined){
    let sqlxBlockMetadata: SqlxBlockMetadata | undefined = undefined;
    //NOTE: Currently inline diagnostics are only supported for .sqlx files
    if (curFileMeta.pathMeta.extension === "sqlx") {
        sqlxBlockMetadata = getMetadataForSqlxFileBlocks(document); //Takes less than 2ms (Dataform with 285 nodes)
    }

    if (showCompiledQueryInVerticalSplitOnSave !== true) {
        showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
    }

    let queryToDryRun = "";
    let nonIncrementalQuery = "";
    let incrementalQuery = "";
    const type = curFileMeta.fileMetadata.queryMeta.type ;
    const fileMetadata = curFileMeta.fileMetadata;

    let isMultiModalJsType = type === "js" && fileMetadata.tables.map((table: any) => {
        return table.type === "table" || table.type === "view" ;
    }).length >= 1;

    if (type === "table" || type === "view" || isMultiModalJsType) {
        let preOpsQuery = fileMetadata.queryMeta.preOpsQuery;
        if(preOpsQuery && preOpsQuery !== ""){
            preOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(preOpsQuery);
        }
        queryToDryRun = preOpsQuery + fileMetadata.queryMeta.tableOrViewQuery;
    } else if (type === "assertion") {
        queryToDryRun = fileMetadata.queryMeta.assertionQuery;
    } else if (type === "operations") {
        queryToDryRun = fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.operationsQuery;
    } else if (type === "incremental") {
        //TODO: defaulting to using incremental query to dry run for now
        // let nonIncrementalQuery = currFileMetadata.queryMeta.preOpsQuery + currFileMetadata.queryMeta.nonIncrementalQuery;
        let preOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimStart();
        if(preOpsQuery && preOpsQuery !== ""){
            preOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(fileMetadata.queryMeta.preOpsQuery);
        }
        incrementalQuery = preOpsQuery + fileMetadata.queryMeta.incrementalQuery.trimStart();
        nonIncrementalQuery = preOpsQuery + fileMetadata.queryMeta.nonIncrementalQuery.trimStart();
    }

    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    let [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, nonIncrementalDryRunResult, incrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult] = await Promise.all([
        queryDryRun(queryToDryRun),
        //TODO: If pre_operations block has an error the diagnostics wont be placed at correct place in main query block
        queryDryRun(fileMetadata.queryMeta.preOpsQuery),
        queryDryRun(fileMetadata.queryMeta.postOpsQuery),
        queryDryRun(nonIncrementalQuery),
        queryDryRun(incrementalQuery),
        queryDryRun(fileMetadata.queryMeta.incrementalPreOpsQuery),
        queryDryRun(fileMetadata.queryMeta.assertionQuery),
    ]);

    if(dryRunResult.schema){
        compiledQuerySchema = dryRunResult.schema;
    } else if (dryRunResult.schema === undefined && dryRunResult.error.hasError === false){
        // happens when Dataform config type is operation and dry run api response has no schema
        compiledQuerySchema = {
        fields: [
            {
            name: "",
            type: "",
            }
        ]};
    }

    // check if we need to handle errors from non incremental query here 
    if (dryRunResult.error.hasError || preOpsDryRunResult.error.hasError || postOpsDryRunResult.error.hasError || incrementalDryRunResult.error.hasError || assertionDryRunResult.error.hasError) {
        if (!sqlxBlockMetadata && curFileMeta.pathMeta.extension === ".sqlx") {
            vscode.window.showErrorMessage("Could not parse sqlx file");
        }

        let offSet = 0;
        if (type === "table" || type === "view") {
            offSet = tableQueryOffset;
        } else if (type === "assertion") {
            offSet = assertionQueryOffset;
        } else if (type === "incremental") {
            offSet = incrementalTableOffset;
        }

        if (sqlxBlockMetadata) {
            if (type === "incremental") {
                // check if we need to handle errors from non incremental query here 
                dryRunResult.error = incrementalDryRunResult.error;
            }
            let errorMeta = {
                mainQueryError: dryRunResult.error,
                preOpsError: preOpsDryRunResult.error,
                postOpsError: postOpsDryRunResult.error,
                nonIncrementalError: nonIncrementalDryRunResult.error,
                incrementalError: incrementalDryRunResult.error,
                incrementalPreOpsError: incrementalPreOpsDryRunResult.error,
                assertionError: assertionDryRunResult.error,
            };
            setDiagnostics(document, errorMeta, diagnosticCollection, sqlxBlockMetadata, offSet);
        }
        return [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, nonIncrementalDryRunResult, incrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult];
    }

    if (!showCompiledQueryInVerticalSplitOnSave) {
        let combinedTableIds = "";
        curFileMeta.fileMetadata.tables.forEach((table: { target: Target }) => {
            let targetTableId = ` ${table.target.database}.${table.target.schema}.${table.target.name} ; `;
            combinedTableIds += targetTableId;
        });
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics.totalBytesProcessed} - ${combinedTableIds}`);
    }
    return [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, incrementalDryRunResult, nonIncrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult];
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, showCompiledQueryInVerticalSplitOnSave: boolean) {
    diagnosticCollection.clear();

    let curFileMeta = await getCurrentFileMetadata(true);

    if(!CACHED_COMPILED_DATAFORM_JSON || !curFileMeta){
        return;
    }

    let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
    if (!queryAutoCompMeta){
        return;
    }

    dataformTags = queryAutoCompMeta.dataformTags;
    declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

    dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
}
