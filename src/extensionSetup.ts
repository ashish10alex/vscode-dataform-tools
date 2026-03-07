import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import {
    clearAuthenticationCheckInterval,
    createBigQueryClient,
    setAuthenticationCheckInterval,
} from './bigqueryClient';
import { cancelBigQueryJob } from './bigqueryRunQuery';
import {
    applyCodeActionUsingDiagnosticMessage,
    dataformCodeActionProviderDisposable,
} from './codeActionProvider';
import {
    AssertionRunnerCodeLensProvider,
    TagsRunnerCodeLensProvider,
} from './codeLensProvider';
import {
    dependenciesAutoCompletionDisposable,
    schemaAutoCompletionDisposable,
    sourcesAutoCompletionDisposable,
    tagsAutoCompletionDisposable,
} from './completions';
import { defaultCdnLinks, executablesToCheck } from './constants';
import { createNewDataformProject } from './createNewDataformProject';
import {
    DataformCTEDefinitionProvider,
    DataformJsDefinitionProvider,
    DataformRequireDefinitionProvider,
} from './definitionProvider';
import { debounce } from './debounce';
import { SqlxDocumentSymbolProvider } from './documentSymbols';
import { formatDataformSqlxFile, lintCurrentFile } from './formatCurrentFile';
import {
    DataformBigQueryHoverProvider,
    DataformConfigProvider,
    DataformHoverProvider,
} from './hoverProvider';
import { logger } from './logger';
import {
    getQueryStringForPreview,
    previewQueryResults,
    runQueryInPanel,
} from './previewQueryResults';
import { renameProvider } from './renameProvider';
import { runCurrentFile } from './runCurrentFile';
import { runFilesTagsWtOptions } from './runFilesTagsWtOptions';
import { runTag } from './runTag';
import { DataformCompiledJson, ExecutionMode } from './types';
import {
    executableIsAvailable,
    getCurrentFileMetadata,
    getWorkspaceFolder,
    selectWorkspaceFolder,
    sendNotifactionToUserOnExtensionUpdate,
} from './utils';
import { createDependencyGraphPanel } from './views/depedancyGraphPanel';
import {
    CompiledQueryPanel,
    registerCompiledQueryPanel,
} from './views/register-preview-compiled-panel';
import { CustomViewProvider } from './views/register-query-results-panel';

type RunCommandConfig = {
    command: string;
    executionMode: ExecutionMode;
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
};

const RUN_CURRENT_FILE_COMMANDS: ReadonlyArray<RunCommandConfig> = [
    {
        command: 'vscode-dataform-tools.runCurrentFile',
        executionMode: 'cli',
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runCurrentFileWtDeps',
        executionMode: 'cli',
        includeDependencies: true,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runCurrentFileWtDownstreamDeps',
        executionMode: 'cli',
        includeDependencies: false,
        includeDependents: true,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runCurrentFileWtApi',
        executionMode: 'api',
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runCurrentFileWtDependenciesApi',
        executionMode: 'api',
        includeDependencies: true,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runCurrentFileWtDependentsApi',
        executionMode: 'api',
        includeDependencies: false,
        includeDependents: true,
        fullRefresh: false,
    },
];

const RUN_TAG_COMMANDS: ReadonlyArray<RunCommandConfig> = [
    {
        command: 'vscode-dataform-tools.runTag',
        executionMode: 'cli',
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runTagWtDeps',
        executionMode: 'cli',
        includeDependencies: true,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runTagWtDownstreamDeps',
        executionMode: 'cli',
        includeDependencies: false,
        includeDependents: true,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runTagWtApi',
        executionMode: 'api',
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runTagWtDependenciesApi',
        executionMode: 'api',
        includeDependencies: true,
        includeDependents: false,
        fullRefresh: false,
    },
    {
        command: 'vscode-dataform-tools.runTagWtDependentsApi',
        executionMode: 'api',
        includeDependencies: false,
        includeDependents: true,
        fullRefresh: false,
    },
];

