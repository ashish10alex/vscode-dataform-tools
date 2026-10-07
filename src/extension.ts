import * as vscode from 'vscode';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { QueryWtType, Target, WorkflowUrlEntry } from './types';
import { CustomViewProvider } from './views/register-query-results-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRequireDefinitionProvider, DataformJsDefinitionProvider, DataformCTEDefinitionProvider } from './definitionProvider';
import { DataformColumnHoverProvider, DataformHoverProvider, DataformBigQueryHoverProvider } from './hoverProvider';
import { registerConfigBlockFeatures } from './configBlock/providers';
import { defaultCdnLinks } from './constants';
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
import { initRemoteCompiler } from './utils/remoteCompiler';
import { clearRemoteCompileCache } from './utils/remoteCompileCache';
import { getQueryStringForPreview, previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runTests } from './runTests';
import { searchTableColumns } from './searchTableColumns';
import { runCurrentFile } from './runCurrentFile';
import { initLastRun } from './lastRun';
import { initChangedActions } from './changedActions';
import { rerunLastExecution } from './rerunLastExecution';
import { CompiledQueryPanel, onDidPostPanelMessage, refreshCompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';
import type { DbtPanelMessage } from './shared/panelContract';
import { initDeferToProd } from './defer/deferStatusBar';
import { initProdTargets } from './defer/prodTargets';
import { registerDeferEditorHints } from './defer/deferEditorHints';
import { registerExecutedSqlProvider } from './workflowJobTelemetry';
import { logger } from './logger';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';
import { createDependencyInspectorPanel } from './views/dependency-inspector-panel';
import { ColumnLineagePanel } from './views/columnLineagePanel';
import { GraphSampleSource, focusFromEditor, wordAtCursor } from './columnLineage/graphSampleSource';
import { SqlxDocumentSymbolProvider } from './documentSymbols';
import { debounce } from './debounce';
import { getPerfSnapshot, perfStart, resetPerf } from './perf';
import { backendContext, currentDataformRoot, initProjects, projects, requiredTools } from './project';
import { dbtTool, initDbtTools } from './project/dbtTool';
import { clearDbtArtifacts, initDbtCompile } from './project/dbtCompile';
import { isRemoteMode, resolveDataformOptions } from './project/dataformOptions';

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
    globalThis.DEBOUNCE_WAIT = 750;

    const snippetsPath = path.join(context.extensionPath, "snippets", "bigquery.code-snippets.json");
    const snippetsContent = fs.readFileSync(snippetsPath, 'utf8');
    globalThis.bigQuerySnippetMetadata = JSON.parse(snippetsContent)[".source.sql-bigquery"];

    initRemoteCompiler(context);
    initLastRun(context);
    initChangedActions(context);
    initProjects(context);
    initDbtTools(context);
    initDbtCompile(context);
    initProdTargets(context);
    initCliCompileCache(context);

    // Searching PATH runs `which`/`where`: do it in the background, then warn about anything missing.
    // Only for a Dataform Project, and only its own tool: a window without one is left alone.
    const activationWorkspaceFolder = currentDataformRoot() ?? projects.projects.find((project) => project.backend === 'dataform')?.root;
    if (activationWorkspaceFolder) {
        const executablesNeeded = requiredTools('dataform', { compilationMode: isRemoteMode() ? 'api' : 'cli' });
        Promise.all(executablesNeeded.map((executable) => prefetchExecutablePath(executable, activationWorkspaceFolder))).then(() => {
            for (const executable of executablesNeeded) {
                executableIsAvailable(executable, true, activationWorkspaceFolder); // Show error if not found
            }
        }).catch((error) => logger.error(`Failed to look up executables: ${error}`));
    }
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
        prewarmCliCompilation(dataformFolders[0], resolveDataformOptions(dataformFolders[0])).catch((error) => logger.error(`Failed to prepare the saved compilation: ${error}`));
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
        vscode.commands.registerCommand('vscode-dataform-tools.runGeneratedQuery', async (query: string, type: string, place?: QueryWtType['place']) => {
            if (!query) {
                return;
            }
            await runQueryInPanel({ query: query, type: type || "table", ...(place ? { place } : {}) }, queryResultsViewProvider);
        })
    );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.dependencyGraphPanel', async () => {
        createDependencyGraphPanel(context, vscode.ViewColumn.One);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.dependencyInspector', () => {
        const activeFilePath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
        createDependencyInspectorPanel(context, activeFilePath ?? lastDataformFilePath);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.columnLineage', () => {
        // From the compiled query panel no text editor is active, so find the one showing its file
        const editor = vscode.window.activeTextEditor
            ?? vscode.window.visibleTextEditors.find((visible) => visible.document === activeDocumentObj);
        const document = editor?.document ?? activeDocumentObj;
        if (!document) {
            vscode.window.showInformationMessage('Open a .sqlx file to see the lineage of its columns.');
            return;
        }
        // Open as a tab beside the compiled query panel when it sits in another group, rather than splitting again
        const compiledColumn = CompiledQueryPanel.centerPanel?.webviewPanel?.viewColumn;
        const column = compiledColumn !== undefined && compiledColumn !== editor?.viewColumn ? compiledColumn : vscode.ViewColumn.Beside;
        ColumnLineagePanel.showColumns(context, document, editor && wordAtCursor(editor), column);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.columnImpactOfChanges', () => ColumnLineagePanel.showImpact(context)));

    // For trying the panel where Dataplex has no lineage; in the palette only when developing the extension
    void vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.devMode', context.extensionMode === vscode.ExtensionMode.Development);
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.traceColumnLineageGuessed', async () => {
        const picked = await focusFromEditor();
        if (picked) {
            const source = new GraphSampleSource(picked.schemas, picked.index);
            ColumnLineagePanel.showTrace(context, picked.focus, source, source.resolveFile);
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
        clearDbtArtifacts().catch((error) => logger.error(`Failed to clear the dbt artifacts: ${error}`));
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
    return {
        __perf: { getPerfSnapshot, resetPerf },
        __panel: {
            onDidPostMessage: onDidPostPanelMessage,
            forgetSentSlices: () => CompiledQueryPanel.centerPanel?.forgetSentSlices(),
            // As if a button of a dbt Project's panel had been clicked
            dbtMessage: (message: DbtPanelMessage) => CompiledQueryPanel.centerPanel?.onDbtMessage(message),
        },
        // What the tests of a dbt workspace read (src/dbtWorkspace)
        __projects: { list: () => projects.projects.map(({ root, backend }) => ({ root, backend })), backendContext: () => backendContext(), dbtTool },
    };
}

// This method is called when your extension is deactivated
export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
