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
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable, schemaAutoCompletionDisposable } from './completions';
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

    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor && queryResultsViewProvider._view?.visible) {
            let curFileMeta = await getCurrentFileMetadata(false);
            let type = curFileMeta?.fileMetadata?.queryMeta.type;
            queryResultsViewProvider._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox });
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.cancelQuery', async () => { await cancelBigQueryJob(); }));

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