const RUN_FILES_TAGS_COMMANDS: ReadonlyArray<{
    command: string;
    executionMode: ExecutionMode;
}> = [
    {
        command: 'vscode-dataform-tools.runFilesTagsWtOptions',
        executionMode: 'cli',
    },
    {
        command: 'vscode-dataform-tools.runFilesTagsWtOptionsApi',
        executionMode: 'api',
    },
    {
        command: 'vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace',
        executionMode: 'api_workspace',
    },
];

export async function initializeExtension(
    context: vscode.ExtensionContext
): Promise<void> {
    initializeLogger(context);
    initializeGlobalState(context);
    validateRequiredExecutables();
    registerLifecycleDisposables(context);
    initializeDiagnostics(context);
    registerCompiledQueryPanel(context);

    const queryResultsViewProvider = registerQueryResultsView(context);

    registerCommands(context, queryResultsViewProvider);
    registerLanguageFeatures(context);
    registerEventHandlers(context, queryResultsViewProvider);
    recommendErrorLens();
    await initializeWorkspaceServices();

    logger.info('Dataform Tools extension activated successfully');
}

function initializeLogger(context: vscode.ExtensionContext): void {
    logger.initialize();
    logger.info('Activating Dataform Tools extension');

    sendNotifactionToUserOnExtensionUpdate(context);
    registerDisposables(context, new vscode.Disposable(() => logger.dispose()));
}

function initializeGlobalState(context: vscode.ExtensionContext): void {
    globalThis.CACHED_COMPILED_DATAFORM_JSON =
        undefined as DataformCompiledJson | undefined;
    logger.debug(
        'Extension activated - initialized global cache (CACHED_COMPILED_DATAFORM_JSON = undefined)'
    );
    globalThis.declarationsAndTargets = [];
    globalThis.dataformTags = [];
    globalThis.isRunningOnWindows = os.platform() === 'win32';
    globalThis.isWsl = vscode.env.remoteName === 'wsl';
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

    const snippetsPath = path.join(
        context.extensionPath,
        'snippets',
        'bigquery.code-snippets.json'
    );
    const snippetsContent = fs.readFileSync(snippetsPath, 'utf8');
    const snippets = JSON.parse(snippetsContent) as Record<
        string,
        typeof globalThis.bigQuerySnippetMetadata
    >;

    globalThis.bigQuerySnippetMetadata = snippets['.source.sql-bigquery'];
}

function validateRequiredExecutables(): void {
    for (const executable of executablesToCheck) {
        logger.debug(`Checking executable availability: ${executable}`);
        executableIsAvailable(executable, true);
    }
}

function registerLifecycleDisposables(
    context: vscode.ExtensionContext
): void {
    registerDisposables(
        context,
        new vscode.Disposable(() => clearAuthenticationCheckInterval())
    );
}

function initializeDiagnostics(context: vscode.ExtensionContext): void {
    globalThis.diagnosticCollection =
        vscode.languages.createDiagnosticCollection('myDiagnostics');
    registerDisposables(context, globalThis.diagnosticCollection);
}

function registerQueryResultsView(
    context: vscode.ExtensionContext
): CustomViewProvider {
    const queryResultsViewProvider = new CustomViewProvider(context.extensionUri);

    registerDisposables(
        context,
        vscode.window.registerWebviewViewProvider(
            'queryResultsView',
            queryResultsViewProvider,
            {
                webviewOptions: { retainContextWhenHidden: true },
            }
        )
    );

    return queryResultsViewProvider;
}

