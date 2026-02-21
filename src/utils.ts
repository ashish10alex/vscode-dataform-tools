import * as vscode from 'vscode';
import { logger } from './logger';
import fs from 'fs';
import path from 'path';
import { gcloudComputeRegions } from './constants';
import { execSync, spawn } from 'child_process';
import { DataformCompiledJson, TablesWtFullQuery, SqlxBlockMetadata, GraphError, Target, Table, Assertion, Operation, Declarations, CurrentFileMetadata, FileNameMetadataResult, FileNameMetadata, Notebook, BigQueryDryRunResponse } from './types';
import { queryDryRun } from './bigqueryDryRun';
import { setDiagnostics } from './setDiagnostics';
import { assertionQueryOffset, tableQueryOffset, incrementalTableOffset, linuxDataformCliNotAvailableErrorMessage, windowsDataformCliNotAvailableErrorMessage, cacheDurationMs } from './constants';
import { getMetadataForSqlxFileBlocks } from './sqlxFileParser';
import { GitHubContentResponse, ExecutablePathCache, ExecutablePathInfo, ExecutionMode} from './types';
import { checkAuthentication, getBigQueryClient } from './bigqueryClient';
import { ProjectsClient } from '@google-cloud/resource-manager';
import { GoogleAuth } from 'google-auth-library';
import { DataformTools } from "@ashishalex/dataform-tools";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely } from "./dataformApiUtils";
import { GitService } from './gitClient';

let supportedExtensions = ['sqlx', 'js'];


export function formatTimestamp(lastModifiedTime:Date):string {
    return lastModifiedTime.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: 'UTC'
    }) + ' UTC';
}

export let declarationsAndTargets: string[] = [];

// Cache maps for O(1) lookups
global.FILE_NODE_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();
global.TARGET_DEPENDENTS_MAP = new Map<string, Target[]>();
global.TARGET_NAME_MAP = new Map<string, (Table | Assertion | Operation | Notebook)[]>();

export function buildIndices(compiledJson: DataformCompiledJson) {
    FILE_NODE_MAP.clear();
    TARGET_DEPENDENTS_MAP.clear();
    TARGET_NAME_MAP.clear();

    const { tables, assertions, operations, notebooks } = compiledJson;

    // Helper to add node to FILE_NODE_MAP
    const addNodeToFileMap = (node: Table | Assertion | Operation | Notebook) => {
        const fileName = node.fileName;
        if (!FILE_NODE_MAP.has(fileName)) {
            FILE_NODE_MAP.set(fileName, []);
        }
        FILE_NODE_MAP.get(fileName)?.push(node);
    };

    // Helper to add dependencies to TARGET_DEPENDENTS_MAP
    // We map: DependencyTarget -> [DependentNodes]
    // The 'node' depends on 'dependencyTarget'.
    // So 'node.target' is a dependent of 'dependencyTarget'.
    const addDependenciesToMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.dependencyTargets) {
            node.dependencyTargets.forEach(depTarget => {
                const depKey = `${depTarget.database}.${depTarget.schema}.${depTarget.name}`;
                if (!TARGET_DEPENDENTS_MAP.has(depKey)) {
                    TARGET_DEPENDENTS_MAP.set(depKey, []);
                }
                // Avoid duplicates if possible, though strict set check might be overkill for now
                // We push the *node's target* as the dependent
                 TARGET_DEPENDENTS_MAP.get(depKey)?.push(node.target);
            });
        }
    };

    // Helper to add nodes to TARGET_NAME_MAP for text-based ref/hover resolution
    const addNodeToTargetNameMap = (node: Table | Assertion | Operation | Notebook) => {
        if (node.target && node.target.name) {
            const tName = node.target.name;
            if (!TARGET_NAME_MAP.has(tName)) {
                TARGET_NAME_MAP.set(tName, []);
            }
            TARGET_NAME_MAP.get(tName)?.push(node);
        }
    };

    tables?.forEach(table => {
        if (!table.type) table.type = 'table';
        addNodeToFileMap(table);
        addDependenciesToMap(table);
        addNodeToTargetNameMap(table);
    });

    assertions?.forEach(assertion => {
        assertion.type = 'assertion';
        addNodeToFileMap(assertion);
        addDependenciesToMap(assertion);
        addNodeToTargetNameMap(assertion);
    });

    operations?.forEach(operation => {
        operation.type = 'operations';
        addNodeToFileMap(operation);
        addDependenciesToMap(operation);
        addNodeToTargetNameMap(operation);
    });

    notebooks?.forEach(notebook => {
        (notebook as any).type = 'notebook';
        addNodeToFileMap(notebook);
        addDependenciesToMap(notebook);
        addNodeToTargetNameMap(notebook);
    });
    
    logger.debug(`Built indices: ${FILE_NODE_MAP.size} files, ${TARGET_DEPENDENTS_MAP.size} targets with dependents`);
}


