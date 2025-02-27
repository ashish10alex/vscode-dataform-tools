import * as vscode from 'vscode';
import os from 'os';
import { DataformCompiledJson } from './types';
import { createBigQueryClient, setAuthenticationCheckInterval, clearAuthenticationCheckInterval } from './bigqueryClient';
import { registerWebViewProvider } from './views/register-sidebar-panel';
import { CustomViewProvider } from './views/register-query-results-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRequireDefinitionProvider, DataformJsDefinitionProvider, DataformCTEDefinitionProvider } from './definitionProvider';
import { DataformConfigProvider, DataformHoverProvider } from './hoverProvider';
import { executablesToCheck } from './constants';
import { getWorkspaceFolder, getCurrentFileMetadata, sendNotifactionToUserOnExtensionUpdate} from './utils';
import { executableIsAvailable } from './utils';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable, schemaAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { AssertionRunnerCodeLensProvider, TagsRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { formatCurrentFile, formatCurrentFileWithDataform } from './formatCurrentFile';
import { previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runCurrentFile } from './runFiles';
import { CompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';
import { logger } from './logger';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';

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
    logger.debug('Initialized global cache');
    globalThis.declarationsAndTargets = [] as string[];
    globalThis.dataformTags = [] as string[];
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.bigQueryJob = undefined;
    globalThis.cancelBigQueryJobSignal = false;
    globalThis.queryLimit = 1000;
    globalThis.diagnosticCollection = undefined;
    globalThis.cdnLinks = {
        highlightJsCssUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css",
        highlightJsUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
        highlightJsCopyExtUri: "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js",
        highlightJsCopyExtCssUri: "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css",
        highlightJsOneDarkThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css",
        highlightJsOneLightThemeUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css",
        highlightJsLineNoExtUri: "https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js",
        tabulatorDarkCssUri: "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator_midnight.min.css",
        tabulatorLightCssUri: "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator_simple.min.css",
        tabulatorUri: "https://unpkg.com/tabulator-tables@6.3.0/dist/js/tabulator.min.js",
    };
    globalThis.compiledQuerySchema = undefined;
    globalThis.incrementalCheckBox = false;
    globalThis.schemaAutoCompletions = [];
    globalThis.activeEditorFileName = undefined;
    globalThis.activeDocumentObj = undefined;

    for (let i = 0; i < executablesToCheck.length; i++) {
        let executable = executablesToCheck[i];
        executableIsAvailable(executable);
    }

    // Clean up on deactivation
    context.subscriptions.push({
        dispose: () => clearAuthenticationCheckInterval()
    });

    //TODO: check if user has multiple workspace folders open
    //If so, prompt user to select a workspace folder ? We seem to select the first workspace folder by default
    let workspaceFolder = getWorkspaceFolder();

    if (workspaceFolder) {
        await createBigQueryClient();
        setAuthenticationCheckInterval(); // This will check the setting and set up interval if needed
    }

    diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerWebViewProvider(context);
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

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(false, false, false); }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptions', runFilesTagsWtOptions)
    );

    /**
     * NOTE: Takes ~2 seconds as we compile the project (~200 nodes ) and dry run the file to safely format the .sqlx file to avoid loosing user code due to incorrect parsing due to unexptected block terminations, etc.
     */
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.formatCurrentfile', async () => {
        let formattingCli = vscode.workspace.getConfiguration("vscode-dataform-tools").get("formattingCli");
        if (formattingCli === "sqlfluff") {
            await formatCurrentFile(diagnosticCollection);
        } else if (formattingCli === "dataform") {
            await formatCurrentFileWithDataform();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(true, false, false); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(false, true, false); }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async (_editor) => {
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, undefined);
        }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTag', async () => {
        let includeDependencies = false;
        let includeDependents = false;
        runTag(includeDependencies, includeDependents);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDeps', async () => {
        let includeDependencies = true;
        let includeDependents = false;
        runTag(includeDependencies, includeDependents);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDownstreamDeps', async () => {
        let includeDependencies = false;
        let includeDependents = true;
        runTag(includeDependencies, includeDependents);
    }));

    if (vscode.workspace.getConfiguration("vscode-dataform-tools").get("recommendErrorLensExtension")) {
    const errorLensExtension = vscode.extensions.getExtension("usernamehw.errorlens");
    if (!errorLensExtension) {
        await vscode.window
        .showInformationMessage(
            "The Dataform tools extension recommends installing the Error Lens extension to show error messages inline instead of just showing swigly lines under the error",
            "Install",
            "Don't show again"
        )
        .then(selection => {
            if (selection === "Install") {
            vscode.env.openExternal(vscode.Uri.parse("vscode:extension/usernamehw.errorlens"));
            } else if (selection === "Don't show again") {
            vscode.workspace
                .getConfiguration("vscode-dataform-tools")
                .update("recommendYamlExtension", false, vscode.ConfigurationTarget.Global);
            }
        });
    }
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

    logger.info('Dataform Tools extension activated successfully');
}

// This method is called when your extension is deactivated
export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    clearAuthenticationCheckInterval();
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
