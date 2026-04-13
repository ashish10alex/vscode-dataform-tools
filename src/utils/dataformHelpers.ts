import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { load as loadYaml, YAMLException } from 'js-yaml';
import { logger } from '../logger';
import { GitService } from '../gitClient';
import { DataformTools } from "@ashishalex/dataform-tools";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely } from "../dataformApiUtils";
import { CurrentFileMetadata, Target, Table, Operation, Assertion, Declarations, ExecutionMode } from '../types';
import { getWorkspaceFolder, selectWorkspaceFolder, getFileNameFromDocument, getAllFilesWtAnExtension } from './workspaceUtils';
import { runCompilation, getOrCompileDataformJson, getDataformCompilationTimeoutFromConfig, getDataformCompilerOptions, getDataformCliCmdBasedOnScope } from './dataformCompiler';
import { getQueryMetaForCurrentFile } from './queryMetadata';
import { getCachedDataformRepositoryLocation } from './gcpUtils';
import { showLoadingProgress, runCommandInTerminal } from './vscodeUi';
import { clearIndices } from './compiledJsonIndex';

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

export function sendNotificationToUserOnExtensionUpdate(context: vscode.ExtensionContext) {
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

    let packageJsonContent: any = null;
    if (filename === 'package' && extension === 'json') {
        try {
            const content = await fs.promises.readFile(document.uri.fsPath, 'utf-8');
            const pkg = JSON.parse(content);
            packageJsonContent = {
                name: pkg.name,
                dependencies: pkg.dependencies,
                devDependencies: pkg.devDependencies
            };
        } catch (e) {
            logger.error(`Error reading package.json: ${e}`);
        }
    }

    if (freshCompilation || !CACHED_COMPILED_DATAFORM_JSON) {
        if (freshCompilation) {
            logger.debug('Fresh compilation requested, ignoring cache');
        } else {
            logger.debug('No cached compilation found, performing fresh compilation');
        }
        let { dataformCompiledJson, errors, possibleResolutions, compilationTimeMs } = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);

            const isConfigFile = filename === 'workflow_settings' || filename === 'dataform' || (filename === 'package' && extension === 'json');

            if (fileMetadata?.tables?.length === 0 && !isConfigFile) {
                return {
                    errors: { fileNotFoundError: true },
                    pathMeta: {
                        filename: filename,
                        extension: extension,
                        relativeFilePath: relativeFilePath
                    },
                    projectConfig: dataformCompiledJson.projectConfig,
                    dataformCoreVersion: dataformCompiledJson.dataformCoreVersion,
                    packageJsonContent: packageJsonContent
                };
            } else if (fileMetadata?.queryMeta && fileMetadata.queryMeta.error !== "" && !isConfigFile) {
                return {
                    errors: { queryMetaError: fileMetadata?.queryMeta.error },
                    pathMeta: {
                        filename: filename,
                        extension: extension,
                        relativeFilePath: relativeFilePath
                    },
                    compilationTimeMs: compilationTimeMs,
                    projectConfig: dataformCompiledJson.projectConfig,
                    dataformCoreVersion: dataformCompiledJson.dataformCoreVersion,
                    packageJsonContent: packageJsonContent
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
                lineageMetadata: null,
                pathMeta: {
                    filename: filename,
                    extension: extension,
                    relativeFilePath: relativeFilePath
                },
                document: document,
                compilationTimeMs: compilationTimeMs,
                projectConfig: dataformCompiledJson.projectConfig,
                dataformCoreVersion: dataformCompiledJson.dataformCoreVersion,
                packageJsonContent: packageJsonContent
            };
        }
        else if (errors?.length !== 0) {
            CACHED_COMPILED_DATAFORM_JSON = undefined;
            clearIndices();
            logger.debug('Clearing compilation cache due to errors');
            logger.debug(`Compilation errors: ${JSON.stringify(errors)}`);
            return {
                isDataformWorkspace: true,
                errors: { dataformCompilationErrors: errors },
                possibleResolutions: possibleResolutions,
                fileMetadata: undefined,
                dependents: undefined,
                lineageMetadata: null,
                pathMeta: {
                    filename: filename,
                    extension: extension,
                    relativeFilePath: relativeFilePath
                },
                document: document,
                compilationTimeMs: compilationTimeMs,
                projectConfig: (dataformCompiledJson as any)?.projectConfig,
                dataformCoreVersion: (dataformCompiledJson as any)?.dataformCoreVersion,
                packageJsonContent: packageJsonContent
            };
        }
    } else {
        logger.debug('Using cached compilation data');
        let fileMetadata = await getQueryMetaForCurrentFile(relativeFilePath, CACHED_COMPILED_DATAFORM_JSON!, workspaceFolder);

        if (fileMetadata?.queryMeta.error !== "") {
            return {
                errors: { queryMetaError: fileMetadata?.queryMeta.error },
                pathMeta: {
                    filename: filename,
                    extension: extension,
                    relativeFilePath: relativeFilePath
                },
                packageJsonContent: packageJsonContent
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
            lineageMetadata: null,
            pathMeta: {
                filename: filename,
                extension: extension,
                relativeFilePath: relativeFilePath
            },
            document: document,
            projectConfig: CACHED_COMPILED_DATAFORM_JSON!.projectConfig,
            dataformCoreVersion: CACHED_COMPILED_DATAFORM_JSON!.dataformCoreVersion,
            packageJsonContent: packageJsonContent
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

    const escapedSearchTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const varRegex = new RegExp(`(var|let|const)\\s+${escapedSearchTerm}\\s*=`, 'i');
    const funcRegex = new RegExp(`function\\s+${escapedSearchTerm}\\s*\\(`, 'i');

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
            fileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; type?: string }) => {
                if (table.type === 'test') { return; }
                includedTargets.push({database: table.target.database, schema: table.target.schema, name: table.target.name});
            });
        }
    });

    if (!dataformCompiledJson.dataformCompiledJson || (dataformCompiledJson.errors && dataformCompiledJson.errors.length > 0) || includedTargets.length === 0) {
        vscode.window.showErrorMessage("Dataform execution aborted: Compilation failed or no valid targets found.");
        return;
    }

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

        const gcpProjectIdOveride = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
        const projectId = (gcpProjectIdOveride || CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase) as string | undefined;
        if(!projectId){
            vscode.window.showErrorMessage("Unable to determine GCP project id to use for Dataform API run");
            return;
        }

        try{
            const gitClient = new GitService();
            const gitInfo = await gitClient.getGitBranchAndRepoName();
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

            const output = await dataformClient.runDataformRemotely(repositoryName, compilerOptionsMap, invocationConfig, undefined, gitInfo.gitBranch);
            if(!output){
                throw new Error("No response received from Dataform API for workflow invocation creation");
            }
            await sendWorkflowInvocationNotification(
                output.workflowInvocationUrl,
                context,
                invocationConfig,
                gitInfo.gitBranch,
                "api",
                output.workflowInvocationId,
                projectId,
                gcpProjectLocation,
                repositoryName
            );
        } catch(error:any){
            vscode.window.showErrorMessage(error.message);
        }
    } else if (executionMode === "cli") {
        let actionsList: string[] = [];
        fileMetadatas.forEach(fileMetadata => {
            if (fileMetadata) {
                fileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; type?: string }) => {
                    if (table.type === 'test') { return; }
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

export async function readDataformCoreVersion(
  resolvedProjectPath: string
): Promise<string | undefined> {
  const workflowSettingsPath = path.join(resolvedProjectPath, "workflow_settings.yaml");
  const dataformJsonPath = path.join(resolvedProjectPath, "dataform.json");

  let configPath = workflowSettingsPath;
  try {
    await fs.promises.access(workflowSettingsPath);
  } catch {
    try {
      await fs.promises.access(dataformJsonPath);
      configPath = dataformJsonPath;
    } catch {
      return;
    }
  }

  const content = await fs.promises.readFile(configPath, "utf-8");
  let configAsJson: any = {};
  if (configPath.endsWith(".yaml")) {
    try {
      configAsJson = loadYaml(content);
    } catch (e) {
      if (e instanceof YAMLException) {
        return undefined;
      }
      throw e;
    }
  } else {
    try {
      configAsJson = JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  return configAsJson?.dataformCoreVersion;
}
