import * as vscode from 'vscode';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { DataformCompiledJson } from './types';
import { createBigQueryClient, setAuthenticationCheckInterval, clearAuthenticationCheckInterval } from './bigqueryClient';
import { CustomViewProvider } from './views/register-query-results-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRequireDefinitionProvider, DataformJsDefinitionProvider, DataformCTEDefinitionProvider } from './definitionProvider';
import { DataformConfigProvider, DataformHoverProvider, DataformBigQueryHoverProvider } from './hoverProvider';
import { defaultCdnLinks, executablesToCheck } from './constants';
import { getWorkspaceFolder, getCurrentFileMetadata, sendNotifactionToUserOnExtensionUpdate, selectWorkspaceFolder } from './utils';
import { executableIsAvailable } from './utils';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable, schemaAutoCompletionDisposable, configBlockAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { createNewDataformProject } from './createNewDataformProject';
import { AssertionRunnerCodeLensProvider, TagsRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { renameProvider } from './renameProvider';
import { formatDataformSqlxFile, lintCurrentFile } from './formatCurrentFile';
import { previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runCurrentFile } from './runCurrentFile';
import { CompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';
import { logger } from './logger';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';
import { SqlxDocumentSymbolProvider } from './documentSymbols';
import { debounce } from './debounce';


// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    // Initialize logger at the start
    logger.initialize();
    logger.info('Activating Dataform Tools extension');

    sendNotifactionToUserOnExtensionUpdate(context);

    // Add logger to subscriptions for cleanup
    context.subscriptions.push({
        dispose: () => logger.dispose()
    });

    globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined as DataformCompiledJson | undefined;
    logger.debug('Extension activated - initialized global cache (CACHED_COMPILED_DATAFORM_JSON = undefined)');
    globalThis.declarationsAndTargets = [] as string[];
    globalThis.dataformTags = [] as string[];
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.isWsl = vscode.env.remoteName === "wsl";
    globalThis.bigQueryJob = undefined;
    globalThis._bigQueryJobId = undefined;
    globalThis.cancelBigQueryJobSignal = false;
    globalThis.queryLimit = 1000;
    globalThis.diagnosticCollection = undefined;
    globalThis.cdnLinks = defaultCdnLinks;
    globalThis.compiledQuerySchema = undefined;
    globalThis.incrementalCheckBox = false;
    globalThis.schemaAutoCompletions = [];
    globalThis.columnHoverDescription = { fields: [] };
    globalThis.activeEditorFileName = undefined;
    globalThis.activeDocumentObj = undefined;
    globalThis.workspaceFolder = undefined;
    globalThis.errorInPreOpsDenyList = false;
    globalThis.compilerOptionsMap = {};
    globalThis.FILE_NODE_MAP = new Map();
    globalThis.TARGET_DEPENDENTS_MAP = new Map();
    globalThis.TARGET_NAME_MAP = new Map();

    const snippetsPath = path.join(context.extensionPath, "snippets", "bigquery.code-snippets.json");
    const snippetsContent = fs.readFileSync(snippetsPath, 'utf8');
    globalThis.bigQuerySnippetMetadata = JSON.parse(snippetsContent)[".source.sql-bigquery"];

    for (let i = 0; i < executablesToCheck.length; i++) {
        let executable = executablesToCheck[i];
        logger.debug(`Checking executable availability: ${executable}`);
        executableIsAvailable(executable, true); // Show error if not found
    }

    // Clean up on deactivation
    context.subscriptions.push({
        dispose: () => clearAuthenticationCheckInterval()
    });

    diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerCompiledQueryPanel(context);

    const queryResultsViewProvider = new CustomViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('queryResultsView', queryResultsViewProvider));


    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runQuery', async () => {
            logger.info('Running query command');
            await previewQueryResults(queryResultsViewProvider);
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.dependencyGraphPanel', async () => {
        createDependencyGraphPanel(context, vscode.ViewColumn.One);
    }));

    const debouncedActiveEditorChange = debounce(async (editor: vscode.TextEditor | undefined) => {
        if (editor && queryResultsViewProvider._view?.visible) {
            let curFileMeta = await getCurrentFileMetadata(false);
            let type = curFileMeta?.fileMetadata?.queryMeta.type;
            queryResultsViewProvider._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox });
        }
    }, 500);
    vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.cancelQuery', async () => { await cancelBigQueryJob(); }));

    const checkConfigBlockDiagnostics = (document: vscode.TextDocument) => {
        if (document.languageId !== 'sqlx') {
            return;
        }

        const diagnostics: vscode.Diagnostic[] = [];
        const lines = document.getText().split(/\r?\n/);

        let inConfigBlock = false;
        let inBigQueryBlock = false;
        let inAssertionBlock = false;
        let configBraceDepth = 0;
        let bigQueryBraceDepth = 0;
        let assertionBraceDepth = 0;
        
        // Scan up to 50 lines looking for the config block
        const maxLinesToScan = Math.min(lines.length, 50);

        for (let i = 0; i < maxLinesToScan; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.length === 0) { continue; }

            if (!inConfigBlock && trimmed.startsWith('config {')) {
                inConfigBlock = true;
                configBraceDepth = 1;
                if (trimmed.endsWith('}')) {
                    inConfigBlock = false;
                    configBraceDepth = 0;
                }
            } else if (inConfigBlock) {
                // Check for nested bigquery block
                if (!inBigQueryBlock && trimmed.match(/bigquery\s*:\s*\{/)) {
                    inBigQueryBlock = true;
                    bigQueryBraceDepth = 1;
                    if (trimmed.endsWith('}')) {
                        inBigQueryBlock = false;
                        bigQueryBraceDepth = 0;
                    }
                    continue; // Skip counting the first '{' of bigquery again
                }

                // Check for nested assertions block
                if (!inAssertionBlock && trimmed.match(/assertions\s*:\s*\{/)) {
                    inAssertionBlock = true;
                    assertionBraceDepth = 1;
                    if (trimmed.endsWith('}')) {
                        inAssertionBlock = false;
                        assertionBraceDepth = 0;
                    }
                    continue; // Skip counting the first '{' of assertions again
                }

                const addDiagnostic = (lineIndex: number, matchVal: string, message: string) => {
                    const startIndex = line.indexOf(matchVal);
                    const endIndex = startIndex + matchVal.length;
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(lineIndex, startIndex, lineIndex, endIndex),
                        message,
                        vscode.DiagnosticSeverity.Warning
                    ));
                };

                const checkBooleanProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringValMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringValMatch) {
                            addDiagnostic(lineIndex, stringValMatch[1], `Invalid ${prop} value: ${stringValMatch[1]}. Must be a boolean (true or false) without quotes.`);
                        }
                        const invalidWordMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^"'\\s,{}]+)`));
                        if (invalidWordMatch && invalidWordMatch[1] !== 'true' && invalidWordMatch[1] !== 'false') {
                            addDiagnostic(lineIndex, invalidWordMatch[1], `Invalid ${prop} value: ${invalidWordMatch[1]}. Must be a boolean (true or false).`);
                        }
                    }
                };

                const checkNumberProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringValMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringValMatch) {
                            addDiagnostic(lineIndex, stringValMatch[1], `Invalid ${prop} value: ${stringValMatch[1]}. Must be a number without quotes.`);
                        }
                        const nonNumberMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^\\s,"'{}\\[\\]]+)`));
                        if (nonNumberMatch && isNaN(Number(nonNumberMatch[1]))) {
                            addDiagnostic(lineIndex, nonNumberMatch[1], `Invalid ${prop} value: ${nonNumberMatch[1]}. Must be a number.`);
                        }
                    }
                };

                const checkArrayProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const nonArrayMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*([^\\s\\[]+)`));
                        if (nonArrayMatch) {
                            // If it starts with [ it is skipped by [^\s\[], which is correct array format
                            addDiagnostic(lineIndex, nonArrayMatch[1], `Invalid ${prop} value. Must be an array, e.g. ["example"].`);
                        }
                    }
                };

                const checkStringProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        // Match raw value assigned to property (ignoring anything wrapped in quotes/backticks which are safe)
                        const unquotedMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(?!['"\`])([^\\s,{}]+)`));
                        if (unquotedMatch) {
                            const val = unquotedMatch[1];
                            if (!isNaN(Number(val))) {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a number.`);
                            } else if (val === 'true' || val === 'false') {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a boolean.`);
                            }
                        }
                    }
                };

                const checkObjectOrRefProps = (props: string[], currentLine: string, lineIndex: number) => {
                    for (const prop of props) {
                        const stringMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(["'][^"']*["'])`));
                        if (stringMatch) {
                            addDiagnostic(lineIndex, stringMatch[1], `Invalid ${prop} value. Cannot be a string.`);
                        }
                        const arrayMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(\\[)`));
                        if (arrayMatch) {
                            addDiagnostic(lineIndex, arrayMatch[1], `Invalid ${prop} value. Cannot be an array.`);
                        }
                        const primitiveMatch = currentLine.match(new RegExp(`${prop}\\s*:\\s*(?!['"\`\\{\\[])([^\\s,{}]+)`));
                        if (primitiveMatch) {
                            const val = primitiveMatch[1];
                            if (!isNaN(Number(val))) {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a number.`);
                            } else if (val === 'true' || val === 'false') {
                                addDiagnostic(lineIndex, val, `Invalid ${prop} value: ${val}. Cannot be a boolean.`);
                            }
                        }
                    }
                };

                const checkSpecificStringProps = (props: { prop: string, validValues: string[] }[], currentLine: string, lineIndex: number) => {
                    for (const { prop, validValues } of props) {
                        const match = currentLine.match(new RegExp(`${prop}\\s*:\\s*["']([^"']+)["']`));
                        if (match) {
                            const value = match[1];
                            if (!validValues.includes(value)) {
                                addDiagnostic(lineIndex, value, `Invalid ${prop} value: "${value}". Must be one of: ${validValues.join(", ")}.`);
                            }
                        }
                    }
                };

                const checkAllowedProperties = (allowedProps: string[], currentLine: string, lineIndex: number, blockName: string) => {
                    const propMatch = currentLine.match(/^\s*([a-zA-Z0-9_]+)\s*:/);
                    if (propMatch) {
                        const propName = propMatch[1];
                        if (!allowedProps.includes(propName)) {
                            addDiagnostic(lineIndex, propName, `Invalid property "${propName}" for ${blockName} block. Allowed properties: ${allowedProps.join(", ")}.`);
                        }
                    }
                };

                if (inBigQueryBlock) {
                    const allowedBigQueryProps = [
                        'partitionBy', 'clusterBy', 'requirePartitionFilter',
                        'partitionExpirationDays', 'labels', 'updatePartitionFilter', 'iceberg'
                    ];
                    if (bigQueryBraceDepth === 1) {
                        checkAllowedProperties(allowedBigQueryProps, line, i, 'bigquery');
                    }

                    checkBooleanProps(['requirePartitionFilter'], line, i);
                    checkNumberProps(['partitionExpirationDays'], line, i);
                    checkArrayProps(['clusterBy'], line, i);
                    checkStringProps(['partitionBy'], line, i);
                    checkObjectOrRefProps(['labels'], line, i);
                    
                    // Specific checking for bigquery string options (if any needed in the future)
                } else if (inAssertionBlock) {
                    const allowedAssertionProps = [
                        'nonNull', 'rowConditions', 'uniqueKey', 'uniqueKeys'
                    ];
                    if (assertionBraceDepth === 1) {
                        checkAllowedProperties(allowedAssertionProps, line, i, 'assertions');
                    }

                    checkArrayProps(['nonNull', 'rowConditions', 'uniqueKey', 'uniqueKeys'], line, i);
                } else {
                    const allowedConfigProps = [
                        'type', 'database', 'schema', 'name', 'description', 'columns',
                        'tags', 'dependencies', 'hasOutput', 'assertions', 'bigquery',
                        'materialized', 'onSchemaChange', 'protected'
                    ];
                    if (configBraceDepth === 1) {
                        checkAllowedProperties(allowedConfigProps, line, i, 'config');
                    }

                    checkBooleanProps(['hasOutput', 'materialized', 'protected'], line, i);
                    checkArrayProps(['tags', 'dependencies'], line, i);
                    checkStringProps(['description', 'database', 'schema', 'name'], line, i);
                    checkObjectOrRefProps(['columns'], line, i);
                    
                    checkSpecificStringProps([
                        { prop: 'type', validValues: ["table", "view", "incremental", "inline", "declaration", "operations"] },
                        { prop: 'onSchemaChange', validValues: ["IGNORE", "FAIL", "EXTEND", "SYNCHRONIZE"] }
                    ], line, i);
                }

                // Brace counting
                let openBraces = 0;
                let closedBraces = 0;
                for (let j = 0; j < line.length; j++) {
                    if (line[j] === '{') { openBraces++; }
                    else if (line[j] === '}') { closedBraces++; }
                }
                
                if (inBigQueryBlock) {
                    bigQueryBraceDepth += openBraces - closedBraces;
                    if (bigQueryBraceDepth <= 0) {
                        inBigQueryBlock = false;
                    }
                } else if (inAssertionBlock) {
                    assertionBraceDepth += openBraces - closedBraces;
                    if (assertionBraceDepth <= 0) {
                        inAssertionBlock = false;
                    }
                } else {
                    configBraceDepth += openBraces - closedBraces;
                    if (configBraceDepth <= 0) {
                        inConfigBlock = false;
                        break;
                    }
                }
            }
        }

        // We use our existing global diagnostic collection but append these specific warnings
        // making sure not to overwrite existing ones from the compile step, or we can just 
        // merge them. To keep it simple, we'll create a dedicated collection for these config lintings
        configDiagnosticCollection.set(document.uri, diagnostics);
    };

    const configDiagnosticCollection = vscode.languages.createDiagnosticCollection('dataformConfigDiagnostics');
    context.subscriptions.push(configDiagnosticCollection);

    // Initial check
    if (vscode.window.activeTextEditor) {
        checkConfigBlockDiagnostics(vscode.window.activeTextEditor.document);
    }

    // Check on open and change
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => checkConfigBlockDiagnostics(e.document)),
        vscode.workspace.onDidOpenTextDocument(doc => checkConfigBlockDiagnostics(doc))
    );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.selectWorkspaceFolder', async () => { await selectWorkspaceFolder(); }));

    const assertionCodeLensProvider = new AssertionRunnerCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'sqlx' },
            assertionCodeLensProvider
        )
    );


    const tagsCodeLensProvider = new TagsRunnerCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'sqlx' },
            tagsCodeLensProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runAssertions', async () => {
            let curFileMeta = await getCurrentFileMetadata(false);
            if (!curFileMeta?.fileMetadata) {
                return;
            }
            let query = curFileMeta.fileMetadata.queryMeta.assertionQuery;
            await runQueryInPanel({ query: query, type: "assertion" }, queryResultsViewProvider);
        })
    );

    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        { language: 'sqlx' },
        new DataformRequireDefinitionProvider()
    ));
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        { language: 'sqlx' },
        new DataformJsDefinitionProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformHoverProvider()
    ));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(
        { language: 'sqlx', scheme: 'file' },
        new SqlxDocumentSymbolProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformBigQueryHoverProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformConfigProvider()
    ));

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file', language: 'sqlx' },
            new DataformCTEDefinitionProvider()
        )
    );


    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.fixError',
            async (document: vscode.TextDocument, range: vscode.Range, diagnosticMessage: string) => {
                applyCodeActionUsingDiagnosticMessage(range, diagnosticMessage);
                document.save();
            })
    );

    context.subscriptions.push(dataformCodeActionProviderDisposable());

    context.subscriptions.push(sourcesAutoCompletionDisposable());
    context.subscriptions.push(schemaAutoCompletionDisposable());
    context.subscriptions.push(configBlockAutoCompletionDisposable());

    context.subscriptions.push(dependenciesAutoCompletionDisposable());

    context.subscriptions.push(tagsAutoCompletionDisposable());


    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.clearExtensionCache', () => {
        const cachedKeys = context.globalState.keys().filter(key => key.startsWith('vscode_dataform_tools_'));
        cachedKeys.forEach(key => {
            context.globalState.update(key, undefined);
            logger.info(`Cleared cached data for key: ${key}`);
        });
        vscode.window.showInformationMessage('Dataform Tools extension cache cleared.');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(context, false, false, false, "cli"); }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(context, true, false, false, "cli"); }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(context, false, true, false, "cli"); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtApi', () => {
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDependenciesApi', () => {
        let transitiveDependenciesIncluded = true;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDependentsApi', () => {
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = true;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtApi', () => {
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDependenciesApi', () => {
        let transitiveDependenciesIncluded = true;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDependentsApi', () => {
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = true;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(context, transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptions', () => { runFilesTagsWtOptions(context, "cli"); })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptionsApi', () => { runFilesTagsWtOptions(context, "api"); })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace', () => { runFilesTagsWtOptions(context, "api_workspace"); })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.createNewDataformProject', createNewDataformProject)
    );

    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider('sqlx', {
            async provideDocumentFormattingEdits(document): Promise<vscode.TextEdit[]> {
                const formattingOutput = await formatDataformSqlxFile(document);
                if (formattingOutput && formattingOutput.length > 0) {
                    return formattingOutput;
                }
                return []; // Return empty array if no formatting was done
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async (_editor) => {
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, undefined);
        }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTag', async () => {
        let includeDependencies = false;
        let includeDependents = false;
        let fullRefresh = false;
        runTag(context, includeDependencies, includeDependents, fullRefresh, "cli");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDeps', async () => {
        let includeDependencies = true;
        let includeDependents = false;
        let fullRefresh = false;
        runTag(context, includeDependencies, includeDependents, fullRefresh, "cli");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDownstreamDeps', async () => {
        let includeDependencies = false;
        let includeDependents = true;
        let fullRefresh = false;
        runTag(context, includeDependencies, includeDependents, fullRefresh, "cli");
    }));

    const errorLensExtensionInstalled = vscode.extensions.getExtension("usernamehw.errorlens");
    //NOTE: in wsl the extension is not visible in wsl remote by the api as it can be installed in client side (windows) if vscode thinks its is a UI based extension instead of workspace based
    if (!errorLensExtensionInstalled && !isWsl) {
        const message = "The Dataform tools extension recommends installing the Error Lens extension to show error messages inline.";
        const installButton = "Install Error Lens";
        vscode.window.showInformationMessage(message, installButton).then(selection => {
            if (selection === installButton) {
                vscode.env.openExternal(vscode.Uri.parse("vscode:extension/usernamehw.errorlens"));
            }
        });
    }

    // Add logging to key operations
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('vscode-dataform-tools.enableLogging')) {
                logger.initialize();
                logger.info('Logging configuration updated');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.formatDocument', () => {
            vscode.commands.executeCommand('editor.action.formatDocument');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.lintCurrentFile', async () => {
            if (diagnosticCollection) {
                await lintCurrentFile(diagnosticCollection);
            }
        })
    );

    context.subscriptions.push(renameProvider);


    //TODO: check if user has multiple workspace folders open
    //If so, prompt user to select a workspace folder ? We seem to select the first workspace folder by default
    workspaceFolder = await getWorkspaceFolder();
    if (workspaceFolder) {
        createBigQueryClient();
        setAuthenticationCheckInterval(); // This will check the setting and set up interval if needed
    }

    logger.info('Dataform Tools extension activated successfully');
}

// This method is called when your extension is deactivated
export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    clearAuthenticationCheckInterval();
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
