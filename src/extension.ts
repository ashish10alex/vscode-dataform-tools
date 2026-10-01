import * as vscode from 'vscode';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { DataformCompiledJson, Target, WorkflowUrlEntry } from './types';
import { CustomViewProvider } from './views/register-query-results-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRequireDefinitionProvider, DataformJsDefinitionProvider, DataformCTEDefinitionProvider } from './definitionProvider';
import { DataformColumnHoverProvider, DataformHoverProvider, DataformBigQueryHoverProvider } from './hoverProvider';
import { registerConfigBlockFeatures } from './configBlock/providers';
import { defaultCdnLinks, executablesToCheck } from './constants';
import { getWorkspaceFolder, getCurrentFileMetadata, sendNotificationToUserOnExtensionUpdate, selectWorkspaceFolder } from './utils';
import { executableIsAvailable, isDataformWorkspace, prewarmCliCompilation } from './utils';
import { initCliCompileCache } from './utils/cliCompileCache';
import { clearExecutablePathCache, prefetchExecutablePath } from './utils/executableResolver';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable, schemaAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { runChangedActionsCommand, RunChangedActionsArgs } from './runChangedActionsCommand';
import { createNewDataformProject } from './createNewDataformProject';
import { AssertionRunnerCodeLensProvider, TagsRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { renameProvider } from './renameProvider';
import { formatDataformSqlxFile, lintCurrentFile } from './formatCurrentFile';
import { initRemoteCompiler, isRemoteMode } from './utils/remoteCompiler';
import { clearRemoteCompileCache } from './utils/remoteCompileCache';
import { getQueryStringForPreview, previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runTests } from './runTests';
import { searchTableColumns } from './searchTableColumns';
import { runCurrentFile } from './runCurrentFile';
import { initLastRun } from './lastRun';
import { initChangedActions } from './changedActions';
import { rerunLastExecution } from './rerunLastExecution';
import { CompiledQueryPanel, refreshCompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';
import { initDeferToProd } from './defer/deferStatusBar';
import { initProdTargets } from './defer/prodTargets';
import { registerDeferEditorHints } from './defer/deferEditorHints';
import { registerExecutedSqlProvider } from './workflowJobTelemetry';
import { logger } from './logger';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';
import { createDependencyInspectorPanel } from './views/dependency-inspector-panel';
import { ColumnLineagePanel } from './views/columnLineagePanel';
import { GraphSampleSource, focusFromEditor } from './columnLineage/graphSampleSource';
import { DataplexTraceSource } from './columnLineage/dataplexSource';
import { SqlxDocumentSymbolProvider } from './documentSymbols';
import { debounce } from './debounce';
import { getPerfSnapshot, perfStart, resetPerf } from './perf';

let lastDataformFilePath: string | undefined;


// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {
    const endActivateSpan = perfStart('activate');
    // Initialize logger at the start
    logger.initialize();
    logger.info('Activating Dataform Tools extension');

    sendNotificationToUserOnExtensionUpdate(context);

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
    globalThis.DEBOUNCE_WAIT = 750;

    const snippetsPath = path.join(context.extensionPath, "snippets", "bigquery.code-snippets.json");
    const snippetsContent = fs.readFileSync(snippetsPath, 'utf8');
    globalThis.bigQuerySnippetMetadata = JSON.parse(snippetsContent)[".source.sql-bigquery"];

    initRemoteCompiler(context);
    initLastRun(context);
    initChangedActions(context);
    initProdTargets(context);
    initCliCompileCache(context);

    // Searching PATH runs `which`/`where`: do it in the background, then warn about anything missing
    const activationWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const executablesNeeded = executablesToCheck.filter((executable) => !(executable === 'dataform' && isRemoteMode())); // Remote mode compiles with the Dataform API
    Promise.all(executablesNeeded.map(prefetchExecutablePath)).then(() => {
        for (const executable of executablesNeeded) {
            executableIsAvailable(executable, true, activationWorkspaceFolder); // Show error if not found
        }
    }).catch((error) => logger.error(`Failed to look up executables: ${error}`));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (['dataformCliScope', 'dataformExecutablePath', 'gcloudExecutablePath', 'sqlfluffExecutablePath'].some((key) => event.affectsConfiguration(`vscode-dataform-tools.${key}`))) {
            clearExecutablePathCache();
        }
    }));

    diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerCompiledQueryPanel(context);
    initDeferToProd(context, refreshCompiledQueryPanel);

    // Only when the project is unambiguous: the compiled JSON is shared by the whole window
    const dataformFolders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath).filter(isDataformWorkspace);
    if (dataformFolders.length === 1) {
        prewarmCliCompilation(dataformFolders[0]).catch((error) => logger.error(`Failed to prepare the saved compilation: ${error}`));
    }
    registerDeferEditorHints(context);
    registerExecutedSqlProvider(context);

    const queryResultsViewProvider = new CustomViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('queryResultsView', queryResultsViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
    }));


    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runQuery', async () => {
            logger.info('Running query command');
            await previewQueryResults(queryResultsViewProvider);
        })
    );

    // Runs a query the extension generated rather than one taken from the active file,
    // e.g. the starter GQL query built from a property graph.
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runGeneratedQuery', async (query: string, type: string) => {
            if (!query) {
                return;
            }
            await runQueryInPanel({ query: query, type: type || "table" }, queryResultsViewProvider);
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.dependencyGraphPanel', async () => {
        createDependencyGraphPanel(context, vscode.ViewColumn.One);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.dependencyInspector', () => {
        const activeFilePath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
        createDependencyInspectorPanel(context, activeFilePath ?? lastDataformFilePath);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.traceColumnLineage', async () => {
        const picked = await focusFromEditor(true);
        if (picked) {
            const source = new DataplexTraceSource(picked.schemas, picked.index);
            ColumnLineagePanel.show(context, picked.focus, source, source.resolveFile);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.traceColumnLineageGuessed', async () => {
        const picked = await focusFromEditor(false);
        if (picked) {
            const source = new GraphSampleSource(picked.schemas, picked.index);
            ColumnLineagePanel.show(context, picked.focus, source, source.resolveFile);
        }
    }));

    const debouncedActiveEditorChange = debounce(async (editor: vscode.TextEditor | undefined) => {
        const ext = editor?.document?.uri?.fsPath?.split('.').pop();
        if (ext === 'sqlx' || ext === 'js') {
            lastDataformFilePath = editor!.document.uri.fsPath;
        }
        if (editor && queryResultsViewProvider._view?.visible) {
            let curFileMeta = await getCurrentFileMetadata(false);
            if (curFileMeta?.fileMetadata) {
                let type = curFileMeta.fileMetadata.queryMeta.type;
                let query = getQueryStringForPreview(curFileMeta.fileMetadata, incrementalCheckBox);
                queryResultsViewProvider._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox, "query": query });
            }
        }
    }, globalThis.DEBOUNCE_WAIT);

    vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTests', async (workspaceFolder: string) => {
        await runTests(workspaceFolder);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.cancelQuery', async () => { await cancelBigQueryJob(); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.selectWorkspaceFolder', async () => { await selectWorkspaceFolder(); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.searchTableColumns', async (target?: Target) => { await searchTableColumns(target); }));

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
        { language: 'sqlx' },
        new SqlxDocumentSymbolProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformBigQueryHoverProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformColumnHoverProvider()
    ));

    registerConfigBlockFeatures(context);

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'sqlx' },
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
        clearRemoteCompileCache();
        vscode.window.showInformationMessage('Dataform Tools extension cache cleared.');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.rerunLastExecution', () => rerunLastExecution(context)));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.openLastWorkflowExecution', async () => {
        const workflowUrls = context.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
        const lastEntry = workflowUrls[workflowUrls.length - 1];
        if (!lastEntry?.url) {
            vscode.window.showInformationMessage('No workflow execution found. Run a file or tag using the API first.');
            return;
        }
        await vscode.env.openExternal(vscode.Uri.parse(lastEntry.url));
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
        vscode.commands.registerCommand('vscode-dataform-tools.runChangedActions', (args?: RunChangedActionsArgs) => runChangedActionsCommand(context, "cli", args)),
        vscode.commands.registerCommand('vscode-dataform-tools.runChangedActionsApi', (args?: RunChangedActionsArgs) => runChangedActionsCommand(context, "api", args)),
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
    // Recommended once, not on every activation
    const errorLensRecommendedKey = 'vscode-dataform-tools.errorLensRecommended';
    if (!errorLensExtensionInstalled && !isWsl && !context.globalState.get<boolean>(errorLensRecommendedKey)) {
        context.globalState.update(errorLensRecommendedKey, true);
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


    // Not awaited: with several workspace folders this can wait on a folder picker, which must not hold up
    // activation. The BigQuery client is created when a feature first needs it.
    getWorkspaceFolder().then((folder) => {
        workspaceFolder ??= folder;
    }).catch((error) => logger.error(`Failed to resolve the workspace folder: ${error}`));

    logger.info('Dataform Tools extension activated successfully');
    endActivateSpan();

    // Internal: read by `just bench` (src/bench), not a public API
    return { __perf: { getPerfSnapshot, resetPerf } };
}

// This method is called when your extension is deactivated
export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
