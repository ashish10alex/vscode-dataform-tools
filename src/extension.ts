import * as vscode from 'vscode';
import os from 'os';
import { DataformCompiledJson } from './types';
import { registerWebViewProvider } from './views/register-sidebar-panel';
import { CustomViewProvider } from './views/register-query-results-panel';
import { registerCenterPanel } from './views/register-center-panel';
import { dataformCodeActionProviderDisposable, applyCodeActionUsingDiagnosticMessage } from './codeActionProvider';
import { DataformRefDefinitionProvider } from './definitionProvider';
import { DataformHoverProvider } from './hoverProvider';
import { executablesToCheck, compiledSqlFilePath } from './constants';
import { getWorkspaceFolder, compiledQueryWtDryRun, getDependenciesAutoCompletionItems, getDataformTags, getVSCodeDocument, getCurrentFileMetadata } from './utils';
import { executableIsAvailable, runCompilation } from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { AssertionRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { formatCurrentFile } from './formatCurrentFile';
import { previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runCurrentFile } from './runFiles';
import { CompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {

    globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined as DataformCompiledJson | undefined;
    globalThis.declarationsAndTargets = [] as string[];
    globalThis.dataformTags = [] as string[];
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.bigQueryJob = undefined;
    globalThis.cancelBigQueryJobSignal = false;
    globalThis.queryLimit = 1000;
    globalThis.diagnosticCollection = undefined;
    globalThis.cdnLinks = {
        highlightJsCssUri : "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css",
        highlightJsUri : "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
        highlightJsCopyExtUri : "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js",
        highlightJsCopyExtCssUri : "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css",
        highlightJsOneDarkThemeUri : "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css",
        highlightJsOneLightThemeUri : "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css",
        highlightJsLineNoExtUri : "https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js",
        tabulatorCssUri : "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator.min.css",
        tabulatorUri : "https://unpkg.com/tabulator-tables@6.2.5/dist/js/tabulator.min.js",
    };
    globalThis.compiledQuerySchema = undefined;
    globalThis.incrementalCheckBox = false;


    for (let i = 0; i < executablesToCheck.length; i++) {
        let executable = executablesToCheck[i];
        executableIsAvailable(executable);
    }

    //TODO: check if user has multiple workspace folders open
    //If so, prompt user to select a workspace folder ? We seem to select the first workspace folder by default
    let workspaceFolder = getWorkspaceFolder();

    if (workspaceFolder) {
        let dataformCompiledJson = await runCompilation(workspaceFolder);
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            declarationsAndTargets = await getDependenciesAutoCompletionItems(dataformCompiledJson);
            dataformTags = await getDataformTags(dataformCompiledJson);
        }
    }

    diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerWebViewProvider(context);
    registerCenterPanel(context);
    registerCompiledQueryPanel(context);

    async function compileAndDryRunWtOpts(document: vscode.TextDocument | undefined, diagnosticCollection: vscode.DiagnosticCollection, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean) {
        if (!document) {
            document = getVSCodeDocument();
        }

        if (!document) {
            return;
        }

        await compiledQueryWtDryRun(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
    }

    const queryResultsViewProvider = new CustomViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('queryResultsView', queryResultsViewProvider));


    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runQuery', async () => {
            await previewQueryResults(queryResultsViewProvider);
        })
    );

    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
        if (editor && queryResultsViewProvider._view?.visible) {
            let curFileMeta = await getCurrentFileMetadata(false);
            let type = curFileMeta?.fileMetadata?.queryMeta.type;
            queryResultsViewProvider._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox });

        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.cancelQuery', async () => { await cancelBigQueryJob(); }));

    const codeLensProvider = new AssertionRunnerCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'sqlx' },
            codeLensProvider
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runAssertions', async (uri: vscode.Uri, line: number) => {
            let curFileMeta = await getCurrentFileMetadata(false);
            if (!curFileMeta?.fileMetadata) {
                return;
            }
            let query = curFileMeta.fileMetadata.queryMeta.assertionQuery;
            await runQueryInPanel({query: query, type: "assertion"}, queryResultsViewProvider);
        })
    );

    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        { language: 'sqlx' },
        new DataformRefDefinitionProvider()
    ));

    context.subscriptions.push(vscode.languages.registerHoverProvider(
        { language: 'sqlx' },
        new DataformHoverProvider()
    ));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.fixError',
            async (document: vscode.TextDocument, range: vscode.Range, diagnosticMessage: string) => {
                applyCodeActionUsingDiagnosticMessage(range, diagnosticMessage);
                document.save();
            })
    );

    context.subscriptions.push(dataformCodeActionProviderDisposable());

    context.subscriptions.push(sourcesAutoCompletionDisposable());

    context.subscriptions.push(dependenciesAutoCompletionDisposable());

    context.subscriptions.push(tagsAutoCompletionDisposable());

    context.subscriptions.push(editorSyncDisposable);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(false, false, false); }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptions', runFilesTagsWtOptions)
    );

    /**
     * NOTE: Takes ~2 seconds as we compile the project (~200 nodes ) and dry run the file to safely format the .sqlx file to avoid loosing user code due to incorrect parsing due to unexptected block terminations, etc.
     */
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.formatCurrentfile', async () => {
        await formatCurrentFile(diagnosticCollection);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(true, false, false); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(false, true, false); }));


    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        let useWebViewToShowCompiledQuery = vscode.workspace.getConfiguration('vscode-dataform-tools').get('useWebViewToShowCompiledQuery');
        if(useWebViewToShowCompiledQuery){
            return;
        }
        if(diagnosticCollection){
            await compileAndDryRunWtOpts(document, diagnosticCollection, compiledSqlFilePath, false);
        }
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async () => {
        let useWebViewToShowCompiledQuery = vscode.workspace.getConfiguration('vscode-dataform-tools').get('useWebViewToShowCompiledQuery');
        if(useWebViewToShowCompiledQuery){
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, true);
        } else{
            let showCompiledQueryInVerticalSplitOnSave = true;
            let document = undefined;
            if(diagnosticCollection){
                await compileAndDryRunWtOpts(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
            }
        }
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

}

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('Extension "vscode-dataform-tools" is now deactivated.');
}
