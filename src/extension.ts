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
import { executableIsAvailable, runCurrentFile, runCompilation } from './utils';
import { editorSyncDisposable } from './sync';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { AssertionRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { formatCurrentFile } from './formatCurrentFile';
import { previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';

// This method is called when your extension is activated
export async function activate(context: vscode.ExtensionContext) {

    globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined as DataformCompiledJson | undefined;
    globalThis.declarationsAndTargets = [] as string[];
    globalThis.dataformTags = [] as string[];
    globalThis.isRunningOnWindows = os.platform() === 'win32' ? true : false;
    globalThis.bigQueryJob = undefined;
    globalThis.cancelBigQueryJobSignal = false;
    globalThis.queryLimit = 1000;


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

    let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
    context.subscriptions.push(diagnosticCollection);

    registerWebViewProvider(context);
    registerCenterPanel(context);

    async function compileAndDryRunWtOpts(document: vscode.TextDocument | undefined, diagnosticCollection: vscode.DiagnosticCollection, compiledSqlFilePath: string, showCompiledQueryInVerticalSplitOnSave: boolean | undefined) {
        if (!document) {
            document = getVSCodeDocument();
        }

        if (!document) {
            return;
        }

        let completionItems = await compiledQueryWtDryRun(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
        if (completionItems !== undefined) {
            dataformTags = completionItems[0];
            declarationsAndTargets = completionItems[1];
        }
    }

    const queryResultsViewProvider = new CustomViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('queryResultsView', queryResultsViewProvider));


    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runQuery', async () => {
            await previewQueryResults(queryResultsViewProvider);
        })
    );

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
            let fileMetadata = await getCurrentFileMetadata(false);
            if (!fileMetadata) {
                return;
            }
            let query = fileMetadata.queryMeta.assertionQuery;
            await runQueryInPanel(query, queryResultsViewProvider);
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

                // recompile the file after the suggestion is applied based on user configuration
                let recompileAfterCodeAction = vscode.workspace.getConfiguration('vscode-dataform-tools').get('recompileAfterCodeAction');
                if (recompileAfterCodeAction) {
                    let showCompiledQueryInVerticalSplitOnSave = undefined;
                    await compileAndDryRunWtOpts(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
                }

            })
    );

    context.subscriptions.push(dataformCodeActionProviderDisposable());

    context.subscriptions.push(sourcesAutoCompletionDisposable());

    context.subscriptions.push(dependenciesAutoCompletionDisposable());

    context.subscriptions.push(tagsAutoCompletionDisposable());

    context.subscriptions.push(editorSyncDisposable);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(false, false, false); }));

    //TODO: Do we need to create a disposable variable ?
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptions', runFilesTagsWtOptions)
    );

    /**
     * Takes ~2 seconds as we compile the project and dry run the file to safely format the .sqlx file to avoid loosing user code due to incorrect parsing due to unexptected block terminations, etc.
     */
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.formatCurrentfile', async () => {
        await formatCurrentFile(diagnosticCollection);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(true, false, false); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(false, true, false); }));


    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        let showCompiledQueryInVerticalSplitOnSave = undefined;
        await compileAndDryRunWtOpts(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryWtDryRun', async () => {
            let showCompiledQueryInVerticalSplitOnSave = true;
            let document = undefined;
            await compileAndDryRunWtOpts(document, diagnosticCollection, compiledSqlFilePath, showCompiledQueryInVerticalSplitOnSave);
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