//NOTE: maybe no test is needed as dataform cli compilation should catch any potential edge cases  ?
function stripQuotes(str:string) {
  return str.replace(/^['"]|['"]$/g, '');
}

export async function getCachedDataformRepositoryLocation(context: vscode.ExtensionContext, repositoryName: string): Promise<string | undefined> {
        let cachedGcpLocation = context.globalState.get<string>(`vscode_dataform_tools_${repositoryName}`);
        if (!cachedGcpLocation) {
            cachedGcpLocation = await createSelector(gcloudComputeRegions, "Select Dataform repository location");
        } 
        return cachedGcpLocation;
}

function createCompilerOptionsObjectForApi(compilerOptions: string[]) {
    // NOTE: we might need to add support for more code compilation config items from https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/protos.google.cloud.dataform.v1beta1.icodecompilationconfig
    let compilerOptionsObject: { [key: string]: string } = {};
    let compilerOptionsToApi = compilerOptions[0].split(" ");

    compilerOptionsToApi.forEach((opt: string) => {
        let value = opt.split("=")[1];
        value = stripQuotes(value);

        if (opt.startsWith("--table-prefix")) {
            compilerOptionsObject["tablePrefix"] = value;
        }

        if (opt.startsWith("--schema-suffix")) {
            compilerOptionsObject["schemaSuffix"] = value;
        }

        if (opt.startsWith("--database-suffix")) {
            compilerOptionsObject["databaseSuffix"] = value;
        }
    });

    return compilerOptionsObject;
}

export function showLoadingProgress<T extends any[]>(
    title: string,
    operation: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken,
        ...args: T
    ) => Thenable<void>,
    cancellationMessage: string = "Dataform tools: operation cancelled",
    ...args:any
): Thenable<void> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: true
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                console.log(cancellationMessage);
            });

            await operation(progress, token, ...args);
        }
    );
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function createSelector(selectionItems:string[], placeHolder: string): Promise<string | undefined>{
     return await vscode.window.showQuickPick(selectionItems, {
        placeHolder: placeHolder,
    });
}

export async function getCurrentGcpProjectId(): Promise<string | undefined> {
    try {
        const auth = new GoogleAuth();
        const projectId = await auth.getProjectId();
        return projectId;
    } catch (err) {
        console.error("Failed to get project ID:", err);
        return undefined;
    }
}

export async function getLocationOfGcpProject(projectId: string){
    try{
        const client = new ProjectsClient();
        const [project] = await client.getProject({
            name: `projects/${projectId}`
        });
        return project.labels?.application_region;
    } catch(err){
        const e = err instanceof Error ? err : new Error(String(err));
        vscode.window.showErrorMessage(`Run failed: ${e.message}`); 
        return undefined;
    }
}

export async function getGcpProjectLocationDataform(projectId:string, compiledDataformJson:DataformCompiledJson) {
    let gcpProjectLocation;

    if (compiledDataformJson?.projectConfig?.defaultLocation) {
        gcpProjectLocation = compiledDataformJson.projectConfig.defaultLocation;
    } else {
        vscode.window.showWarningMessage(`Determing GCP compute location using API. Define it in Dataform config for faster invocation`);
        gcpProjectLocation = await getLocationOfGcpProject(projectId);
    }

    if (!gcpProjectLocation) {
        throw new Error(`Unable to determine GCP project location for project ID: ${projectId}`);
    }

    return gcpProjectLocation;
}

export async function getGcpProjectIdDataform(compiledDataformJson:DataformCompiledJson) {
    let gcpProjectId;

    if (compiledDataformJson?.projectConfig?.defaultDatabase) {
        gcpProjectId = compiledDataformJson.projectConfig.defaultDatabase;
    } else {
        vscode.window.showWarningMessage(`Determing GCP project ID using API. Define it in Dataform config for faster invocation`);
        gcpProjectId = await getCurrentGcpProjectId();
    }

    if (!gcpProjectId) {
        throw new Error(`Unable to determine GCP project id`);
    }

    return gcpProjectId;
}


export async function getGcpProjectIds(){
    let gcpProjectIds = [];

    //TODO: need to check what happens when there is an error ?
    const client = new ProjectsClient();
    const projects = client.searchProjectsAsync();
    vscode.window.showInformationMessage("Loading available GCP projects...");
    for await (const project of projects) {
        if(project.projectId){
            gcpProjectIds.push(project.projectId);
        }
    }
    return gcpProjectIds;
}

export function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

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