function registerCommands(
    context: vscode.ExtensionContext,
    queryResultsViewProvider: CustomViewProvider
): void {
    registerCommand(context, 'vscode-dataform-tools.runQuery', async () => {
        logger.info('Running query command');
        await previewQueryResults(queryResultsViewProvider);
    });

    registerCommand(
        context,
        'vscode-dataform-tools.dependencyGraphPanel',
        async () => {
            createDependencyGraphPanel(context, vscode.ViewColumn.One);
        }
    );

    registerCommand(context, 'vscode-dataform-tools.cancelQuery', async () => {
        await cancelBigQueryJob();
    });

    registerCommand(
        context,
        'vscode-dataform-tools.selectWorkspaceFolder',
        async () => {
            await selectWorkspaceFolder();
        }
    );

    registerCommand(context, 'vscode-dataform-tools.runAssertions', async () => {
        const currentFileMetadata = await getCurrentFileMetadata(false);
        if (!currentFileMetadata?.fileMetadata) {
            return;
        }

        await runQueryInPanel(
            {
                query: currentFileMetadata.fileMetadata.queryMeta.assertionQuery,
                type: 'assertion',
            },
            queryResultsViewProvider
        );
    });

    registerCommand(
        context,
        'vscode-dataform-tools.fixError',
        async (
            document: vscode.TextDocument,
            range: vscode.Range,
            diagnosticMessage: string
        ) => {
            applyCodeActionUsingDiagnosticMessage(range, diagnosticMessage);
            await document.save();
        }
    );

    registerCommand(
        context,
        'vscode-dataform-tools.clearExtensionCache',
        async () => {
            const cachedKeys = context.globalState
                .keys()
                .filter((key) => key.startsWith('vscode_dataform_tools_'));

            for (const key of cachedKeys) {
                await context.globalState.update(key, undefined);
                logger.info(`Cleared cached data for key: ${key}`);
            }

            vscode.window.showInformationMessage(
                'Dataform Tools extension cache cleared.'
            );
        }
    );

    registerRunCurrentFileCommands(context);
    registerRunTagCommands(context);
    registerRunFilesAndTagsCommands(context);

    registerCommand(
        context,
        'vscode-dataform-tools.createNewDataformProject',
        createNewDataformProject
    );

    registerCommand(
        context,
        'vscode-dataform-tools.showCompiledQueryWtDryRun',
        async () => {
            CompiledQueryPanel.getInstance(
                context.extensionUri,
                context,
                true,
                true,
                undefined
            );
        }
    );

    registerCommand(context, 'vscode-dataform-tools.formatDocument', () => {
        void vscode.commands.executeCommand('editor.action.formatDocument');
    });

    registerCommand(
        context,
        'vscode-dataform-tools.lintCurrentFile',
        async () => {
            if (globalThis.diagnosticCollection) {
                await lintCurrentFile(globalThis.diagnosticCollection);
            }
        }
    );
}

function registerRunCurrentFileCommands(
    context: vscode.ExtensionContext
): void {
    for (const commandConfig of RUN_CURRENT_FILE_COMMANDS) {
        registerCommand(context, commandConfig.command, () => {
            void runCurrentFile(
                context,
                commandConfig.includeDependencies,
                commandConfig.includeDependents,
                commandConfig.fullRefresh,
                commandConfig.executionMode
            );
        });
    }
}

function registerRunTagCommands(context: vscode.ExtensionContext): void {
    for (const commandConfig of RUN_TAG_COMMANDS) {
        registerCommand(context, commandConfig.command, () => {
            void runTag(
                context,
                commandConfig.includeDependencies,
                commandConfig.includeDependents,
                commandConfig.fullRefresh,
                commandConfig.executionMode
            );
        });
    }
}

function registerRunFilesAndTagsCommands(
    context: vscode.ExtensionContext
): void {
    for (const commandConfig of RUN_FILES_TAGS_COMMANDS) {
        registerCommand(context, commandConfig.command, () => {
            void runFilesTagsWtOptions(context, commandConfig.executionMode);
        });
    }
}

