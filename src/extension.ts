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
import { executablesToCheck } from './constants';
import { getWorkspaceFolder, getCurrentFileMetadata, sendNotifactionToUserOnExtensionUpdate, selectWorkspaceFolder, getGcpProjectLocationDataform, runCompilation} from './utils';
import { executableIsAvailable } from './utils';
import { sourcesAutoCompletionDisposable, dependenciesAutoCompletionDisposable, tagsAutoCompletionDisposable, schemaAutoCompletionDisposable } from './completions';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { createNewDataformProject } from './createNewDataformProject';
import { AssertionRunnerCodeLensProvider, TagsRunnerCodeLensProvider } from './codeLensProvider';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import { renameProvider } from './renameProvider';
import { formatDataformSqlxFile } from './formatCurrentFile';
import { previewQueryResults, runQueryInPanel } from './previewQueryResults';
import { runTag } from './runTag';
import { runCurrentFile } from './runCurrentFile';
import { CompiledQueryPanel, registerCompiledQueryPanel } from './views/register-preview-compiled-panel';
import { logger } from './logger';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';
// import { DataformClient  } from '@google-cloud/dataform';
// import { runWorkflowInvocationWorkspace, createDataformWorkspace} from "./dataformApi";
import {runWorkflowInvocationWorkspace} from "./dataformApiUtils";
// import {getGitBranchAndRepoName} from "./getGitMeta";
import { DataformApi } from './dataformApi';

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
    globalThis.bigQueryJob = undefined;
    globalThis._bigQueryJobId = undefined;
    globalThis.cancelBigQueryJobSignal = false;
    globalThis.queryLimit = 1000;
    globalThis.diagnosticCollection = undefined;
    globalThis.cdnLinks = {
        highlightJsCssUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css",
        highlightJsUri: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
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
    globalThis.columnHoverDescription = {fields: []};
    globalThis.activeEditorFileName = undefined;
    globalThis.activeDocumentObj = undefined;
    globalThis.workspaceFolder = undefined;
    globalThis.errorInPreOpsDenyList = false;

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

    //TODO: check if user has multiple workspace folders open
    //If so, prompt user to select a workspace folder ? We seem to select the first workspace folder by default
    workspaceFolder = await getWorkspaceFolder();

    if (workspaceFolder) {
        await createBigQueryClient();
        setAuthenticationCheckInterval(); // This will check the setting and set up interval if needed
    }

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

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFile', () => { runCurrentFile(false, false, false, "cli"); }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDeps', () => { runCurrentFile(true, false, false, "cli"); }));
    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDownstreamDeps', () => { runCurrentFile(false, true, false, "cli"); }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runInRemoteWorkspace', async() => { 
        if (!CACHED_COMPILED_DATAFORM_JSON) {

            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                return;
            }

            let {dataformCompiledJson} = await runCompilation(workspaceFolder); // Takes ~1100ms
            if (dataformCompiledJson) {
                CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            }
        }

        if(!CACHED_COMPILED_DATAFORM_JSON){
            vscode.window.showErrorMessage(`Unable to compile dataform project. Run "dataform compile" in the terminal to check`);
            return;
        }

        const gcpProjectId = CACHED_COMPILED_DATAFORM_JSON.projectConfig.defaultDatabase;
        if(!gcpProjectId){
            vscode.window.showErrorMessage(`Unable to determine GCP project Id in Dataform config`);
            return;
        }

        let gcpProjectLocation = await getGcpProjectLocationDataform(gcpProjectId, CACHED_COMPILED_DATAFORM_JSON);

        let remoteGitRepoExsists = false;

        //FIXME: also will be dynamic e.g runTagsApi, runCurrentFileApi
        const invocationConfig = {
            includedTags: ["nested"],
            transitiveDependenciesIncluded: false,
            transitiveDependentsIncluded: false,
            fullyRefreshIncrementalTablesEnabled: false,
        };

        const dataformClient = new DataformApi(gcpProjectId, gcpProjectLocation);
        //TODO: depending on how it goes in the future we can deterive the location from here
        // const repository = await dataformClient.getRepository();
        // console.log(repository);

        try{
            // create Dataform workspace with current git repository name and branch if it does not exists in remote GCP
            await dataformClient.createWorkspace();
        } catch (error:any){
            const DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE = 6;
            if (error.code === DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE) {
                vscode.window.showWarningMessage(error.message);
            } 
        }

        try{
            await dataformClient.pullGitCommits();
            remoteGitRepoExsists = true;
        } catch(error:any){
            const BRANCH_DOES_NOT_EXSIST_IN_GIT_REMOTE_ERROR_CODE = 9;
            if(error.code === BRANCH_DOES_NOT_EXSIST_IN_GIT_REMOTE_ERROR_CODE){
                vscode.window.showWarningMessage(error.message);
            }
        }

        await runWorkflowInvocationWorkspace(dataformClient, invocationConfig, remoteGitRepoExsists);
    }) );


    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtApi', () => { 
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDependenciesApi', () => { 
        let transitiveDependenciesIncluded = true;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runCurrentFileWtDependentsApi', () => { 
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = true;
        let fullyRefreshIncrementalTablesEnabled = false;
        runCurrentFile(transitiveDependenciesIncluded, transitiveDependentsIncluded ,fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtApi', () => { 
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDependenciesApi', () => { 
        let transitiveDependenciesIncluded = true;
        let transitiveDependentsIncluded = false;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDependentsApi', () => { 
        let transitiveDependenciesIncluded = false;
        let transitiveDependentsIncluded = true;
        let fullyRefreshIncrementalTablesEnabled = false;
        runTag(transitiveDependenciesIncluded, transitiveDependentsIncluded, fullyRefreshIncrementalTablesEnabled, "api");
    }) );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptions', () => {runFilesTagsWtOptions("cli");})
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.runFilesTagsWtOptionsApi', () => {runFilesTagsWtOptions("api");})
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
        runTag(includeDependencies, includeDependents, fullRefresh, "cli");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDeps', async () => {
        let includeDependencies = true;
        let includeDependents = false;
        let fullRefresh = false;
        runTag(includeDependencies, includeDependents, fullRefresh, "cli");
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-dataform-tools.runTagWtDownstreamDeps', async () => {
        let includeDependencies = false;
        let includeDependents = true;
        let fullRefresh = false;
        runTag(includeDependencies, includeDependents, fullRefresh, "cli");
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

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.formatDocument', () => {
            vscode.commands.executeCommand('editor.action.formatDocument');
        })
    );

    context.subscriptions.push(renameProvider);

    logger.info('Dataform Tools extension activated successfully');
}

// This method is called when your extension is deactivated
export function deactivate() {
    logger.info('Deactivating Dataform Tools extension');
    clearAuthenticationCheckInterval();
    logger.info('Extension "vscode-dataform-tools" is now deactivated.');
}