export function arrayToCsv(data: Record<string, any>[]): string {
    // FIXME: we do not support elegant exports of nested columns outputs yet
    const separator = ',';
    const keys = Object.keys(data[0] ?? {});
    const csvRows = [
        keys.join(separator),
        ...data.map(row =>
            keys.map(key => {
                let cell = row[key] === null || row[key] === undefined ? '' : row[key];
                cell = cell instanceof Date
                    ? cell.toLocaleString()
                    : String(cell).replace(/"/g, '""');
                if (cell.search(/("|,|\n)/g) >= 0) {
                    cell = `"${cell}"`;
                }
                return cell;
            }).join(separator)
        )
    ];
    return csvRows.join('\n');
}

export async function saveCsvFile(filename: string, data: Record<string, any>[]) {
    const csvContent = arrayToCsv(data);
    const uint8array = new TextEncoder().encode(csvContent);
    const fileUri = vscode.Uri.file(filename);
    await vscode.workspace.fs.writeFile(fileUri, uint8array);
    vscode.window.showInformationMessage(
    `csv exported: ${fileUri.toString()}`,
    "Open folder"
).then(selection => {
    if (selection === "Open folder") {
        vscode.commands.executeCommand('revealFileInOS', fileUri);
        if (vscode.env.remoteName === 'wsl') {
            vscode.commands.executeCommand('remote-wsl.revealInExplorer', fileUri);
        } else {
            vscode.commands.executeCommand('revealFileInOS', fileUri);
        }
    }
});

}


export async function openFileOnLeftEditorPane(filePath: string, position: vscode.Position){
    const workspaceFolder = await getWorkspaceFolder();
    if(workspaceFolder && filePath){
        const fullFilePath = path.join(workspaceFolder, filePath);
        const filePathUri = vscode.Uri.file(fullFilePath);
        const document = await vscode.workspace.openTextDocument(filePathUri);

        vscode.window.showTextDocument(document, vscode.ViewColumn.One, false).then(editor => {
            const range = new vscode.Range(position, position);
            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(position, position);
        });
    }
}

export function findModelFromTarget(target:any, model: Operation[] | Assertion[] | Table[] | Declarations[]): { filePath: string; targetName: string } | undefined {
    for (let i = 0; i < model.length; i++) {
        if (target.tableId === model[i].target.name && target.projectId === model[i].target.database && target.datasetId === model[i].target.schema) {
            return { filePath: model[i].fileName, targetName: model[i].target.name };
        }
    }
    return undefined;
}


export function formatBytes(bytes: number) {
    if (bytes === 0) { return '0 B'; }

    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const k = 1024; // Use 1024 for binary prefixes (e.g., KiB) or 1000 for decimal

    // Find the appropriate unit level
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    // Convert to the unit and round to 2 decimal places
    const value = (bytes / Math.pow(k, i)).toFixed(2);

    return `${value} ${units[i]}`;
}

export async function getTableSchema(projectId: string, datasetId: string, tableId: string): Promise<{ name: string, metadata: { fullTableId: string } }[]> {
    try {
        await checkAuthentication();
        const bigquery = getBigQueryClient();
        if (!bigquery) {
            vscode.window.showErrorMessage('Error creating BigQuery client Please check your authentication.');
            return [];
        }
        const dataset = bigquery.dataset(datasetId, { projectId: projectId });
        const [table] = await dataset.table(tableId).get();
        return table.metadata.schema.fields.map((field: { name: string, type: string, description: string }) => {
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


export function sendNotifactionToUserOnExtensionUpdate(context: vscode.ExtensionContext) {
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

export function getHighlightJsThemeUri() {
    let themeKind = vscode.window.activeColorTheme.kind;
    if (themeKind === vscode.ColorThemeKind.HighContrastLight || themeKind === vscode.ColorThemeKind.Light) {
        return cdnLinks.highlightJsOneLightThemeUri;
    } else {
        return cdnLinks.highlightJsOneDarkThemeUri;
    }
}

export function getTabulatorThemeUri() {
    let themeKind = vscode.window.activeColorTheme.kind;
    if (themeKind === vscode.ColorThemeKind.HighContrastLight || themeKind === vscode.ColorThemeKind.Light) {
        return { tabulatorCssUri: cdnLinks.tabulatorLightCssUri, type: "light" };
    } else {
        return { tabulatorCssUri: cdnLinks.tabulatorDarkCssUri, type: "dark" };
    }
}

//@ts-ignore
function getTreeRootFromWordInStruct(struct: Table[] | Operation[] | Assertion[] | Declarations[], searchTerm: string): string | undefined {
    if (struct) {
        for (let i = 0; i < struct.length; i++) {
            let declarationName = struct[i].target.name;
            if (searchTerm === declarationName) {
                return `${struct[i].target.database}.${struct[i].target.schema}.${struct[i].target.name}`;
            }
        }
    }
}

export async function getDependentsOfTarget(targetToSearch: Target) {
    const targetKey = `${targetToSearch.database}.${targetToSearch.schema}.${targetToSearch.name}`;
    const dependents = TARGET_DEPENDENTS_MAP.get(targetKey) || [];
    logger.debug(`Found ${dependents.length} dependents for ${targetKey} from cache`);
    return dependents;
}

export async function getCurrentFileMetadata(freshCompilation: boolean): Promise<CurrentFileMetadata | undefined> {
    let document = activeDocumentObj || vscode.window.activeTextEditor?.document;
    if (!document) {
        return;
    }
    logger.debug(`Getting current file metadata for document: ${document.uri.fsPath}`);

    var result = getFileNameFromDocument(document, false);
    if (result.success === false) {
        { return { errors: { errorGettingFileNameFromDocument: result.error } }; }
    }

    const [filename, relativeFilePath, extension] = result.value;
    logger.debug(`File name: ${filename}, relative file path: ${relativeFilePath}, extension: ${extension}`);
    if (!workspaceFolder) {
        workspaceFolder = await getWorkspaceFolder();
    }
    if (!workspaceFolder) { return { isDataformWorkspace: false }; }
    logger.debug(`Workspace folder: ${workspaceFolder}`);

    if (freshCompilation || !CACHED_COMPILED_DATAFORM_JSON) {
        if (freshCompilation) {
            logger.debug('Fresh compilation requested, ignoring cache');
        } else {
            logger.debug('No cached compilation found, performing fresh compilation');
        }
        let { dataformCompiledJson, errors, possibleResolutions } = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);

            if (fileMetadata?.tables?.length === 0) {
                return {
                    errors: { fileNotFoundError: true },
                    pathMeta: {
                        filename: filename,
                        extension: extension,
                        relativeFilePath: relativeFilePath
                    },
                };
            } else if (fileMetadata?.queryMeta.error !== "") {
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
            if (targetToSearch) {
                dependents = await getDependentsOfTarget(targetToSearch);
            }

            return {
                isDataformWorkspace: true,
                errors: { dataformCompilationErrors: errors },
                possibleResolutions: possibleResolutions,
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
        else if (errors?.length !== 0) {
            CACHED_COMPILED_DATAFORM_JSON = undefined;
            logger.debug('Clearing compilation cache due to errors');
            logger.debug(`Compilation errors: ${JSON.stringify(errors)}`);
            return {
                isDataformWorkspace: true,
                errors: { dataformCompilationErrors: errors },
                possibleResolutions: possibleResolutions,
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
        logger.debug('Using cached compilation data');
        let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, CACHED_COMPILED_DATAFORM_JSON, workspaceFolder);

        if (fileMetadata?.queryMeta.error !== "") {
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
        if (targetToSearch) {
            dependents = await getDependentsOfTarget(targetToSearch);
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
export async function getPostionOfVariableInJsFileOrBlock(document: vscode.TextDocument | vscode.Uri, searchTerm: string, startLine: number, endLine: number) {
    if (document instanceof vscode.Uri) {
        document = await vscode.workspace.openTextDocument(document);
    }

    if (endLine === -1) {
        endLine = document.lineCount;
    }

    let line = null;
    let character = null;

    const varRegex = new RegExp(`(var|let|const)\\s+${searchTerm}\\s*=`, 'i');
    const funcRegex = new RegExp(`function\\s+${searchTerm}\\s*\\(`, 'i');

    for (let lineNum = startLine; lineNum < endLine; lineNum++) {
        const lineText = document.lineAt(lineNum).text;

        if ((varRegex.test(lineText) || funcRegex.test(lineText))) {
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
    if (endLine === -1) {
        endLine = document.lineCount - 1;
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

    if (!workspaceFolder) {
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

// Cache for executable path resolution to avoid repeated filesystem calls
export function executableIsAvailable(name: string, showErrorOnNotFound: boolean = false): boolean {
    const foundPath = findExecutableInPaths(name);

    if (!foundPath && showErrorOnNotFound) {
        vscode.window.showErrorMessage(`${name} cli not found`, "Installation Guide").then(selection => {
            if (selection === "Installation Guide") {
                vscode.env.openExternal(vscode.Uri.parse("https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#requirements"));
            }
        });
    }

    return !!foundPath;
}

const executablePathCache: ExecutablePathCache = new Map<string, ExecutablePathInfo>();

// Find executable using built-in detection + user overrides
function findExecutableInPaths(executableName: string): string | null {
    const cacheKey = `${executableName}:${process.platform}`;
    const cached = executablePathCache.get(cacheKey);

    // Return cached result if still valid
    if (cached && (Date.now() - cached.timestamp) < cacheDurationMs) {
        logger.debug(`Binary path cache hit for ${executableName}: ${cached.path}`);
        return cached.path;
    }

    logger.debug(`Binary path cache miss for ${executableName}, searching...`);

    // 1. Check user-specified exact path first (highest priority)
    const specificPath = getSpecificExecutablePath(executableName);
    if (specificPath) {
        logger.debug(`Found ${executableName} via user config: ${specificPath}`);
        executablePathCache.set(cacheKey, { path: specificPath, timestamp: Date.now() });
        return specificPath;
    }

    // 2. Check system PATH with enhanced detection
    const systemPath = findExecutableInSystemPath(executableName);
    if (systemPath) {
        logger.debug(`Found ${executableName} via system PATH: ${systemPath}`);
        executablePathCache.set(cacheKey, { path: systemPath, timestamp: Date.now() });
        return systemPath;
    }

    // 3. Check common tool manager and installation locations  
    const commonPath = findExecutableInCommonLocations(executableName);
    if (commonPath) {
        logger.debug(`Found ${executableName} via common locations: ${commonPath}`);
    } else {
        logger.debug(`${executableName} not found in any location`);
    }
    executablePathCache.set(cacheKey, { path: commonPath, timestamp: Date.now() });
    return commonPath;
}

// Get user-specified exact path for executable
function getSpecificExecutablePath(executableName: string): string | null {
    try {
        const vscodeConfig = vscode.workspace.getConfiguration('vscode-dataform-tools');
        const configKey = `${executableName}ExecutablePath`;
        const specificPath = vscodeConfig.get<string>(configKey);

        logger.debug(`Checking user config for ${executableName} at key '${configKey}': ${specificPath || 'not set'}`);

        if (specificPath && isValidExecutablePath(specificPath)) {
            logger.debug(`Validated user-specified path for ${executableName}: ${specificPath}`);
            return specificPath;
        }

        if (specificPath && !isValidExecutablePath(specificPath)) {
            logger.debug(`Invalid user-specified path for ${executableName}: ${specificPath}`);
        }

        return null;
    } catch (error) {
        logger.debug(`Configuration error for ${executableName}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

// Enhanced system PATH search
function findExecutableInSystemPath(executableName: string): string | null {
    try {
        const command = isRunningOnWindows ? 'where' : 'which';
        logger.debug(`Searching for ${executableName} using '${command}' command`);

        const result = execSync(`${command} ${executableName}`, {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true
        }).trim();

        if (result) {
            const firstPath = result.split('\n')[0].trim();
            logger.debug(`System PATH search result for ${executableName}: ${firstPath}`);

            if (isValidExecutablePath(firstPath)) {
                logger.debug(`Validated system PATH for ${executableName}: ${firstPath}`);
                return firstPath;
            } else {
                logger.debug(`Invalid system PATH result for ${executableName}: ${firstPath}`);
            }
        } else {
            logger.debug(`No system PATH result for ${executableName}`);
        }
    } catch (error) {
        logger.debug(`System PATH search failed for ${executableName}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
}

// Check common tool manager and installation locations
function findExecutableInCommonLocations(executableName: string): string | null {
    const commonPaths = getCommonExecutablePaths(executableName);
    logger.debug(`Searching ${commonPaths.length} common locations for ${executableName}`);

    for (const testPath of commonPaths) {
        logger.debug(`Testing common location: ${testPath}`);
        if (isValidExecutablePath(testPath)) {
            logger.debug(`Found ${executableName} at common location: ${testPath}`);
            return testPath;
        }
    }

    logger.debug(`${executableName} not found in any common location`);
    return null;
}

// Get common paths where executables might be installed
function getCommonExecutablePaths(executableName: string): string[] {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const extensions = getExecutableExtensions();
    const paths: string[] = [];

    // Common tool manager locations
    const toolManagerDirs = [
        `${homeDir}/.local/share/mise/shims`,
        `${homeDir}/.asdf/shims`,
        `${homeDir}/.nvm/current/bin`,
        `${homeDir}/.nodenv/shims`,
        `${homeDir}/.rbenv/shims`,
        `${homeDir}/.pyenv/shims`,
        `${homeDir}/.local/bin`,
        `${homeDir}/bin`,
        `${homeDir}/.cargo/bin`,
        // Homebrew
        '/opt/homebrew/bin',
        '/usr/local/bin',
        // Standard system locations
        '/usr/bin',
        '/bin'
    ];

    // Executable-specific locations
    if (executableName === 'gcloud') {
        toolManagerDirs.push(
            `${homeDir}/google-cloud-sdk/bin`,
            '/usr/local/google-cloud-sdk/bin',
            '/usr/local/opt/google-cloud-sdk/bin',
            '/snap/bin'
        );
    }

    // Generate full paths with extensions
    for (const dir of toolManagerDirs) {
        for (const ext of extensions) {
            paths.push(path.join(dir, executableName + ext));
        }
    }

    return paths;
}

// Cross-platform executable extensions
function getExecutableExtensions(): string[] {
    return isRunningOnWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
}

// Cross-platform executable validation
function isValidExecutablePath(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) {
            return false;
        }

        if (isRunningOnWindows) {
            // On Windows, check file extension or try to access
            const ext = path.extname(filePath).toLowerCase();
            return ['.exe', '.cmd', '.bat'].includes(ext) || ext === '';
        } else {
            // On Unix systems, check if file is executable
            try {
                fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
                return true;
            } catch {
                return false;
            }
        }
    } catch {
        return false;
    }
}

// Clear cache when needed (for testing or configuration changes)
export function clearExecutablePathCache(): void {
    executablePathCache.clear();
}

// Debug function for troubleshooting executable detection issues
export function debugExecutablePaths(): void {
    // Clear cache for fresh testing
    clearExecutablePathCache();

    const executables: string[] = ['dataform', 'gcloud'];
    const results: string[] = [];

    executables.forEach(exe => {
        const foundPath = findExecutableInPaths(exe);
        results.push(`${exe}: ${foundPath || 'Not found'}`);
    });

    // Show concise results to user
    const message = `Executable Detection Results:\n\n${results.join('\n')}`;
    vscode.window.showInformationMessage('Debug Results', 'Show Details').then(selection => {
        if (selection === 'Show Details') {
            vscode.window.showInformationMessage(message);
        }
    });
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

        const selectedFolder = await vscode.window.showQuickPick(folderOptions, { placeHolder: "Select the Dataform workspace which this file belongs to" });
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
    const extWithDot = path.extname(filePath);
    const extension = extWithDot.startsWith('.') ? extWithDot.slice(1) : extWithDot;
    const rawFileName = path.basename(filePath, extWithDot);
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
    return { success: true, value: [rawFileName, relativeFilePath, extension] };
}

//
//WARN: What if user has multiple workspaces open in the same window
//TODO: we are taking the first workspace from the active workspaces. Is it possible to handle cases where there are multiple workspaces in the same window ?
//
//TODO: What if user has no workspaces open ?
//
export async function getWorkspaceFolder(): Promise<string | undefined> {
    if (!workspaceFolder) {
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
        logger.debug('Returning cached compiled dataform JSON');
        return CACHED_COMPILED_DATAFORM_JSON;
    }
    logger.debug('No cached compilation found, compiling dataform project...');
    vscode.window.showWarningMessage(
        "Compiling Dataform project, this may take a few moments..."
    );
    const { dataformCompiledJson } = await runCompilation(workspaceFolder);
    return dataformCompiledJson;
}

export function runCommandInTerminal(command: string) {
    if(isRunningOnWindows){
        command = "cmd /C " + command;
    }
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
    let trimInitial = false;
    const globPattern = new vscode.RelativePattern(workspaceFolder, `**/*${extension}`);
    const workspaces = vscode.workspace.workspaceFolders;
    if(workspaces && workspaces?.length > 1){
        trimInitial = true;
    }
    let files = await vscode.workspace.findFiles(globPattern);
    const fileList = files.map((file) => {
        if(trimInitial){
            const pathParts = vscode.workspace.asRelativePath(file).split(path.posix.sep);
            if(isRunningOnWindows){
            return path.win32.normalize(pathParts.slice(1).join(path.win32.sep));
            }
            return path.posix.normalize(pathParts.slice(1).join(path.posix.sep));
        }
         const relativePath = vscode.workspace.asRelativePath(file);
         if(isRunningOnWindows){
             return path.win32.normalize(relativePath);
         }
         return relativePath;
    });
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


// Optimized getQueryMetaForCurrentFile using FILE_NODE_MAP cache
export async function getQueryMetaForCurrentFile(relativeFilePath: string, compiledJson: DataformCompiledJson, workspaceFolder:string): Promise<TablesWtFullQuery> {

    const { notebooks } = compiledJson;

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
                            queryMeta.tableOrViewQuery += (queryMeta.tableOrViewQuery ? "\n" : "") + curTableQuery;
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
            if(queryMeta.type !== "js" && queryMeta.tableOrViewQuery === "" && queryMeta.incrementalQuery === "") {
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
                    queryMeta.tableOrViewQuery += `Open: ${notebook.fileName} \n`;
                }
            }
      });
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
    logger.debug(`Dataform CLI scope setting: ${dataformCliScope || 'not set (using global)'}`);

    if (dataformCliScope === 'local') {
        const dataformCliLocalScopePath = isRunningOnWindows
            ? path.join('node_modules', '.bin', 'dataform.cmd')
            : path.join('node_modules', '.bin', 'dataform');
        const fullLocalPath = path.join(workspaceFolder, dataformCliLocalScopePath);
        logger.debug(`Using local dataform CLI: ${fullLocalPath}`);
        return fullLocalPath;
    }

    const resolvedPath = findExecutableInPaths('dataform') || dataformCliBase;
    logger.debug(`Using global dataform CLI: ${resolvedPath}`);
    return resolvedPath;
}

export function compileDataform(workspaceFolder: string): Promise<{ compiledString: string | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined }> {
    let dataformCompilationTimeoutVal = getDataformCompilationTimeoutFromConfig();
    let dataformCompilerOptions = getDataformCompilerOptions();
    let compilerOptions: string[] = [];
    if (dataformCompilerOptions !== "") {
        compilerOptions.push(dataformCompilerOptions);
    }
    logger.debug(`compilerOptions: ${compilerOptions}`);
    return new Promise((resolve, reject) => {
        let spawnedProcess;
        let customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
        logger.debug(`customDataformCliPath: ${customDataformCliPath}`);
        spawnedProcess = spawn(customDataformCliPath, ["compile", '"' + workspaceFolder + '"', ...compilerOptions, "--json", "--json", `--timeout=${dataformCompilationTimeoutVal}`], { shell: true });

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
                if(compilerOptions.length>0){
                    compilerOptionsMap = createCompilerOptionsObjectForApi(compilerOptions);
                }else{
                    compilerOptionsMap = {};
                }

                logger.debug(`compilerOptionsMap: ${JSON.stringify(compilerOptionsMap)}`);
                resolve({ compiledString: stdOut, errors: undefined, possibleResolutions: undefined });
            } else {
                if (stdOut !== '') {
                    let compiledJson: DataformCompiledJson;
                    try {
                        compiledJson = JSON.parse(stdOut.toString());
                    } catch (parseError) {
                        compiledJson = extractDataformJsonFromMultipleJson(stdOut.toString());
                    }

                    let graphErrors = compiledJson?.graphErrors?.compilationErrors;
                    if (!graphErrors) {
                        const dataformPackageJsonMissingHint = "(missing dataform.json file)";
                        const dataformInstallHintv2 = "Could not find a recent installed version of @dataform/core in the project";
                        const possibleResolutions = [];
                        if (errorOutput.includes(dataformPackageJsonMissingHint)) {
                            possibleResolutions.push("Run `<b>dataform compile</b>` in terminal to get full error");
                            possibleResolutions.push("Verify the dataform version of the project matches the version used in the project (<b>dataform --version</b> in terminal)");
                            possibleResolutions.push("If your project is using dataform version 3.x run <b>npm i -g @dataform/cli</b> in terminal)");
                        } else if (errorOutput.includes(dataformInstallHintv2)) {
                            possibleResolutions.push("run `<b>dataform install</b>` in terminal followed by reload window and compile the file again");
                        }
                        resolve({ compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${errorOutput}`, fileName: "" }], possibleResolutions: possibleResolutions });
                        return;
                    }

                    let errors: GraphError[] = [];
                    graphErrors.forEach((graphError: { message: string, fileName: string }) => {
                        errors.push({ error: graphError.message, fileName: graphError.fileName });
                    });
                    resolve({ compiledString: undefined, errors: errors, possibleResolutions: undefined });
                } else {
                    let possibleResolutions = [];
                    const dataformInstallHintv3 = "If using `package.json`, then run `dataform install`";
                    if (errorOutput.includes(dataformInstallHintv3)) {
                        const _workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if (_workspaceFolder) {
                            const filePath = path.join(_workspaceFolder, 'package.json');
                            const packageJsonExsists = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                            if (packageJsonExsists) {
                                possibleResolutions.push("run `<b>dataform install</b>` in terminal");
                            }
                        }
                    } else if (errorOutput.includes(windowsDataformCliNotAvailableErrorMessage) || errorOutput.includes(linuxDataformCliNotAvailableErrorMessage)) {
                        possibleResolutions.push("Run `<b>npm install -g @dataform/cli</b>` in terminal");
                    };
                    resolve({ compiledString: undefined, errors: [{ error: `Error compiling Dataform: ${errorOutput}`, fileName: "" }], possibleResolutions: possibleResolutions });
                }
            }
        });

        spawnedProcess.on('error', (err: Error) => {
            reject(err);
        });
    });
}

function parseMultipleJSON(str: string) {
    /*
    NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string
    so we need to parse them separately to ensure there is no error in parsing and we get the compilation metadata of Dataform project
    */
    const result = [];
    let startIndex = str.indexOf('{');
    let openBraces = 0;

    for (let i = startIndex; i < str.length; i++) {
        if (str[i] === '{') {
            if (openBraces === 0) { startIndex = i; };
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

function extractDataformJsonFromMultipleJson(compiledString: string) {
    //NOTE: we do this because dataform cli v2.x returns multiple JSON objects in the same string. From observation, index 1 is the JSON object that has Dataform compilation metadata
    const parsedObjects = parseMultipleJSON(compiledString);
    if (parsedObjects.length > 0) {
        return parsedObjects[1] as DataformCompiledJson;
    } else {
        throw new Error("Failed to parse JSON");
    }
}

export async function runCompilation(workspaceFolder: string): Promise<{ dataformCompiledJson: DataformCompiledJson | undefined, errors: GraphError[] | undefined, possibleResolutions: string[] | undefined }> {
    try {
        let { compiledString, errors, possibleResolutions } = await compileDataform(workspaceFolder);
        if (compiledString) {
            let dataformCompiledJson: DataformCompiledJson;
            try {
                dataformCompiledJson = JSON.parse(compiledString);
            } catch (parseError) {
                dataformCompiledJson = extractDataformJsonFromMultipleJson(compiledString);
            }
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            buildIndices(dataformCompiledJson);
            logger.debug(`Successfully cached compiled dataform JSON. Targets: ${dataformCompiledJson.targets?.length || 0}, Declarations: ${dataformCompiledJson.declarations?.length || 0}`);
            return { dataformCompiledJson: dataformCompiledJson, errors: errors, possibleResolutions: possibleResolutions };
        }
        return { dataformCompiledJson: undefined, errors: errors, possibleResolutions: possibleResolutions };
    } catch (error: any) {
        return { dataformCompiledJson: undefined, errors: [{ error: `Error compiling Dataform: ${error.message}`, fileName: "" }], possibleResolutions: undefined };
    }
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

export async function ensureSqlfluffConfigExists(sqlfluffConfigFilePath: string) {
    if (!checkIfFileExsists(sqlfluffConfigFilePath)) {
        vscode.window.showInformationMessage(`Trying to fetch .sqlfluff file compatable with .sqlx files`);
        let sqlfluffConfigFileContents = await fetchGitHubFileContent();
        writeContentsToFile(sqlfluffConfigFilePath, sqlfluffConfigFileContents);
        vscode.window.showInformationMessage(`Created .sqlfluff file at ${sqlfluffConfigFilePath}`);
    }
}

export async function getMultipleFileSelection(workspaceFolder: string) {
    const fileList = await getAllFilesWtAnExtension(workspaceFolder, "sqlx");
    let options = {
        canPickMany: true,
        ignoreFocusOut: true,
    };
    let selectedFiles = await vscode.window.showQuickPick(fileList, options);
    if (!selectedFiles) {
        return undefined;
    }
    return Array.isArray(selectedFiles) ? selectedFiles : [selectedFiles];
}

export async function runMultipleFilesFromSelection(context: vscode.ExtensionContext, workspaceFolder: string, selectedFiles: string[], includeDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean, executionMode:ExecutionMode) {
    let fileMetadatas: any[] = [];

    let dataformCompiledJson = await runCompilation(workspaceFolder);

    if (selectedFiles && dataformCompiledJson.dataformCompiledJson !== undefined) {
        for (let i = 0; i < selectedFiles.length; i++) {
            let relativeFilepath = selectedFiles[i];
            if (dataformCompiledJson && relativeFilepath) {
                fileMetadatas.push(await getQueryMetaForCurrentFile(relativeFilepath, dataformCompiledJson.dataformCompiledJson, workspaceFolder));
            }
        }
    }

    let includedTargets: {database:string, schema: string, name:string}[] = [];
    fileMetadatas.forEach(fileMetadata => {
        if (fileMetadata) {
            fileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; }) => {
                includedTargets.push({database: table.target.database, schema: table.target.schema, name: table.target.name});
            });
        }
    });

    const invocationConfig = {
        includedTargets: includedTargets,
        transitiveDependenciesIncluded: includeDependencies,
        transitiveDependentsIncluded: includeDownstreamDependents,
        fullyRefreshIncrementalTablesEnabled: fullRefresh,
    };

    if(executionMode === "api_workspace"){
        await showLoadingProgress(
            "",
            syncAndrunDataformRemotely,
            "Dataform remote workspace execution cancelled",
            context,
            invocationConfig,
            compilerOptionsMap,
        );
        return;
    }

    if(executionMode === "api"){

        const projectId = CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase;
        if(!projectId){
            vscode.window.showErrorMessage("Unable to determine GCP project id to use for Dataform API run");
            return;
        }

        try{
            const gitClient = new GitService();
            const gitInfo = gitClient.getGitBranchAndRepoName();
            if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
                throw new Error("Error determining git repository and or branch name");
            } 
            const repositoryName = gitInfo.gitRepoName;
            vscode.window.showInformationMessage(`Creating workflow invocation with ${gitInfo.gitBranch} remote git branch ...`);

            const gcpProjectLocation = await getCachedDataformRepositoryLocation(context, repositoryName);
            if (!gcpProjectLocation) {
                vscode.window.showInformationMessage("Could not determine the location where Dataform repository is hosted, aborting...");
                return;
            }

            const dataformClient = new DataformTools(projectId, gcpProjectLocation);

            const ouput = await dataformClient.runDataformRemotely(repositoryName, compilerOptionsMap, invocationConfig, undefined, gitInfo.gitBranch);
            if(!ouput){
                throw new Error("No response received from Dataform API for workflow invocation creation");
            }
            sendWorkflowInvocationNotification(ouput.workflowInvocationUrl);
        } catch(error:any){
            vscode.window.showErrorMessage(error.message);
        }
    } else if (executionMode === "cli") {
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
        dataformActionCmd = getDataformActionCmdFromActionList(actionsList, workspaceFolder, dataformCompilationTimeoutVal, includeDependencies, includeDownstreamDependents, fullRefresh);
        runCommandInTerminal(dataformActionCmd);
    }
}

export function handleSemicolonPrePostOps(fileMetadata: TablesWtFullQuery) {
    const preOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.preOpsQuery);
    const icrementalPreOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.incrementalPreOpsQuery);
    const postOpsEndsWithSemicolon = /;\s*$/.test(fileMetadata.queryMeta.postOpsQuery);

    if (!preOpsEndsWithSemicolon && fileMetadata.queryMeta.preOpsQuery !== "") {
        fileMetadata.queryMeta.preOpsQuery = fileMetadata.queryMeta.preOpsQuery.trimEnd() + ";" + "\n";
    }

    if (!icrementalPreOpsEndsWithSemicolon && fileMetadata.queryMeta.incrementalPreOpsQuery !== "") {
        fileMetadata.queryMeta.incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimEnd() + ";" + "\n";
    }

    if (!postOpsEndsWithSemicolon && fileMetadata.queryMeta.postOpsQuery !== "") {
        fileMetadata.queryMeta.postOpsQuery = fileMetadata.queryMeta.postOpsQuery.trimEnd() + ";" + "\n";
    }
    return fileMetadata;
}

export async function gatherQueryAutoCompletionMeta() {
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        logger.debug('No cached compilation available for autocompletion');
        return;
    }
    logger.debug('Using cached compilation for autocompletion metadata');
    // all 2 of these together take approx less than 0.35ms (Dataform repository with 285 nodes)
    let [declarationsAndTargets, dataformTags] = await Promise.all([
        getDependenciesAutoCompletionItems(CACHED_COMPILED_DATAFORM_JSON),
        getDataformTags(CACHED_COMPILED_DATAFORM_JSON),
    ]);
    return {
        declarationsAndTargets: declarationsAndTargets, dataformTags: dataformTags
    };

}

function replaceQueryLabelWtEmptyStringForDryRun(query: string) {
    return query.replace(/SET\s+@@query_label\s*=\s*(['"]).*?\1\s*;/gi, '');
}

export async function dryRunAndShowDiagnostics(curFileMeta: any, document: vscode.TextDocument, diagnosticCollection: any, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
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
    const type = curFileMeta.fileMetadata.queryMeta.type;
    const fileMetadata = curFileMeta.fileMetadata;

    let isMultiModalJsType = type === "js" && fileMetadata.tables.map((table: any) => {
        return table.type === "table" || table.type === "view";
    }).length >= 1;

    const skipPreOpsInDryRun = vscode.workspace.getConfiguration('vscode-dataform-tools').get('skipPreOpsInDryRun');
    logger.debug(`skipPreOpsInDryRun: ${skipPreOpsInDryRun}`);

    if (type === "table" || type === "view" || isMultiModalJsType) {
        let preOpsQuery = fileMetadata.queryMeta.preOpsQuery;
        if (skipPreOpsInDryRun) {
            preOpsQuery = "";
        } else if (preOpsQuery && preOpsQuery !== "") {
            preOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(preOpsQuery);
        }
        queryToDryRun = preOpsQuery + fileMetadata.queryMeta.tableOrViewQuery;
    } else if (type === "assertion") {
        queryToDryRun = fileMetadata.queryMeta.assertionQuery;
    } else if (type === "operations") {
        let preOpsQuery = fileMetadata.queryMeta.preOpsQuery;
        if (skipPreOpsInDryRun) {
            preOpsQuery = "";
        }
        queryToDryRun = preOpsQuery + fileMetadata.queryMeta.operationsQuery;
    } else if (type === "incremental") {
        let incrementalPreOpsQuery = fileMetadata.queryMeta.incrementalPreOpsQuery.trimStart();
        let nonIncrementalPreOpsQuery = fileMetadata.queryMeta.preOpsQuery.trimStart();

        if (skipPreOpsInDryRun) {
            incrementalPreOpsQuery = "";
            nonIncrementalPreOpsQuery = "";
        }

        if (incrementalPreOpsQuery && incrementalPreOpsQuery !== "") {
            incrementalPreOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(incrementalPreOpsQuery);
        }
        if (nonIncrementalPreOpsQuery && nonIncrementalPreOpsQuery !== "") {
            nonIncrementalPreOpsQuery = replaceQueryLabelWtEmptyStringForDryRun(nonIncrementalPreOpsQuery);
        }
        incrementalQuery = incrementalPreOpsQuery + fileMetadata.queryMeta.incrementalQuery.trimStart();
        nonIncrementalQuery = nonIncrementalPreOpsQuery + fileMetadata.queryMeta.nonIncrementalQuery.trimStart();
    }

    // take ~400 to 1300ms depending on api response times, faster if `cacheHit`
    let [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, nonIncrementalDryRunResult, incrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult] = await Promise.all([
        queryDryRun(queryToDryRun),
        //TODO: If pre_operations block has an error the diagnostics wont be placed at correct place in main query block
        queryDryRun(fileMetadata.queryMeta.preOpsQuery),
        // To enable to use of variables declared in preOps.
        // Would result in incorrect cost for post operation though a tradeoff Im willing to have atm 
        // See https://github.com/ashish10alex/vscode-dataform-tools/issues/175
        (fileMetadata.queryMeta.postOpsQuery && fileMetadata.queryMeta.postOpsQuery !== "") ? queryDryRun(fileMetadata.queryMeta.preOpsQuery + fileMetadata.queryMeta.postOpsQuery) : Promise.resolve({ error: { hasError: false, message: "" } } as BigQueryDryRunResponse),
        queryDryRun(nonIncrementalQuery),
        queryDryRun(incrementalQuery),
        queryDryRun(fileMetadata.queryMeta.incrementalPreOpsQuery),
        queryDryRun(fileMetadata.queryMeta.assertionQuery),
    ]);

    if (dryRunResult.schema || nonIncrementalDryRunResult.schema) {
        compiledQuerySchema = type === "incremental" ? nonIncrementalDryRunResult.schema : dryRunResult.schema;
    } else if (dryRunResult.schema === undefined && dryRunResult.error.hasError === false) {
        // happens when Dataform config type is operation and dry run api response has no schema
        compiledQuerySchema = {
            fields: [
                {
                    name: "",
                    type: "",
                }
            ]
        };
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
        vscode.window.showInformationMessage(`GB: ${dryRunResult.statistics?.totalBytesProcessed || 0} - ${combinedTableIds}`);
    }
    return [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, incrementalDryRunResult, nonIncrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult];
}

export async function compiledQueryWtDryRun(document: vscode.TextDocument, diagnosticCollection: vscode.DiagnosticCollection, showCompiledQueryInVerticalSplitOnSave: boolean) {
    diagnosticCollection.clear();

    let curFileMeta = await getCurrentFileMetadata(true);

    if (!CACHED_COMPILED_DATAFORM_JSON || !curFileMeta) {
        return;
    }

    let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
    if (!queryAutoCompMeta) {
        return;
    }

    dataformTags = queryAutoCompMeta.dataformTags;
    declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

    dryRunAndShowDiagnostics(curFileMeta, document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);

    return [queryAutoCompMeta.dataformTags, queryAutoCompMeta.declarationsAndTargets];
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