function registerLanguageFeatures(
    context: vscode.ExtensionContext
): void {
    const sqlxSelector: vscode.DocumentSelector = { language: 'sqlx' };
    const sqlxFileSelector: vscode.DocumentSelector = {
        language: 'sqlx',
        scheme: 'file',
    };

    const codeLensProviders: vscode.CodeLensProvider[] = [
        new AssertionRunnerCodeLensProvider(),
        new TagsRunnerCodeLensProvider(),
    ];
    for (const provider of codeLensProviders) {
        registerDisposables(
            context,
            vscode.languages.registerCodeLensProvider(sqlxSelector, provider)
        );
    }

    const definitionProviders: Array<
        [vscode.DocumentSelector, vscode.DefinitionProvider]
    > = [
        [sqlxSelector, new DataformRequireDefinitionProvider()],
        [sqlxSelector, new DataformJsDefinitionProvider()],
        [sqlxFileSelector, new DataformCTEDefinitionProvider()],
    ];
    for (const [selector, provider] of definitionProviders) {
        registerDisposables(
            context,
            vscode.languages.registerDefinitionProvider(selector, provider)
        );
    }

    const hoverProviders: vscode.HoverProvider[] = [
        new DataformHoverProvider(),
        new DataformBigQueryHoverProvider(),
        new DataformConfigProvider(),
    ];
    for (const provider of hoverProviders) {
        registerDisposables(
            context,
            vscode.languages.registerHoverProvider(sqlxSelector, provider)
        );
    }

    registerDisposables(
        context,
        vscode.languages.registerDocumentSymbolProvider(
            sqlxFileSelector,
            new SqlxDocumentSymbolProvider()
        ),
        vscode.languages.registerDocumentFormattingEditProvider('sqlx', {
            async provideDocumentFormattingEdits(
                document: vscode.TextDocument
            ): Promise<vscode.TextEdit[]> {
                return (await formatDataformSqlxFile(document)) ?? [];
            },
        }),
        dataformCodeActionProviderDisposable(),
        sourcesAutoCompletionDisposable(),
        schemaAutoCompletionDisposable(),
        dependenciesAutoCompletionDisposable(),
        tagsAutoCompletionDisposable(),
        renameProvider
    );
}

function registerEventHandlers(
    context: vscode.ExtensionContext,
    queryResultsViewProvider: CustomViewProvider
): void {
    const debouncedActiveEditorChange = debounce(
        async (editor: vscode.TextEditor | undefined) => {
            if (!editor || !queryResultsViewProvider._view?.visible) {
                return;
            }

            await postActiveQueryPreview(queryResultsViewProvider);
        },
        globalThis.DEBOUNCE_WAIT
    );

    registerDisposables(
        context,
        vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.enableLogging')) {
                logger.initialize();
                logger.info('Logging configuration updated');
            }
        })
    );
}

async function postActiveQueryPreview(
    queryResultsViewProvider: CustomViewProvider
): Promise<void> {
    const currentFileMetadata = await getCurrentFileMetadata(false);
    if (!currentFileMetadata?.fileMetadata || !queryResultsViewProvider._view) {
        return;
    }

    const type = currentFileMetadata.fileMetadata.queryMeta.type;
    const query = getQueryStringForPreview(
        currentFileMetadata.fileMetadata,
        globalThis.incrementalCheckBox
    );

    void queryResultsViewProvider._view.webview.postMessage({
        type,
        incrementalCheckBox: globalThis.incrementalCheckBox,
        query,
    });
}

function recommendErrorLens(): void {
    const errorLensExtensionInstalled =
        vscode.extensions.getExtension('usernamehw.errorlens');

    if (errorLensExtensionInstalled || globalThis.isWsl) {
        return;
    }

    const message =
        'The Dataform tools extension recommends installing the Error Lens extension to show error messages inline.';
    const installButton = 'Install Error Lens';

    void vscode.window
        .showInformationMessage(message, installButton)
        .then((selection) => {
            if (selection === installButton) {
                void vscode.env.openExternal(
                    vscode.Uri.parse('vscode:extension/usernamehw.errorlens')
                );
            }
        });
}

async function initializeWorkspaceServices(): Promise<void> {
    globalThis.workspaceFolder = await getWorkspaceFolder();
    if (!globalThis.workspaceFolder) {
        return;
    }

    createBigQueryClient();
    setAuthenticationCheckInterval();
}

function registerCommand(
    context: vscode.ExtensionContext,
    command: string,
    callback: (...args: any[]) => unknown
): void {
    registerDisposables(
        context,
        vscode.commands.registerCommand(command, callback)
    );
}

function registerDisposables(
    context: vscode.ExtensionContext,
    ...disposables: vscode.Disposable[]
): void {
    context.subscriptions.push(...disposables);
}
