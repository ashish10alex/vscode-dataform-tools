import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { snoozeManager, compiledQueryWtDryRun, dryRunAndShowDiagnostics, formatDryRunCostSummary, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getNonce, getTableSchema, getWorkspaceFolder, handleSemicolonPrePostOps, selectWorkspaceFolder, openFileOnLeftEditorPane, findModelFromTarget, getPostionOfSourceDeclaration, showLoadingProgress, executableIsAvailable, readDataformCoreVersion, getRelativePath, deriveNodeMapsFromQueryMeta, isCompilationStale, ensureFreshCompilation, setOnStartupCompileSettled } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";
import { runCurrentFile } from "../runCurrentFile";
import { runTagWtApi } from "../runTag";
import { runTests } from "../runTests";
import { ActionDescription, CurrentFileMetadata, SupportedCurrency, BigQueryDryRunResponse, WebviewMessage, WorkflowUrlEntry, ActionCounts, WorkflowAction, CompilationErrorType, SchemaMetadata, CachedResults, DryRunAnnotation } from "../types";
import { currencySymbolMapping, executablesToCheck } from "../constants";
import { costEstimator } from "../costEstimator";
import { getModelLastModifiedTime } from "../bigqueryDryRun";
import { logger } from "../logger";
import { PerfSpan, perfStart, perfTimed } from "../perf";
import { formatCurrentFile } from "../formatCurrentFile";
import * as fs from 'fs';
import { debounce } from "../debounce";
import { loadDataformTools } from "../lazySdk";
import { parseCompilationStack } from "../parseCompilationStack";
import { cancelWorkflowInvocation } from "../dataformApiUtils";
import { exportWorkflowActionsCsv, loadJobStatsForInvocation, openBigQueryJobInConsole, openExecutedSql, workflowActionTarget } from "../workflowJobTelemetry";
import { timestampToMs } from "../shared/jobTiming";
import { queryDryRun, getLineAndColumnNumberFromErrorMessage } from "../bigqueryDryRun";
import {
    PROPERTY_GRAPHS_MIN_CORE_VERSION,
    buildPropertyGraphCreateStatement,
    classifyPropertyGraphDryRunError,
    fullTargetName,
    getPropertyGraphsForFile,
    isCoreVersionAtLeast,
    isPropertyGraphCandidateFile,
} from "../shared/propertyGraph";
import type { PropertyGraph, PropertyGraphValidation, PropertyGraphElementSchema } from "../types";
import { applyColumnDescriptions, flattenSchemaFields } from "../utils/schemaTree";
import { getCompilationInfo, setOnCompilationInfoChanged } from '../utils/compilationInfo';
import { isRemoteMode, setCompilationBackend, setOnRemoteCompileCompleted } from '../utils/remoteCompiler';
import { buildLastRunView, getLastRun, onDidChangeLastRun } from '../lastRun';
import { getChangedActionsView, runChangedActions, toChangedActionsView } from '../changedActions';
import { watchGitHead, watchGitState } from '../gitHeadWatcher';
import { computeApiRunGitState } from '../apiRunGitState';
import type { ApiRunGitState } from '../shared/apiRunGitState';
import { getDeferToProdState, onDeferralUpdated, toDeferralView } from '../defer';
import { changedColumnCount, onDidRecordDryRunSchema } from '../columnLineage/impactReport';

/** Recompiles the active document and refreshes the panel; set when the panel is registered. */
let recompileActiveDocument: (() => Promise<void>) | undefined;

/** Redraws the panel from the cached compile, e.g. after defer to prod is switched on or off */
export async function refreshCompiledQueryPanel() {
    const panel = CompiledQueryPanel.centerPanel;
    if (!panel || panel.centerPanelDisposed) {
        return;
    }
    const document = getDocumentToRecompile();
    if (document) {
        activeDocumentObj = document;
    }
    await panel.refreshFromCache(await getCurrentFileMetadata(false, { deferralInBackground: true }));
}

/**
 * The document the panel is showing. A click inside the panel focuses the webview, which clears
 * `activeTextEditor`, and `activeDocumentObj` is unset until a save or editor switch (e.g. when the
 * panel was opened from the editor title button), so fall back to a Dataform file still visible beside it.
 */
function getDocumentToRecompile(): vscode.TextDocument | undefined {
    return activeDocumentObj
        || vscode.window.activeTextEditor?.document
        || vscode.window.visibleTextEditors.find((editor) => /\.(sqlx|js)$/.test(editor.document.fileName))?.document;
}

/**
 * Dry run the statement we synthesise for each graph and post the outcome back.
 * Disabled graphs are skipped: Dataform will not execute them, so validating them
 * would report failures for something that is never run.
 */
async function validatePropertyGraphs(postMessage: (message: unknown) => Thenable<boolean>, propertyGraphs: PropertyGraph[]) {
    const validations: PropertyGraphValidation[] = await Promise.all(
        propertyGraphs.map(async (graph): Promise<PropertyGraphValidation> => {
            const targetName = fullTargetName(graph.target);
            const { statement, bodyStartLine } = buildPropertyGraphCreateStatement(graph);

            if (graph.disabled) {
                return { targetName, statement, state: "skipped", message: "Graph is disabled, validation skipped" };
            }
            if (!graph.graphBody) {
                return { targetName, statement, state: "skipped", message: "Compiler did not emit a graph body for this action" };
            }

            const dryRunResult = await queryDryRun(statement);
            if (dryRunResult.error?.hasError) {
                const message = dryRunResult.error.message ?? "Unknown BigQuery error";
                const { line } = getLineAndColumnNumberFromErrorMessage(message);
                return {
                    targetName,
                    statement,
                    state: "error",
                    ...classifyPropertyGraphDryRunError(bodyStartLine, message, line || undefined),
                };
            }
            return { targetName, statement, state: "ok" };
        }),
    );

    await postMessage({ "propertyGraphValidations": validations, "dryRunning": false });
}

/**
 * One fetch per compiled file: the save or switch handler starts it, and the panel render (and its redraw once
 * defer to prod resolves) reuse it. Every save or switch reads the file again, so it fetches again.
 */
const schemaFetches = new WeakMap<object, Promise<SchemaMetadata[]>>();
/** The file whose schemas completions should show: a slower fetch for a file shown before must not replace them */
let latestSchemaRequest: object | undefined;

function updateSchemaAutoCompletions(currentFileMetadata:any): Promise<void> {
    const fileMetadata = currentFileMetadata?.fileMetadata;
    latestSchemaRequest = fileMetadata;
    if (!fileMetadata?.tables) {
        schemaAutoCompletions = [];
        return Promise.resolve();
    }
    let fetch = schemaFetches.get(fileMetadata);
    if (!fetch) {
        fetch = fetchSchemaAutoCompletions(fileMetadata.tables);
        schemaFetches.set(fileMetadata, fetch);
    }
    return fetch.then((columns) => {
        if (latestSchemaRequest === fileMetadata) {
            schemaAutoCompletions = columns;
        }
    });
}

async function fetchSchemaAutoCompletions(tables: any[]): Promise<SchemaMetadata[]> {
    const endSpan = perfStart('schemaFetch');
    // Tables of one file often share dependencies
    const dependencies = new Map<string, {database:string, schema:string, name:string}>();
    for (const table of tables) {
        for (const dt of table.dependencyTargets ?? []) {
            dependencies.set(`${dt.database}.${dt.schema}.${dt.name}`, dt);
        }
    }
    const schemas = await Promise.all([...dependencies.values()].map((dt) => getTableSchema(dt.database, dt.schema, dt.name)));
    const allSchemaCompletions: SchemaMetadata[] = schemas.flat();
    endSpan({ columns: allSchemaCompletions.length });
    return allSchemaCompletions;
}

// The save / editor switch that is about to render: armed right before `getInstance` so that the render it
// starts, and not one already in flight, ends the span
let armedPreviewSpan: ((attrs?: PerfSpan['attrs']) => void) | undefined;

// What an API run leaves out only changes with the working tree or the commits: it is computed again after a
// save or a git change (coalesced, as one save can raise both), and renders post the last computation
let apiRunGitStateGeneration = 0;
let apiRunGitStateCache: { folder: string, generation: number, state: Promise<ApiRunGitState> } | undefined;
const refreshApiRunGitStateSoon = debounce(() => CompiledQueryPanel.centerPanel?.postApiRunGitState(), 500);
function apiRunGitStateChanged() {
    apiRunGitStateGeneration++;
    refreshApiRunGitStateSoon();
}

function getLastRunView() {
    return buildLastRunView(getLastRun(), isRemoteMode(), globalThis.compilerOptionsMap);
}

export function registerCompiledQueryPanel(context: ExtensionContext) {

    context.subscriptions.push(
        onDidChangeLastRun(() => {
            CompiledQueryPanel.centerPanel?.postMessage({ lastRun: getLastRunView() });
        }),
        onDeferralUpdated(() => {
            const panel = CompiledQueryPanel.centerPanel;
            panel?.postMessage({ deferral: toDeferralView(panel.deferral) });
        }),
        onDidRecordDryRunSchema(async ({ document, relativeFilePath, fields }) => {
            if (!CompiledQueryPanel.centerPanel || !relativeFilePath) {
                return;
            }
            try {
                const changed = await changedColumnCount(document, fields);
                CompiledQueryPanel.centerPanel?.postMessage({ columnImpact: { relativeFilePath, changed } });
            } catch (error: any) {
                // Not a single-table file, or not compiled yet: no hint
                logger.debug(`Column impact hint: ${error?.message ?? error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryInWebView', async() => {
            const currentFileMetadata = CompiledQueryPanel?.centerPanel?.currentFileMetadata;
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, false, currentFileMetadata);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.refreshWorkflowUrls', () => {
            if (CompiledQueryPanel.centerPanel?.webviewPanel) {
                const workflowUrls = context.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                CompiledQueryPanel.centerPanel.postMessage({
                    workflowUrls: workflowUrls
                });
            }
        }),
        vscode.commands.registerCommand('vscode-dataform-tools.snoozeCompilation', async () => {
            snoozeManager.startSnooze(context);
        }),
        vscode.commands.registerCommand('vscode-dataform-tools.stopSnoozeCompilation', async () => {
            await snoozeManager.stopSnooze(false);
        }),
        {
            dispose: () => snoozeManager.dispose()
        }
    );

    snoozeManager.registerWebviewHandlers(
        (msg) => {
            if (CompiledQueryPanel.centerPanel?.webviewPanel) {
                CompiledQueryPanel.centerPanel.postMessage(msg);
            }
        },
        () => !!(CompiledQueryPanel.centerPanel?.webviewPanel?.visible)
    );

    const debouncedActiveEditorChange = debounce(async (editor: vscode.TextEditor | undefined) => {
        const changedActiveEditorFileName = editor?.document?.fileName;
        const webviewPanelVisisble = CompiledQueryPanel?.centerPanel?.webviewPanel?.visible;
        if (!activeEditorFileName) {
            activeEditorFileName = changedActiveEditorFileName;
        } else if (editor && changedActiveEditorFileName && activeEditorFileName !== changedActiveEditorFileName && webviewPanelVisisble) {
            activeEditorFileName = changedActiveEditorFileName;
            activeDocumentObj = editor.document;
            if (snoozeManager.isSnoozeActive()) {
                // Keep tracking the active file but defer the refresh until snooze ends
                snoozeManager.markDirtyDuringSnooze();
                return;
            }
            const endSwitchSpan = perfStart('switchPreview');
            let currentFileMetadata = await getCurrentFileMetadata(false, { deferralInBackground: true });
            updateSchemaAutoCompletions(currentFileMetadata);
            armedPreviewSpan = endSwitchSpan;
            CompiledQueryPanel.getInstance(context.extensionUri, context, false, true, currentFileMetadata);
        }
    }, globalThis.DEBOUNCE_WAIT);

    vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange, null, context.subscriptions);


    const triggerCompilationForDocument = async (document: vscode.TextDocument, spanName: string = 'recompilePreview') => {
        const endPreviewSpan = perfStart(spanName);
        const fileExtension = document.fileName.split('.').pop();
        const fileName = path.basename(document.fileName, '.' + fileExtension);
        const isConfigFile = fileName === 'workflow_settings' || fileName === 'dataform' || (fileName === 'package' && fileExtension === 'json');
        
        // definitions/**/*.yaml can hold a property graph, which the panel renders, so a save
        // there has to refresh like a .sqlx save does.
        const isDefinitionsYaml = isPropertyGraphCandidateFile(getRelativePath(document.fileName));
        if (fileExtension && !(fileExtension === 'sqlx' || fileExtension === 'js' || isConfigFile || isDefinitionsYaml)) {
            return;
        }
        activeEditorFileName = document?.fileName;
        activeDocumentObj = document;
        const showCompiledQueryInVerticalSplitOnSave: boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || (CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false)) {
            if (CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
                const workspaceFolder = await getWorkspaceFolder();
                let dataformCoreVersion = undefined;
                if (workspaceFolder) {
                    dataformCoreVersion = await readDataformCoreVersion(workspaceFolder);
                }
                CompiledQueryPanel?.centerPanel?.postMessage({
                    "recompiling": true,
                    "compilationBackend": isRemoteMode() ? "api" : "cli",
                    "dataformCoreVersion": dataformCoreVersion,
                    "relativeFilePath": getRelativePath(document.fileName),
                });
                let currentFileMetadata = await getCurrentFileMetadata(true, { deferralInBackground: true });
                updateSchemaAutoCompletions(currentFileMetadata);
                armedPreviewSpan = endPreviewSpan;
                CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, currentFileMetadata);
            } else {
                showLoadingProgress(
                    "Dataform tools\n",
                    async (progress) => {
                        progress.report({ message: "Generating compiled query metadata..." });
                        CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, undefined);
                    },
                );
            }
        } else {
            if (diagnosticCollection && showCompiledQueryInVerticalSplitOnSave === false) {
                compiledQueryWtDryRun(document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);
            }
        }
    };

    setOnStartupCompileSettled(() => {
        refreshCompiledQueryPanel()
            .then(() => CompiledQueryPanel.centerPanel?.postChangedActions(false))
            .catch((error) => logger.error(`Failed to refresh the panel after the startup compilation: ${error}`));
    });

    setOnCompilationInfoChanged((info) => {
        CompiledQueryPanel?.centerPanel?.postMessage({ compilationInfo: info });
    });

    recompileActiveDocument = async () => {
        const doc = getDocumentToRecompile();
        if (doc) {
            await triggerCompilationForDocument(doc);
        }
    };
    setOnRemoteCompileCompleted(recompileActiveDocument);

    snoozeManager.setOnSnoozeEndedCallback(async () => {
        const doc = getDocumentToRecompile();
        if (doc) {
            await triggerCompilationForDocument(doc);
        }
    });

    const debouncedSaveHandler = debounce(async (document: vscode.TextDocument) => {
        // Without the git extension this is the only signal that the uncommitted changes moved
        apiRunGitStateChanged();

        const fileExtension = document.fileName.split('.').pop();
        const fileName = path.basename(document.fileName, '.' + fileExtension);
        const isConfigFile = fileName === 'workflow_settings' || fileName === 'dataform' || (fileName === 'package' && fileExtension === 'json');
        
        if (fileExtension && !(fileExtension === 'sqlx' || fileExtension === 'js' || isConfigFile)) {
            return;
        }

        if (snoozeManager.isSnoozeActive()) {
            snoozeManager.markDirtyDuringSnooze();
            activeEditorFileName = document?.fileName;
            activeDocumentObj = document;
            return;
        }

        await triggerCompilationForDocument(document, 'savePreview');
    }, globalThis.DEBOUNCE_WAIT);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(debouncedSaveHandler));

    // A checkout, commit or pull changes the project without saving a file, so treat it like a save.
    watchGitHead(context, async (repositoryRoot) => {
        const doc = activeDocumentObj || vscode.window.activeTextEditor?.document;
        const relative = doc ? path.relative(repositoryRoot, doc.fileName) : '..';
        if (!doc || relative.startsWith('..') || path.isAbsolute(relative)) {
            return; // A different repository from the Dataform project being shown
        }
        // The count belongs to the previous branch; drop it now rather than after the recompile
        CompiledQueryPanel.centerPanel?.postMessage({ changedActions: { status: 'idle' } });
        if (snoozeManager.isSnoozeActive()) {
            snoozeManager.markDirtyDuringSnooze();
            return;
        }
        await triggerCompilationForDocument(doc);
    });

    // Edits, commits, pushes and fetches change what a Dataform API run leaves out
    watchGitState(context, () => {
        apiRunGitStateChanged();
    });
}


export class CompiledQueryPanel {
    public static centerPanel: CompiledQueryPanel | undefined;
    public centerPanelDisposed: boolean = false;
    public currentFileMetadata: any;
    /** Defer to prod state of the file shown; its Stale Deferral flags can arrive after it was posted */
    public deferral: CurrentFileMetadata["deferral"];
    private _cachedResults?: CachedResults;
    /** Bumped by every render, so a render still waiting on defer to prod can tell it has been replaced */
    private renderSeq = 0;
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext, forceShowVerticalSplit:boolean, currentFileMetadata:any, freshCompilation: boolean = true) {
        CompiledQueryPanel.registerListeners(this, extensionContext);
        this.updateView(forceShowVerticalSplit, currentFileMetadata, freshCompilation);
    }

    /**
     * Compiles, dry runs and API calls often finish after the user has closed the panel, and touching a
     * disposed panel's webview throws, so every message goes through here and is dropped once it is closed.
     */
    public postMessage(message: unknown): Thenable<boolean> {
        if (this.centerPanelDisposed) {
            return Promise.resolve(false);
        }
        return this.webviewPanel.webview.postMessage(message);
    }

    public static async getInstance(extensionUri: Uri, extensionContext: ExtensionContext, freshCompilation:boolean, forceShowInVeritcalSplit:boolean, currentFileMetadata:any) {
        // An outdated saved compilation is shown straight away; the startup compile redraws the panel when it finishes
        const renderFresh = freshCompilation && !isCompilationStale();
        if(CompiledQueryPanel.centerPanel && !this.centerPanel?.centerPanelDisposed){
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave && !forceShowInVeritcalSplit){
                if (CompiledQueryPanel?.centerPanel?.webviewPanel){
                    CompiledQueryPanel.centerPanel.webviewPanel.dispose();
                }
                return;
            }
            CompiledQueryPanel.centerPanel.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata, renderFresh);
            CompiledQueryPanel.centerPanel.postApiRunGitState().catch((error) => logger.error(`Failed to refresh the API run git state: ${error}`));
        } else {
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave && showCompiledQueryInVerticalSplitOnSave !== undefined && !forceShowInVeritcalSplit){
                let currentFileMetadata = await getCurrentFileMetadata(freshCompilation);
                if (!currentFileMetadata) {
                    return;
                }

                const isConfigFile = currentFileMetadata.pathMeta && (
                    currentFileMetadata.pathMeta.filename === 'workflow_settings' || 
                    currentFileMetadata.pathMeta.filename === 'dataform' || 
                    (currentFileMetadata.pathMeta.filename === 'package' && currentFileMetadata.pathMeta.extension === 'json')
                );

                if (!isConfigFile && (currentFileMetadata.errors?.errorGettingFileNameFromDocument || !currentFileMetadata.fileMetadata)) {
                    return;
                }

                let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
                if (!queryAutoCompMeta){
                    return;
                }

                dataformTags = queryAutoCompMeta.dataformTags;
                declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

                if(diagnosticCollection){
                    diagnosticCollection.clear();
                }
                if (currentFileMetadata.document){
                    dryRunAndShowDiagnostics(currentFileMetadata, currentFileMetadata.document, diagnosticCollection, false);
                }
                return;
            }

            //TODO: Handle this later
            // if (!currentFileMetadata?.isDataformWorkspace) {
            //     return;
            // }

            const panel = window.createWebviewPanel(
                CompiledQueryPanel.viewType,
                "Dataform Tools",
                { preserveFocus: true, viewColumn: vscode.ViewColumn.Beside },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    localResourceRoots: [
                        Uri.joinPath(extensionUri, "media"),
                        Uri.joinPath(extensionUri, "dist")
                    ],
                }
            );
            CompiledQueryPanel.centerPanel = new CompiledQueryPanel(panel, extensionUri, extensionContext, forceShowInVeritcalSplit, currentFileMetadata, renderFresh);
        }
    }

    // Called once per panel from the constructor. getInstance runs on every save/recompile, so
    // registering these there would stack a duplicate message handler on each call.
    private static registerListeners(panel: CompiledQueryPanel, extensionContext: ExtensionContext) {
        const disposables: vscode.Disposable[] = [];

        panel.webviewPanel.onDidDispose(() => {
                panel.centerPanelDisposed = true;
                if(this.centerPanel === panel){
                    this.centerPanel = undefined;
                }
                disposables.forEach((disposable) => disposable.dispose());
            },
            null,
            disposables,
            );

        panel.webviewPanel.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'startSnooze':
                await vscode.commands.executeCommand('vscode-dataform-tools.snoozeCompilation');
                return;
              case 'stopSnooze':
                await vscode.commands.executeCommand('vscode-dataform-tools.stopSnoozeCompilation');
                return;
              case 'lineageNavigation':
                const projectId = message.value.split(".")[0];
                const datasetId = message.value.split(".")[1];
                const tableId = message.value.split(".")[2];

                if(!CACHED_COMPILED_DATAFORM_JSON){
                    // this should never happen as the view exposing the dependents can only be created when compilation is done;
                    vscode.window.showWarningMessage(`compile Dataform project before navigating to dependencies & dependents`);
                }

                let tables = CACHED_COMPILED_DATAFORM_JSON?.tables;
                let operations = CACHED_COMPILED_DATAFORM_JSON?.operations;
                let assertions = CACHED_COMPILED_DATAFORM_JSON?.assertions;
                let declarations = CACHED_COMPILED_DATAFORM_JSON?.declarations;

                const modelTypes = [tables, operations, assertions];
                for (const model of modelTypes) {
                    if (model) {
                        const result = findModelFromTarget({ projectId, tableId, datasetId }, model);
                        if(result){
                            const { filePath } = result;
                            if (filePath) {
                                const position =  new vscode.Position(0, 0);
                                openFileOnLeftEditorPane(filePath, position);
                                return;
                            }
                        }
                    }
                }

                if(declarations){
                    const result = findModelFromTarget({ projectId, tableId, datasetId }, declarations);
                    if(result){
                            const { filePath, targetName } = result;
                            const workspaceFolder = await getWorkspaceFolder();
                            if(workspaceFolder){
                                const fullFilePath = path.join(workspaceFolder, filePath);
                                const filePathUri = vscode.Uri.file(fullFilePath);
                                const position = await getPostionOfSourceDeclaration(filePathUri, targetName);

                                if(position){
                                    openFileOnLeftEditorPane(filePath, position);
                                    return;
                                }
                            }
                }
                }

                return;
              case 'copyToClipboard':
                const textToCopy = message.value;
                await vscode.env.clipboard.writeText(textToCopy);
                vscode.window.showInformationMessage('Schema copied to clipboard!');
                return;
              case 'exportSchema':
                const schemaData = message.value;
                const defaultFilename = message.filename || 'schema.json';
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultFilename),
                    filters: {
                        'JSON': ['json']
                    }
                });
                if (uri) {
                    const content = typeof schemaData === 'string' ? schemaData : JSON.stringify(schemaData, null, 2);
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                    vscode.window.showInformationMessage('Schema exported successfully!');
                }
                return;
              case 'exportCostEstimateCsv':
                const csvData = message.value;
                const defaultCsvFilename = message.filename || 'cost_estimate.csv';
                const csvUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultCsvFilename),
                    filters: {
                        'CSV': ['csv']
                    }
                });
                if (csvUri) {
                    await vscode.workspace.fs.writeFile(csvUri, Buffer.from(csvData, 'utf8'));
                    vscode.window.showInformationMessage('Cost estimate exported successfully!');
                }
                return;
              case 'selectWorkspaceFolder':
                await selectWorkspaceFolder();
                vscode.commands.executeCommand("vscode-dataform-tools.showCompiledQueryInWebView");
                return;
              case 'updateCompilerOptions': {
                const compilerOptions = message.value;
                const config = vscode.workspace.getConfiguration('vscode-dataform-tools');
                // Respect where the user has already configured `compilerOptions`.
                // VS Code's `update()` default writes to Workspace settings, which
                // leaks team-shared `.vscode/settings.json` when the user
                // configured the value at the User level. Inspect existing scope
                // and write back to the same place; fall back to Workspace for
                // first-time use to preserve previous behavior.
                const inspect = config.inspect('compilerOptions');
                const target = inspect?.workspaceValue === undefined && inspect?.globalValue !== undefined
                  ? vscode.ConfigurationTarget.Global
                  : vscode.ConfigurationTarget.Workspace;
                config.update('compilerOptions', compilerOptions, target);
                return;
              }
              case 'dependencyGraph':
                await vscode.commands.executeCommand("vscode-dataform-tools.dependencyGraphPanel");
                return;
              case 'dependencyInspector':
                await vscode.commands.executeCommand("vscode-dataform-tools.dependencyInspector");
                return;
              case 'columnLineage':
                await vscode.commands.executeCommand("vscode-dataform-tools.columnLineage");
                return;
              case 'previewResults':
                if(message.value){
                    await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                }
                return;
              case 'compileRemotely':
                await vscode.commands.executeCommand('vscode-dataform-tools.compileRemotely');
                return;
              case 'deferToProdActions':
                await vscode.commands.executeCommand('vscode-dataform-tools.deferToProdActions');
                return;
              case 'removeProxyViews':
                await vscode.commands.executeCommand('vscode-dataform-tools.removeProxyViews', message.value);
                await refreshCompiledQueryPanel();
                return;
              case 'toggleDeferToProd':
                await vscode.commands.executeCommand('vscode-dataform-tools.toggleDeferToProd', message.value);
                return;
              case 'openDeferToProdSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-dataform-tools.prodCompilerOptions');
                return;
              case 'retryDeferral':
                try {
                  await vscode.commands.executeCommand('vscode-dataform-tools.refreshDeferToProd');
                } catch (error: any) {
                  // The banner waits for a new deferral after Retry, so without one it would stay on "looking up"
                  logger.error(`Defer to prod: retry failed: ${error?.message}`);
                  panel.postMessage({ deferral: toDeferralView(undefined, `Retry failed: ${error?.message ?? error}`) });
                }
                return;
              case 'showLogs':
                logger.show();
                return;
              case 'switchCompilationBackend': {
                try {
                  await setCompilationBackend(message.value === 'api' ? 'api' : 'cli');
                  await recompileActiveDocument?.();
                } catch (error: any) {
                  vscode.window.showErrorMessage(`Unable to switch the compilation backend: ${error.message}`);
                }
                return;
              }
              case 'runTests': {
                const _workspaceFolder = message.value.workspaceFolder;
                await runTests(_workspaceFolder);
                return;
              }
              case 'runModel':
                const includeDependencies = message.value.includeDependencies;
                const includeDependents = message.value.includeDependents;
                const fullRefresh = message.value.fullRefresh;
                await runCurrentFile(extensionContext, includeDependencies, includeDependents, fullRefresh, "cli");
                return;
              case 'runModelApi':
                const _includeDependencies = message.value.includeDependencies;
                const _includeDependents = message.value.includeDependents;
                const _fullRefresh = message.value.fullRefresh;
                // FIXME: there must be a way to avoid double calls before and after function invocation ?
                const _runModelApiNodeMaps = deriveNodeMapsFromQueryMeta(this.centerPanel?._cachedResults?.fileMetadata?.queryMeta);
                let messageDict: WebviewMessage = {
                    "tableOrViewQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.tableQueries?.map((t: any) => t.query).join("\n"),
                    "assertionQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.assertionQuery,
                    "preOperations": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.preOpsQuery,
                    "postOperations": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.postOpsQuery,
                    "incrementalPreOpsQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.incrementalPreOpsQuery,
                    "incrementalQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.incrementalQuery).join("\n"),
                    "nonIncrementalQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.nonIncrementalQuery).join("\n"),
                    "operationsQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.operationsQuery,
                    "testQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.testQuery,
                    "expectedOutputQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.expectedOutputQuery,
                    "relativeFilePath": this.centerPanel?._cachedResults?.fileMetadata.pathMeta?.relativeFilePath,
                    "errorMessage": this.centerPanel?._cachedResults?.errorMessage,
                    "dryRunErrorsByNodeType": this.centerPanel?._cachedResults?.dryRunErrorsByNodeType,
                    "dryRunErrorsByNodeName": _runModelApiNodeMaps.dryRunErrorsByNodeName,
                    "dryRunIncrementalErrorsByNodeName": _runModelApiNodeMaps.dryRunIncrementalErrorsByNodeName,
                    "dryRunExpectedOutputErrorsByNodeName": _runModelApiNodeMaps.dryRunExpectedOutputErrorsByNodeName || this.centerPanel?._cachedResults?.dryRunExpectedOutputErrorsByNodeName,
                    "dryRunIncrementalErrorsByNodeType": this.centerPanel?._cachedResults?.dryRunIncrementalErrorsByNodeType,
                    "dryRunQueryByNodeName": _runModelApiNodeMaps.dryRunQueryByNodeName,
                    "dryRunIncrementalQueryByNodeName": _runModelApiNodeMaps.dryRunIncrementalQueryByNodeName,
                    "dryRunNonIncrementalQueryByNodeName": _runModelApiNodeMaps.dryRunNonIncrementalQueryByNodeName,
                    "compiledQuerySchema": compiledQuerySchema,
                    "targetTablesOrViews": this.centerPanel?._cachedResults?.targetTablesOrViews,
                    "models": this.centerPanel?._cachedResults?.curFileMeta?.fileMetadata?.tables,
                    "dependents": this.centerPanel?._cachedResults?.curFileMeta?.dependents,
                    "dataformTags": dataformTags,
                    "apiUrlLoading": true,
                };
                this.centerPanel?.postMessage(messageDict);
                const result = await runCurrentFile(extensionContext, _includeDependencies, _includeDependents, _fullRefresh, "api");
                if(!result){
                    return;
                }
                const {workflowInvocationUrlGCP, errorWorkflowInvocation} = result;
                const updatedWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                messageDict = { ...messageDict, "workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation, "apiUrlLoading": false, "workflowUrls": updatedWorkflowUrls };
                this.centerPanel?.postMessage(messageDict);
                return;
              case 'runTagApi': {
                const tagsToRun: string[] = Array.isArray(message.value.selectedTags)
                    ? message.value.selectedTags.filter((t: unknown): t is string => typeof t === 'string' && t.trim() !== '')
                    : [];
                if (tagsToRun.length === 0) { return; }
                const includeDependencies = !!message.value.includeDependencies;
                const includeDependents = !!message.value.includeDependents;
                const fullRefresh = !!message.value.fullRefresh;
                await runTagWtApi(
                    extensionContext,
                    tagsToRun,
                    includeDependencies,
                    includeDependents,
                    fullRefresh,
                    'api',
                );
                return;
              }
              case 'costEstimator': {

                const selectedTags: string[] = message.value.selectedTags;
                const includeDependenciesCost = message.value.includeDependencies;
                const includeDependentsCost = message.value.includeDependents;
                const costWorkspaceFolder = await getWorkspaceFolder();
                if (costWorkspaceFolder) {
                    await ensureFreshCompilation(costWorkspaceFolder);
                }
                if(CACHED_COMPILED_DATAFORM_JSON){
                    logger.debug('Using cached compilation for tag cost estimation');
                    const tagDryRunStatsMeta = await costEstimator(CACHED_COMPILED_DATAFORM_JSON, selectedTags, includeDependenciesCost, includeDependentsCost);
                    let currency = "USD" as SupportedCurrency;
                    let currencySymbol = "$";
                    if(tagDryRunStatsMeta?.tagDryRunStatsList){
                        currency = tagDryRunStatsMeta?.tagDryRunStatsList[0].currency;
                        currencySymbol = currencySymbolMapping[currency];
                    }
                    const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                    const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                    const targetTablesOrViews  = this.centerPanel?._cachedResults?.targetTablesOrViews;
                    const errorMessage  = this.centerPanel?._cachedResults?.errorMessage;
                    const dryRunStatByNodeType = this.centerPanel?._cachedResults?.dryRunStatByNodeType;
                    const dryRunStatByNodeName = this.centerPanel?._cachedResults?.dryRunStatByNodeName;
                    const dryRunErrorsByNodeType = this.centerPanel?._cachedResults?.dryRunErrorsByNodeType;
                    const dryRunIncrementalErrorsByNodeType = this.centerPanel?._cachedResults?.dryRunIncrementalErrorsByNodeType;
                    const _costEstNodeMaps = deriveNodeMapsFromQueryMeta(fileMetadata?.queryMeta);
                    this.centerPanel?.postMessage({
                        "tableOrViewQuery": fileMetadata?.queryMeta?.tableQueries?.map((t: any) => t.query).join("\n"),
                        "assertionQuery": fileMetadata?.queryMeta?.assertionQuery,
                        "preOperations": fileMetadata?.queryMeta?.preOpsQuery,
                        "postOperations": fileMetadata?.queryMeta?.postOpsQuery,
                        "incrementalPreOpsQuery": fileMetadata?.queryMeta?.incrementalPreOpsQuery,
                        "incrementalQuery": fileMetadata?.queryMeta?.incrementalQueries?.map((q: any) => q.incrementalQuery).join("\n"),
                        "nonIncrementalQuery": fileMetadata?.queryMeta?.incrementalQueries?.map((q: any) => q.nonIncrementalQuery).join("\n"),
                        "operationsQuery": fileMetadata?.queryMeta?.operationsQuery,
                        "testQuery": fileMetadata?.queryMeta?.testQuery,
                        "expectedOutputQuery": fileMetadata?.queryMeta?.expectedOutputQuery,
                        "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                        "tagDryRunStatsMeta": tagDryRunStatsMeta,
                        "currencySymbol": currencySymbol,
                        "errorMessage": errorMessage,
                        "dryRunStatByNodeType": dryRunStatByNodeType,
                        "dryRunStatByNodeName": dryRunStatByNodeName,
                        "dryRunErrorsByNodeType": dryRunErrorsByNodeType,
                        "dryRunErrorsByNodeName": _costEstNodeMaps.dryRunErrorsByNodeName,
                        "dryRunIncrementalErrorsByNodeName": _costEstNodeMaps.dryRunIncrementalErrorsByNodeName,
                        "dryRunExpectedOutputErrorsByNodeName": _costEstNodeMaps.dryRunExpectedOutputErrorsByNodeName || this.centerPanel?._cachedResults?.dryRunExpectedOutputErrorsByNodeName,
                        "dryRunIncrementalErrorsByNodeType": dryRunIncrementalErrorsByNodeType,
                        "dryRunQueryByNodeName": _costEstNodeMaps.dryRunQueryByNodeName,
                        "dryRunIncrementalQueryByNodeName": _costEstNodeMaps.dryRunIncrementalQueryByNodeName,
                        "dryRunNonIncrementalQueryByNodeName": _costEstNodeMaps.dryRunNonIncrementalQueryByNodeName,
                        "compiledQuerySchema": compiledQuerySchema,
                        "targetTablesOrViews": targetTablesOrViews,
                        "models": curFileMeta?.fileMetadata?.tables,
                        "dependents": curFileMeta?.dependents,
                        "dataformTags": dataformTags,
                        "selectedTags": selectedTags,
                        "modelType": fileMetadata?.queryMeta?.type,
                        "actionTypes": [...new Set((curFileMeta?.fileMetadata?.tables || []).map((m: any) => m.type).filter(Boolean))],
                    });
                }else{
                    vscode.window.showErrorMessage("No cached data to estimate cost from");
                }
                return;
              }
              case 'formatCurrentFile':
                const formattedText:any = await formatCurrentFile(diagnosticCollection);
                const activeEditorFilePath = activeDocumentObj?.uri.fsPath;
                if(activeEditorFilePath){
                    fs.writeFile(activeEditorFilePath, formattedText, (err: any) => {
                        if (err) {throw err;};
                        vscode.window.showInformationMessage(`Formatted: ${path.basename(activeEditorFilePath)}`);
                        return;
                    });
                }
                return;
              case 'lintCurrentFile':
                await vscode.commands.executeCommand('vscode-dataform-tools.lintCurrentFile');
                return;
              case 'lineageMetadata': {
                const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                const targetTablesOrViews  = this.centerPanel?._cachedResults?.targetTablesOrViews;
                const errorMessage  = this.centerPanel?._cachedResults?.errorMessage;
                const dryRunStatByNodeType = this.centerPanel?._cachedResults?.dryRunStatByNodeType;
                const dryRunStatByNodeName = this.centerPanel?._cachedResults?.dryRunStatByNodeName;
                const dryRunErrorsByNodeType = this.centerPanel?._cachedResults?.dryRunErrorsByNodeType;
                const dryRunIncrementalErrorsByNodeTypeLineage = this.centerPanel?._cachedResults?.dryRunIncrementalErrorsByNodeType;
                const _lineageNodeMaps = deriveNodeMapsFromQueryMeta(fileMetadata?.queryMeta);
                const locationLineage = this.centerPanel?._cachedResults?.location ||
                    curFileMeta?.projectConfig?.defaultLocation ||
                    CACHED_COMPILED_DATAFORM_JSON?.projectConfig?.defaultLocation;

                if (!locationLineage) {
                    vscode.window.showErrorMessage("Location for lineage metadata not found. Please set 'defaultLocation' in your Dataform configuration.");
                    return;
                }

                const lineageMetadata = await getLiniageMetadata(fileMetadata?.tables?.[0]?.target, locationLineage);

                this.centerPanel?.postMessage({
                    "tableOrViewQuery": fileMetadata?.queryMeta?.tableQueries?.map((t: any) => t.query).join("\n"),
                    "assertionQuery": fileMetadata?.queryMeta?.assertionQuery,
                    "preOperations": fileMetadata?.queryMeta?.preOpsQuery,
                    "postOperations": fileMetadata?.queryMeta?.postOpsQuery,
                    "incrementalPreOpsQuery": fileMetadata?.queryMeta?.incrementalPreOpsQuery,
                    "incrementalQuery": fileMetadata?.queryMeta?.incrementalQueries?.map((q: any) => q.incrementalQuery).join("\n"),
                    "nonIncrementalQuery": fileMetadata?.queryMeta?.incrementalQueries?.map((q: any) => q.nonIncrementalQuery).join("\n"),
                    "operationsQuery": fileMetadata?.queryMeta?.operationsQuery,
                    "testQuery": fileMetadata?.queryMeta?.testQuery,
                    "expectedOutputQuery": fileMetadata?.queryMeta?.expectedOutputQuery,
                    "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                    "lineageMetadata": lineageMetadata,
                    "errorMessage": errorMessage,
                    "dryRunStatByNodeType": dryRunStatByNodeType,
                    "dryRunStatByNodeName": dryRunStatByNodeName,
                    "dryRunErrorsByNodeType": dryRunErrorsByNodeType,
                    "dryRunErrorsByNodeName": _lineageNodeMaps.dryRunErrorsByNodeName,
                    "dryRunIncrementalErrorsByNodeName": _lineageNodeMaps.dryRunIncrementalErrorsByNodeName,
                    "dryRunExpectedOutputErrorsByNodeName": _lineageNodeMaps.dryRunExpectedOutputErrorsByNodeName || this.centerPanel?._cachedResults?.dryRunExpectedOutputErrorsByNodeName,
                    "dryRunIncrementalErrorsByNodeType": dryRunIncrementalErrorsByNodeTypeLineage,
                    "dryRunQueryByNodeName": _lineageNodeMaps.dryRunQueryByNodeName,
                    "dryRunIncrementalQueryByNodeName": _lineageNodeMaps.dryRunIncrementalQueryByNodeName,
                    "dryRunNonIncrementalQueryByNodeName": _lineageNodeMaps.dryRunNonIncrementalQueryByNodeName,
                    "compiledQuerySchema": compiledQuerySchema,
                    "targetTablesOrViews": targetTablesOrViews,
                    "models": curFileMeta?.fileMetadata?.tables,
                    "dependents": curFileMeta?.dependents,
                    "dataformTags": dataformTags,
                    "modelType": fileMetadata?.queryMeta?.type,
                    "actionTypes": [...new Set((curFileMeta?.fileMetadata?.tables || []).map((m: any) => m.type).filter(Boolean))],
                });
                return;
              }
              case 'getWorkflowUrls':
                const currentWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                this.centerPanel?.postMessage({
                    workflowUrls: currentWorkflowUrls
                });
                return;
              case 'clearWorkflowUrls':
                await this.centerPanel?.extensionContext.workspaceState.update('dataform_workflow_urls', []);
                this.centerPanel?.postMessage({
                    workflowUrls: []
                });
                return;
              case 'cancelWorkflowInvocation':
                if (message.value?.workflowInvocationId && this.centerPanel) {
                    const cancelled = await cancelWorkflowInvocation(this.centerPanel.extensionContext, message.value.workflowInvocationId);
                    if (!cancelled) {
                        this.centerPanel?.postMessage({ cancelWorkflowInvocationFailed: message.value.workflowInvocationId });
                    }
                }
                return;
              case 'loadWorkflowJobStats':
              case 'exportWorkflowActionsCsv':
              case 'openExecutedSql':
              case 'openBigQueryJob': {
                const context = this.centerPanel?.extensionContext;
                const storedUrls = context?.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                const entry = storedUrls.find((item) => item.workflowInvocationId === message.value?.workflowInvocationId);
                if (!context || !entry) {
                    return;
                }
                if (message.command === 'openExecutedSql') {
                    await openExecutedSql(entry, message.value.target);
                } else if (message.command === 'exportWorkflowActionsCsv') {
                    await exportWorkflowActionsCsv(entry);
                } else if (message.command === 'openBigQueryJob') {
                    const action = entry.actions?.find((a) => a.target === message.value.target);
                    if (action) {
                        openBigQueryJobInConsole(entry, action);
                    }
                } else if (await loadJobStatsForInvocation(entry)) {
                    await context.workspaceState.update('dataform_workflow_urls', storedUrls);
                    this.centerPanel?.postMessage({ workflowUrls: storedUrls });
                }
                return;
              }
              case 'rerunLastExecution': {
                const previousTimestamp = getLastRun()?.timestamp;
                await vscode.commands.executeCommand('vscode-dataform-tools.rerunLastExecution');
                // Every runner records the run just before dispatching it, so an unchanged timestamp means
                // the rerun was cancelled or failed its checks and the webview should stop showing progress.
                if (getLastRun()?.timestamp === previousTimestamp) {
                  this.centerPanel?.postMessage({ rerunAborted: true });
                }
                return;
              }
              case 'computeChangedActions':
                await this.centerPanel?.postChangedActions(true);
                return;
              case 'runChangedActions': {
                const _workspaceFolder = await getWorkspaceFolder();
                if (!_workspaceFolder) { return; }
                const result = await runChangedActions(
                    extensionContext,
                    _workspaceFolder,
                    !!message.value.includeDependencies,
                    !!message.value.includeDependents,
                    !!message.value.fullRefresh,
                    message.value.api ? 'api' : 'cli',
                    Array.isArray(message.value.files) ? message.value.files : undefined,
                );
                if (result) {
                    this.centerPanel?.postMessage({ changedActions: toChangedActionsView(result) });
                }
                return;
              }
              case 'runFilesTagsWtOptionsApi':
                await vscode.commands.executeCommand('vscode-dataform-tools.runFilesTagsWtOptionsApi');
                return;
              case 'runFilesTagsWtOptionsInRemoteWorkspace':
                await vscode.commands.executeCommand('vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace');
                return;
              case 'refreshWorkflowStatuses':
                const urlsToRefresh = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];

                if (urlsToRefresh.length > 0) {
                    const refreshedUrls = await Promise.all(urlsToRefresh.map(async (original) => {
                        const item = { ...original };
                        const isNonTerminal = item.state !== 'SUCCEEDED' && item.state !== 'FAILED' && item.state !== 'CANCELLED';
                        const needsActionBackfill = item.state === 'FAILED' && (!item.failedActions || item.failedActions.length === 0);
                        const needsCountsBackfill = !item.actionCounts;
                        const needsActionsBackfill = !item.actions;
                        if ((isNonTerminal || needsActionBackfill || needsCountsBackfill || needsActionsBackfill) && item.workflowInvocationId && item.projectId && item.location && item.repositoryName) {
                            try {
                                const dataformClient = new (await loadDataformTools())(item.projectId, item.location);
                                const invocation = await dataformClient.getWorkflowInvocation(item.repositoryName, item.workflowInvocationId);
                                if (invocation && invocation.state) {
                                  item.state = invocation.state as string;
                                }
                                item.invocationStartTime = timestampToMs(invocation?.invocationTiming?.startTime) ?? item.invocationStartTime;
                                item.invocationEndTime = timestampToMs(invocation?.invocationTiming?.endTime) ?? item.invocationEndTime;
                                try {
                                    const actions = await dataformClient.queryWorkflowInvocationActions(item.repositoryName, item.workflowInvocationId);
                                    const list = (actions || []) as any[];
                                    const counts: ActionCounts = { total: list.length, pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, skipped: 0 };
                                    const actionInfos: WorkflowAction[] = [];
                                    const previousJobStats = new Map((item.actions ?? []).map((a) => [a.target, a.jobStats]));
                                    for (const a of list) {
                                        const s = a?.state;
                                        if (s === 'PENDING') { counts.pending++; }
                                        else if (s === 'RUNNING') { counts.running++; }
                                        else if (s === 'SUCCEEDED') { counts.succeeded++; }
                                        else if (s === 'FAILED') { counts.failed++; }
                                        else if (s === 'CANCELLED') { counts.cancelled++; }
                                        else if (s === 'SKIPPED' || s === 'DISABLED') { counts.skipped++; }

                                        const target = workflowActionTarget(a);
                                        actionInfos.push({
                                            target,
                                            state: typeof s === 'string' ? s : 'UNKNOWN',
                                            failureReason: a?.failureReason || undefined,
                                            jobId: a?.bigqueryAction?.jobId || undefined,
                                            jobStats: previousJobStats.get(target),
                                            startTime: timestampToMs(a?.invocationTiming?.startTime),
                                        });
                                    }
                                    item.actionCounts = counts;
                                    item.actions = actionInfos;
                                    // Loaded here rather than on request from the webview so each action's bytes billed
                                    // shows as soon as it finishes, and so this refresh cannot overwrite stats loaded concurrently.
                                    try {
                                        await loadJobStatsForInvocation(item);
                                    } catch (e: any) {
                                        logger.error(`Error loading BigQuery job stats: ${e.message}`);
                                    }

                                    if (item.state === 'FAILED') {
                                        const failedActions = list
                                            .filter((a: any) => !!a?.failureReason)
                                            .map((a: any) => ({ target: workflowActionTarget(a), failureReason: a.failureReason as string }));
                                        item.failedActions = failedActions.length > 0 ? failedActions : [{
                                            target: '(workflow)',
                                            failureReason: `Workflow invocation reported FAILED but the Dataform API returned no per-action failure reasons (${list.length} action(s) inspected). This usually means the failure happened before any action ran (e.g. compilation or workspace sync). Open in GCP for full logs.`,
                                        }];
                                    } else {
                                        item.failedActions = undefined;
                                    }
                                } catch (e: any) {
                                    logger.error(`Error fetching workflow invocation actions: ${e.message}`);
                                    if (item.state === 'FAILED') {
                                        item.failedActions = [{
                                            target: '(error)',
                                            failureReason: `Unable to fetch failure details from the Dataform API: ${e.message}`,
                                        }];
                                    }
                                }
                            } catch (e: any) {
                                logger.error(`Error fetching workflow invocation status: ${e.message}`);
                            }
                        }
                        return item;
                    }));

                    // Merge into the current history rather than overwriting it: entries may have been added,
                    // cleared or cancelled while the API calls above were in flight.
                    const latestUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                    const updatedUrls = latestUrls.map((current) => {
                        const index = urlsToRefresh.findIndex((item) => item.workflowInvocationId && item.workflowInvocationId === current.workflowInvocationId);
                        if (index === -1 || urlsToRefresh[index].state !== current.state) { return current; }
                        return refreshedUrls[index];
                    });
                    await this.centerPanel?.extensionContext.workspaceState.update('dataform_workflow_urls', updatedUrls);
                    this.centerPanel?.postMessage({
                        workflowUrls: updatedUrls
                    });
                }
                return;
              case 'propertyGraphElementSchema': {
                const { elementName, target } = message.value ?? {};
                if (!elementName || !target) {
                    return;
                }
                const fullTableId = `${target.database}.${target.schema}.${target.name}`;
                const columns = await getTableSchema(target.database, target.schema, target.name);
                const elementSchema: PropertyGraphElementSchema = {
                    elementName,
                    fullTableId,
                    columns: columns.map((column) => ({
                        name: column.name,
                        type: column.metadata?.type ?? "",
                        description: column.metadata?.description,
                    })),
                    // getTableSchema swallows its errors and returns [], so an empty result is
                    // the only signal available that the table could not be read.
                    error: columns.length === 0 ? `Could not read the schema of ${fullTableId}` : undefined,
                };
                await this.centerPanel?.postMessage({
                    "propertyGraphElementSchema": elementSchema,
                });
                return;
              }
              case 'runGeneratedQuery':
                await vscode.commands.executeCommand(
                    'vscode-dataform-tools.runGeneratedQuery',
                    message.value?.query,
                    message.value?.type ?? "table",
                );
                return;
              case 'openExternal':
                if(message.url){
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                return;
            }
            return;
          },
          undefined,
          disposables,
      );

    }


    //@ts-ignore
    private async sendUpdateToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:CurrentFileMetadata|undefined, freshCompilation: boolean = true) {
        const endPreviewSpan = armedPreviewSpan;
        armedPreviewSpan = undefined;
        const endRenderSpan = perfStart('render');
        try {
            return await this.renderToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, curFileMeta, freshCompilation);
        } finally {
            endRenderSpan();
            endPreviewSpan?.();
        }
    }

    private async renderToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:CurrentFileMetadata|undefined, freshCompilation: boolean = true): Promise<vscode.Webview | void> {
        if (this.centerPanelDisposed) {
            return;
        }
        const renderId = ++this.renderSeq;
        const webview = this.webviewPanel.webview;
        const compilerOptions = vscode.workspace.getConfiguration('vscode-dataform-tools').get<string>('compilerOptions');
        const workflowUrls = this.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];

        const workspaceFolder = await getWorkspaceFolder();
        let dataformCoreVersion = undefined;
        if (workspaceFolder) {
            dataformCoreVersion = await readDataformCoreVersion(workspaceFolder);
        }

        const missingExecutables: string[] = [];
        for (let i = 0; i < executablesToCheck.length; i++) {
            let executable = executablesToCheck[i];
            if (executable === 'dataform' && isRemoteMode()) {
                continue; // Remote mode compiles with the Dataform API, the CLI is not needed
            }
            if (!executableIsAvailable(executable, false, workspaceFolder)) {
                missingExecutables.push(executable);
            }
        }

        // Setting html on a panel closed during the awaits above would throw
        if (this.centerPanelDisposed) {
            return;
        }

        if (missingExecutables.length > 0) {
            if(this.webviewPanel.webview.html === ""){
                this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { missingExecutables, recompiling: false, compilerOptions, dataformCoreVersion, compilationBackend: isRemoteMode() ? "api" : "cli" });
            } else {
                await this.postMessage({
                    "missingExecutables": missingExecutables,
                    "recompiling": false,
                    "errorType": CompilationErrorType.MISSING_EXECUTABLE,
                    "isHelperFile": false,
                    "tableOrViewQuery": null,
                    "projectConfig": null,
                    "packageJsonContent": null,
                    "declarations": null,
                    "compiledQuerySchema": null,
                });
            }
            return;
        }

        if(this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { recompiling: freshCompilation, compilerOptions, dataformCoreVersion, compilationBackend: isRemoteMode() ? "api" : "cli" });
        }

        // Notify webview that we are starting compilation
        if (freshCompilation) {
            await this.postMessage({
                "recompiling": true,
                "compilationBackend": isRemoteMode() ? "api" : "cli",
                "compilerOptions": compilerOptions,
                "dataformCoreVersion": dataformCoreVersion,
                "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                "workspaceFolder": workspaceFolder,
            });
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(freshCompilation, { deferralInBackground: true });
        }

        if(!curFileMeta){
            await this.postMessage({
                "errorMessage": `File type not supported. Supported file types are sqlx, js`,
                "recompiling": false,
                "errorType": CompilationErrorType.UNSUPPORTED_FILE_TYPE,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
            });
            return;
        }


        if (curFileMeta.isDataformWorkspace===false){
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const currentDirectory = workspaceFolder?.uri.fsPath;
            await this.postMessage({
                "errorMessage": `${currentDirectory} is not a Dataform workspace. Hint: Open workspace rooted in workflow_settings.yaml or dataform.json`,
                "recompiling": false,
                "errorType": CompilationErrorType.NOT_A_DATAFORM_WORKSPACE,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
            });
            return;
        } else if (curFileMeta?.errors?.errorGettingFileNameFromDocument){
            await this.postMessage({
                "errorMessage": curFileMeta?.errors?.errorGettingFileNameFromDocument,
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
                "workspaceFolder": workspaceFolder,
            });
        } else if ((curFileMeta?.errors?.fileNotFoundError===true || curFileMeta?.fileMetadata?.tables?.length === 0) && curFileMeta?.pathMeta?.relativeFilePath && curFileMeta?.pathMeta?.extension === "sqlx"){
            const workspaceFolder = await getWorkspaceFolder();
            await this.postMessage({
                "errorType": CompilationErrorType.FILE_NOT_FOUND,
                "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                "workspaceFolder": workspaceFolder,
                "recompiling": false,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null
            });
            return;
        } else if (curFileMeta?.errors?.queryMetaError){
            await this.postMessage({
                "errorMessage": curFileMeta.errors.queryMetaError,
                "recompiling": false,
                "errorType": CompilationErrorType.QUERY_META_ERROR,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }
        if(curFileMeta.errors?.dataformCompilationErrors){
            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                await this.postMessage({ "recompiling": false });
                return;
            }

            for (const { error, fileName } of curFileMeta?.errors?.dataformCompilationErrors) {
                if (diagnosticCollection) {
                    const diagnostic = new vscode.Diagnostic(
                        new vscode.Range(0, 0, 0, 0),
                        `(** compilation error **): ${error}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    let fullSourcePath = path.join(workspaceFolder, fileName);
                    let sourcesJsUri = vscode.Uri.file(fullSourcePath);
                    diagnosticCollection.set(sourcesJsUri, [diagnostic]);
                }
            }

            await this.postMessage({
                "compilationErrors": curFileMeta.errors.dataformCompilationErrors?.map((compilationError: { error: string; fileName: string; stack?: string }) => {
                    const { lineNumber, sourceContext } = parseCompilationStack(compilationError.stack);
                    return { error: compilationError.error, fileName: compilationError.fileName, lineNumber, sourceContext };
                }),
                "possibleResolutions": curFileMeta.possibleResolutions ?? [],
                "errorMessage": null,
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "assertionQuery": null,
                "preOperations": null,
                "postOperations": null,
                "incrementalPreOpsQuery": null,
                "incrementalQuery": null,
                "nonIncrementalQuery": null,
                "operationsQuery": null,
                "testQuery": null,
                "expectedOutputQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }

        const isConfigFile = curFileMeta.pathMeta && (
            curFileMeta.pathMeta.filename === 'workflow_settings' || 
            curFileMeta.pathMeta.filename === 'dataform' || 
            (curFileMeta.pathMeta.filename === 'package' && curFileMeta.pathMeta.extension === 'json')
        );

        if (isConfigFile) {
            await this.postMessage({
                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                "projectConfig": curFileMeta.projectConfig,
                "dataformCoreVersion": curFileMeta.dataformCoreVersion,
                "packageJsonContent": curFileMeta.packageJsonContent,
                "recompiling": false,
                "isHelperFile": false,
                "declarations": null,
                "errorType": null,
                "errorMessage": null,
                "tableOrViewQuery": null,
                "assertionQuery": null,
                "preOperations": null,
                "postOperations": null,
                "incrementalPreOpsQuery": null,
                "incrementalQuery": null,
                "nonIncrementalQuery": null,
                "operationsQuery": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }
        // PropertyGraph actions live in yaml files that produce no queries, so they never
        // reach the table/assertion/operation pipeline below and would otherwise render as
        // an empty panel.
        const relativeFilePathForGraphs = curFileMeta.pathMeta?.relativeFilePath;
        if (isPropertyGraphCandidateFile(relativeFilePathForGraphs)) {
            const propertyGraphs = getPropertyGraphsForFile(relativeFilePathForGraphs, CACHED_COMPILED_DATAFORM_JSON);

            if (propertyGraphs.length > 0) {
                if (diagnosticCollection) {
                    diagnosticCollection.clear();
                }
                await this.postMessage({
                    "propertyGraphs": propertyGraphs,
                    "propertyGraphValidations": null,
                    "relativeFilePath": relativeFilePathForGraphs,
                    "compilationTimeMs": curFileMeta.compilationTimeMs,
                    "dataformTags": dataformTags,
                    "dataformCoreVersion": curFileMeta.dataformCoreVersion,
                    "compilerOptions": compilerOptions,
                    "workflowUrls": workflowUrls,
                    "lastRun": getLastRunView(),
                    "workspaceFolder": workspaceFolder,
                    "recompiling": false,
                    "dryRunning": true,
                    "errorType": null,
                    "errorMessage": null,
                    "isHelperFile": false,
                    "declarations": null,
                    "models": null,
                    "tableOrViewQuery": null,
                    "assertionQuery": null,
                    "preOperations": null,
                    "postOperations": null,
                    "incrementalPreOpsQuery": null,
                    "incrementalQuery": null,
                    "nonIncrementalQuery": null,
                    "operationsQuery": null,
                    "testQuery": null,
                    "expectedOutputQuery": null,
                    "projectConfig": null,
                    "packageJsonContent": null,
                    "compiledQuerySchema": null,
                });

                if (isCompilationStale()) {
                    await this.postMessage({ "dryRunning": false });
                    return;
                }
                // Validation is a network round trip; do not hold up the render for it.
                validatePropertyGraphs((message) => this.postMessage(message), propertyGraphs).catch((error) => {
                    logger.error(`Error validating property graphs: ${error}`);
                    // The render above set dryRunning: true; without this the webview spins forever.
                    this.postMessage({ "dryRunning": false });
                });
                return;
            }

            const coreVersion = curFileMeta.dataformCoreVersion ?? CACHED_COMPILED_DATAFORM_JSON?.dataformCoreVersion;
            if (!isCoreVersionAtLeast(coreVersion, PROPERTY_GRAPHS_MIN_CORE_VERSION)) {
                await this.postMessage({
                    "errorMessage": `Property graphs require @dataform/core ${PROPERTY_GRAPHS_MIN_CORE_VERSION} or later. This project is on ${coreVersion}, so the compiled output contains no propertyGraphs for this file.`,
                    "errorType": CompilationErrorType.COMPILATION_ERROR,
                    "relativeFilePath": relativeFilePathForGraphs,
                    "dataformCoreVersion": coreVersion,
                    "recompiling": false,
                    "dryRunning": false,
                    "isHelperFile": false,
                    "propertyGraphs": null,
                    "models": null,
                    "declarations": null,
                    "tableOrViewQuery": null,
                    "projectConfig": null,
                    "packageJsonContent": null,
                    "compiledQuerySchema": null,
                    "workspaceFolder": workspaceFolder,
                });
                return;
            }
        }

        const isJs = curFileMeta && curFileMeta.pathMeta && curFileMeta.pathMeta.extension === "js";
        
        const schemaFetch = updateSchemaAutoCompletions(curFileMeta);

        if((curFileMeta.errors?.fileNotFoundError === true || curFileMeta.fileMetadata?.tables.length === 0 ) && isJs){
            if(CompiledQueryPanel && CompiledQueryPanel.centerPanel){
                if(CACHED_COMPILED_DATAFORM_JSON){
                    if (CACHED_COMPILED_DATAFORM_JSON?.declarations) { 
                        const filteredDeclarations = CACHED_COMPILED_DATAFORM_JSON.declarations
                            .filter((declaration) => declaration.fileName === curFileMeta.pathMeta?.relativeFilePath);

                        if (filteredDeclarations.length > 0) {
                            if(diagnosticCollection){
                                diagnosticCollection.clear();
                            }
                            await this.postMessage({
                                "declarations": filteredDeclarations,
                                "propertyGraphs": null,
                                "recompiling": false,
                                "errorType": null,
                                "errorMessage": null,
                                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                                "isHelperFile": false,
                                "workspaceFolder": workspaceFolder,
                            });
                            return;
                        }
                    }
                    
                    // If it's a JS file but has no tables and no declarations, it's a helper file
                    await this.postMessage({
                        "isHelperFile": true,
                        "propertyGraphs": null,
                        "recompiling": false,
                        "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                        "errorType": null,
                        "errorMessage": null,
                        "declarations": null,
                        "tableOrViewQuery": null,
                        "assertionQuery": null,
                        "preOperations": null,
                        "postOperations": null,
                        "incrementalPreOpsQuery": null,
                        "incrementalQuery": null,
                        "nonIncrementalQuery": null,
                        "operationsQuery": null,
                        "workspaceFolder": workspaceFolder,
                    });
                    return;
                }
            }
        }


        const fm = curFileMeta.fileMetadata;
        if (!fm) {
            await this.postMessage({
                "errorMessage": `Unable to retrieve metadata for this file. Please check if it's a valid Dataform file and ensure the project compiles correctly.`,
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(fm);
        let targetTablesOrViews = fm.tables;
        this.deferral = curFileMeta.deferral;

        await this.postMessage({
            "deferral": toDeferralView(curFileMeta.deferral, curFileMeta.deferralError),
            "deferToProd": getDeferToProdState(workspaceFolder),
            "leftoverProxies": curFileMeta.leftoverProxies ?? null,
            "tableOrViewQuery": fileMetadata.queryMeta.tableQueries?.map((t: any) => t.query).join("\n"),
            "assertionQuery": fileMetadata.queryMeta.assertionQuery,
            "preOperations": fileMetadata.queryMeta.preOpsQuery,
            "postOperations": fileMetadata.queryMeta.postOpsQuery,
            "incrementalPreOpsQuery": fileMetadata.queryMeta.incrementalPreOpsQuery,
            "incrementalQuery": fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.incrementalQuery).join("\n"),
            "nonIncrementalQuery": fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.nonIncrementalQuery).join("\n"),
            "operationsQuery": fileMetadata.queryMeta.operationsQuery,
            "testQuery": fileMetadata.queryMeta.testQuery,
            "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
            "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
            "lineageMetadata": curFileMeta.lineageMetadata,
            "compilationTimeMs": curFileMeta.compilationTimeMs,
            "compiledQuerySchema": compiledQuerySchema,
            "targetTablesOrViews": targetTablesOrViews,
            "dependents": curFileMeta.dependents,
            "dataformTags": dataformTags,
            "modelType": fileMetadata.queryMeta.type,
            "actionTypes": [...new Set((fm.tables || []).map((m: any) => m.type).filter(Boolean))],
            "models": fm.tables,
            "propertyGraphs": null,
            "recompiling": false,
            "dryRunning": true,
            "declarations": null,
            "compilerOptions": compilerOptions,
            "workflowUrls": workflowUrls,
            "lastRun": getLastRunView(),
            "errorType": null,
            "errorMessage": null,
            "dataformCoreVersion": curFileMeta.dataformCoreVersion,
            "packageJsonContent": curFileMeta.packageJsonContent,
            "isHelperFile": false,
            "workspaceFolder": workspaceFolder,
    });

        logger.debug(`Compiled query panel rendered ${curFileMeta.pathMeta?.relativeFilePath}${curFileMeta.deferralPending ? ", waiting for defer to prod" : ""}`);
        if (curFileMeta.deferralPending) {
            // The SQL is on screen; redraw it with the deferral applied, and dry run that, once the lookup finishes
            const resolved = await curFileMeta.deferralPending;
            if (renderId !== this.renderSeq || this.centerPanelDisposed) {
                return; // Another file or compile is being shown by now
            }
            logger.debug(`Defer to prod resolved for ${curFileMeta.pathMeta?.relativeFilePath}, redrawing`);
            return this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, { ...curFileMeta, ...resolved, deferralPending: undefined }, false);
        }

        if (isCompilationStale()) {
            // Dry running outdated SQL would report errors and costs of queries that may no longer exist.
            // The panel is redrawn, with a dry run, once the fresh compilation finishes.
            await this.postMessage({ "dryRunning": false });
            return;
        }

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
        if (!queryAutoCompMeta || !curFileMeta.document || !targetTablesOrViews){
            await this.postMessage({
                "recompiling": false,
                "dryRunning": false,
            });
            return;
        }

        // Filter out test nodes as they don't have a table to check last modified time for
        const tablesForLastModified = targetTablesOrViews.filter(table => table.type !== "test");

        const assertionQueriesMeta: { targetName: string; query: string }[] = curFileMeta.fileMetadata?.queryMeta?.assertionQueries ?? [];
        const tableQueriesMeta: { targetName: string; query: string; preOpsQuery: string }[] = curFileMeta.fileMetadata?.queryMeta?.tableQueries ?? [];
        const incrementalQueriesMeta: { targetName: string; incrementalQuery: string; nonIncrementalQuery: string; preOpsQuery: string; incrementalPreOpsQuery: string }[] = curFileMeta.fileMetadata?.queryMeta?.incrementalQueries ?? [];
        const operationQueriesMeta: { targetName: string; query: string; preOpsQuery: string }[] = curFileMeta.fileMetadata?.queryMeta?.operationQueries ?? [];
        const testQueriesMeta: { name: string; testQuery: string; expectedOutputQuery: string }[] = curFileMeta.fileMetadata?.queryMeta?.testQueries ?? [];

        const [dryRunResults, _modelsLastUpdateTimesMeta] = await Promise.all([
            perfTimed('dryRuns', () => dryRunAndShowDiagnostics(curFileMeta, curFileMeta.document!, diagnosticCollection, false)),
            tablesForLastModified.length > 0 ? perfTimed('lastModified', () => getModelLastModifiedTime(tablesForLastModified.map((table) => table.target))) : Promise.resolve([]),
        ]);
        if (dryRunResults.accessDeniedTargets.length > 0) {
            // Read again so the prod tables we cannot read keep their dev refs, then show and dry run that
            return this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, await getCurrentFileMetadata(false), false);
        }
        const { mainQuery: dryRunResult, nonIncremental: nonIncrementalDryRunResult, incremental: incrementalDryRunResult, assertion: assertionDryRunResult, testQuery: testDryRunResult, expectedOutput: expectedOutputDryRunResult, perAssertionDryRunResults, perTableDryRunResults, perNonIncrementalDryRunResults, perIncrementalDryRunResults, perOperationDryRunResults, perTestDryRunResults, perExpectedOutputDryRunResults } = dryRunResults;
        const modelsLastUpdateTimesMeta: any[] = [];
        let timeIndex = 0;
        const safeModelsLastUpdateTimesMeta = _modelsLastUpdateTimesMeta || [];
        for (const table of targetTablesOrViews) {
            if (table.type !== "test") {
                modelsLastUpdateTimesMeta.push(safeModelsLastUpdateTimesMeta[timeIndex]);
                timeIndex++;
            } else {
                modelsLastUpdateTimesMeta.push(null);
            }
        }


        let currency = "USD" as SupportedCurrency;
        let currencySymbol = "$";

        if(dryRunResult?.statistics?.cost?.currency){
            currency = dryRunResult?.statistics?.cost?.currency as SupportedCurrency;
            currencySymbol = currencySymbolMapping[currency];
        }

        const formatCost = (result: BigQueryDryRunResponse | undefined, type: string) => formatDryRunCostSummary(result, type, currencySymbol);

        const isJsFile = fileMetadata.queryMeta.type === "js";

        const nodeType = fileMetadata.queryMeta.type;
        const hasTableOrViewNodes = fileMetadata.tables.some((t: any) => t.type === "table" || t.type === "view");
        const hasOperationsNodes = fileMetadata.tables.some((t: any) => t.type === "operations");
        const dryRunStatByNodeType: Record<string, string> = {};
        if (nodeType === "table" || nodeType === "view" || (isJsFile && hasTableOrViewNodes)) {
            const cost = formatCost(dryRunResult, "");
            if (cost) { dryRunStatByNodeType["table"] = cost; dryRunStatByNodeType["view"] = cost; }
        }
        if (nodeType === "operations" || (isJsFile && hasOperationsNodes && !hasTableOrViewNodes)) {
            const cost = formatCost(dryRunResult, "");
            if (cost) { dryRunStatByNodeType["operations"] = cost; }
        }
        const hasIncrementalNodes = fileMetadata.tables.some((t: any) => t.type === "incremental");
        if (nodeType === "incremental" || (isJsFile && hasIncrementalNodes)) {
            const parts = [formatCost(nonIncrementalDryRunResult, ""), formatCost(incrementalDryRunResult, "Incremental")].filter(Boolean);
            if (parts.length) { dryRunStatByNodeType["incremental"] = parts.join("<br>"); }
        }
        { const cost = formatCost(assertionDryRunResult, ""); if (cost) { dryRunStatByNodeType["assertion"] = cost; } }
        const dryRunStatByNodeName: Record<string, string> = {};
        (perAssertionDryRunResults ?? []).forEach((result: BigQueryDryRunResponse, i: number) => {
            const cost = formatCost(result, "");
            if (cost && assertionQueriesMeta[i]) {
                dryRunStatByNodeName[assertionQueriesMeta[i].targetName] = cost;
            }
        });
        (perTableDryRunResults ?? []).forEach((result: BigQueryDryRunResponse, i: number) => {
            const cost = formatCost(result, "");
            if (cost && tableQueriesMeta[i]) {
                dryRunStatByNodeName[tableQueriesMeta[i].targetName] = cost;
            }
        });
        (perNonIncrementalDryRunResults ?? []).forEach((nonIncResult: BigQueryDryRunResponse, i: number) => {
            const incResult = (perIncrementalDryRunResults ?? [])[i];
            const nonIncCost = formatCost(nonIncResult, "Non incremental");
            const incCost = formatCost(incResult, "Incremental");
            const parts = [nonIncCost, incCost].filter(Boolean);
            if (parts.length > 0 && incrementalQueriesMeta[i]) {
                dryRunStatByNodeName[incrementalQueriesMeta[i].targetName] = parts.join("<br>");
            }
        });
        (perOperationDryRunResults ?? []).forEach((result: BigQueryDryRunResponse, i: number) => {
            const cost = formatCost(result, "");
            if (cost && operationQueriesMeta[i]) {
                dryRunStatByNodeName[operationQueriesMeta[i].targetName] = cost;
            }
        });
        {
            const testCost = formatCost(testDryRunResult, "Input");
            const expectedCost = formatCost(expectedOutputDryRunResult, "Expected");
            const parts = [testCost, expectedCost].filter(Boolean);
            if (parts.length) { dryRunStatByNodeType["test"] = parts.join("<br>"); }
        }
        (perTestDryRunResults ?? []).forEach((result: BigQueryDryRunResponse, i: number) => {
            const inputCost = formatCost(result, "Input");
            const expectedCost = formatCost(perExpectedOutputDryRunResults?.[i], "Expected");
            const parts = [inputCost, expectedCost].filter(Boolean);
            const combined = parts.join("<br>");
            if (combined && testQueriesMeta[i]) {
                dryRunStatByNodeName[testQueriesMeta[i].name] = combined;
            }
        });


        // Build aggregate (node-type-keyed) error maps as fallback for single-node files
        const dryRunErrorsByNodeType: Record<string, DryRunAnnotation> = {};
        const dryRunIncrementalErrorsByNodeType: Record<string, DryRunAnnotation> = {};
        const dryRunExpectedOutputErrorsByNodeType: Record<string, DryRunAnnotation> = {};

        if ((nodeType === "table" || nodeType === "view" || (isJsFile && hasTableOrViewNodes)) && dryRunResult?.error?.hasError) {
            dryRunErrorsByNodeType["table"] = { message: dryRunResult.error.message, location: dryRunResult.error.location };
            dryRunErrorsByNodeType["view"] = { message: dryRunResult.error.message, location: dryRunResult.error.location };
        }
        if ((nodeType === "operations" || (isJsFile && hasOperationsNodes && !hasTableOrViewNodes)) && dryRunResult?.error?.hasError) {
            dryRunErrorsByNodeType["operations"] = { message: dryRunResult.error.message, location: dryRunResult.error.location };
        }
        if (nodeType === "incremental" || (isJsFile && hasIncrementalNodes)) {
            if (incrementalDryRunResult?.error?.hasError) {
                dryRunIncrementalErrorsByNodeType["incremental"] = { message: incrementalDryRunResult.error.message, location: incrementalDryRunResult.error.location };
            }
            if (nonIncrementalDryRunResult?.error?.hasError) {
                dryRunErrorsByNodeType["incremental"] = { message: nonIncrementalDryRunResult.error.message, location: nonIncrementalDryRunResult.error.location };
            }
        }
        if (assertionDryRunResult?.error?.hasError && !(perAssertionDryRunResults?.length)) {
            dryRunErrorsByNodeType["assertion"] = { message: assertionDryRunResult.error.message, location: assertionDryRunResult.error.location };
        }
        if (testDryRunResult?.error?.hasError && !(perTestDryRunResults?.length)) {
            dryRunErrorsByNodeType["test"] = { message: testDryRunResult.error.message, location: testDryRunResult.error.location };
        }
        if (expectedOutputDryRunResult?.error?.hasError) {
            dryRunExpectedOutputErrorsByNodeType["test"] = { message: expectedOutputDryRunResult.error.message, location: expectedOutputDryRunResult.error.location };
        }

        // Per-node maps are derived from the enriched query arrays (set by dryRunOrchestrator)
        const { dryRunErrorsByNodeName, dryRunIncrementalErrorsByNodeName, dryRunExpectedOutputErrorsByNodeName, dryRunQueryByNodeName, dryRunIncrementalQueryByNodeName, dryRunNonIncrementalQueryByNodeName } = deriveNodeMapsFromQueryMeta(fileMetadata.queryMeta);

        // errorMessage is now null for dry-run errors; BigQuery client auth errors arrive via a separate path
        const errorMessage = null;
        const location = dryRunResult?.location?.toLowerCase();

        if (compiledQuerySchema?.fields) {
            const curFileActionDescriptor: ActionDescription | undefined = curFileMeta.fileMetadata?.tables[0]?.actionDescriptor;
            // Keep the nested structure (and mode) so the webview can render RECORD fields as a tree.
            compiledQuerySchema = {
                fields: applyColumnDescriptions(compiledQuerySchema.fields, curFileActionDescriptor?.columns ?? []),
            };
        } else {
            compiledQuerySchema = {fields: [{"name": "", type:""}]};
        }

        // The dependency schemas of this file, not of the one shown before
        await schemaFetch.catch(() => undefined);
        // Hover matches on a column's own name, so flatten nested fields at every depth.
        columnHoverDescription = {
            fields: flattenSchemaFields(compiledQuerySchema?.fields || []),
        };

        schemaAutoCompletions.forEach((column: { name: string; metadata: any }) => {
                columnHoverDescription?.fields.push({
                    name: column.name,
                    type: column.metadata.type,
                    description: column.metadata.description,
                });
        });

        dataformTags = queryAutoCompMeta.dataformTags;
        if(showCompiledQueryInVerticalSplitOnSave || forceShowInVeritcalSplit){
            await this.postMessage({
                "deferral": toDeferralView(curFileMeta.deferral, curFileMeta.deferralError),
                "deferToProd": getDeferToProdState(workspaceFolder),
            "leftoverProxies": curFileMeta.leftoverProxies ?? null,
                "tableOrViewQuery": fileMetadata.queryMeta.tableQueries?.map((t: any) => t.query).join("\n"),
                "assertionQuery": fileMetadata.queryMeta.assertionQuery,
                "preOperations": fileMetadata.queryMeta.preOpsQuery,
                "postOperations": fileMetadata.queryMeta.postOpsQuery,
                "incrementalPreOpsQuery": fileMetadata.queryMeta.incrementalPreOpsQuery,
                "incrementalQuery": fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.incrementalQuery).join("\n"),
                "nonIncrementalQuery": fileMetadata.queryMeta.incrementalQueries?.map((q: any) => q.nonIncrementalQuery).join("\n"),
                "operationsQuery": fileMetadata.queryMeta.operationsQuery,
                "testQuery": fileMetadata.queryMeta.testQuery,
                "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                "lineageMetadata": curFileMeta.lineageMetadata,
                "compilationTimeMs": curFileMeta.compilationTimeMs,
                "errorMessage": errorMessage,
                "dryRunStatByNodeType": dryRunStatByNodeType,
                "dryRunStatByNodeName": dryRunStatByNodeName,
                "dryRunErrorsByNodeType": dryRunErrorsByNodeType,
                "dryRunErrorsByNodeName": dryRunErrorsByNodeName,
                "dryRunIncrementalErrorsByNodeName": dryRunIncrementalErrorsByNodeName,
                "dryRunIncrementalErrorsByNodeType": dryRunIncrementalErrorsByNodeType,
                "dryRunExpectedOutputErrorsByNodeName": dryRunExpectedOutputErrorsByNodeName,
                "dryRunExpectedOutputErrorsByNodeType": dryRunExpectedOutputErrorsByNodeType,
                "dryRunQueryByNodeName": dryRunQueryByNodeName,
                "dryRunIncrementalQueryByNodeName": dryRunIncrementalQueryByNodeName,
                "dryRunNonIncrementalQueryByNodeName": dryRunNonIncrementalQueryByNodeName,
                "testDryRunResult": testDryRunResult,
                "expectedOutputDryRunResult": expectedOutputDryRunResult,
                "currencySymbol": currencySymbol,
                "compiledQuerySchema": compiledQuerySchema,
                "targetTablesOrViews": targetTablesOrViews,
                "models": curFileMeta.fileMetadata?.tables,
                "dependents": curFileMeta.dependents,
                "dataformTags": dataformTags,
                "modelType": fileMetadata.queryMeta.type,
                "actionTypes": [...new Set((curFileMeta.fileMetadata?.tables || []).map((m: any) => m.type).filter(Boolean))],
                "snoozeEndTime": snoozeManager.getSnoozeEndTime(),
                "modelsLastUpdateTimesMeta": modelsLastUpdateTimesMeta,
                "recompiling": false,
                "dryRunning": false,
                "declarations": null,
                "compilerOptions": compilerOptions,
                "workflowUrls": workflowUrls,
                "lastRun": getLastRunView(),
                "errorType": null,
                "projectConfig": curFileMeta.projectConfig,
                "dataformCoreVersion": curFileMeta.dataformCoreVersion,
                "packageJsonContent": curFileMeta.packageJsonContent,
                "isHelperFile": false
            });
            this._cachedResults = {
                fileMetadata,
                curFileMeta,
                targetTablesOrViews,
                errorMessage,
                dryRunStatByNodeType,
                dryRunStatByNodeName,
                dryRunErrorsByNodeType,
                dryRunIncrementalErrorsByNodeType,
                dryRunExpectedOutputErrorsByNodeType,
                location,
                compilerOptions
            };
            declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;
            return webview;
        }
    }

    /**
     * Sends the "Run changed" state. Without `allowCompile` it only diffs against an already compiled base,
     * which keeps the button's count current after every compile without compiling the base unprompted.
     */
    public async refreshFromCache(currentFileMetadata: CurrentFileMetadata | undefined) {
        const showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('showCompiledQueryInVerticalSplitOnSave');
        await this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, true, currentFileMetadata, false);
    }

    public async postChangedActions(allowCompile: boolean) {
        if (this.centerPanelDisposed || (!allowCompile && !CACHED_COMPILED_DATAFORM_JSON)) {
            return; // Nothing compiled yet, e.g. not a Dataform workspace, which the compile has already reported
        }
        if (allowCompile) {
            await this.postMessage({ changedActions: { status: 'computing' } });
        }
        const changedActions = await getChangedActionsView(await getWorkspaceFolder(), allowCompile);
        await this.postMessage({ changedActions });
    }

    private apiRunGitStateRequest = 0;

    /** Sends what a Dataform API run would leave out: uncommitted and unpushed changes to the project. */
    public async postApiRunGitState() {
        if (this.centerPanelDisposed) {
            return;
        }
        // Read the resolved folder directly: resolving it here could prompt or warn on every git change
        const folder = globalThis.workspaceFolder;
        if (!folder) {
            return;
        }
        const request = ++this.apiRunGitStateRequest;
        if (apiRunGitStateCache?.folder !== folder || apiRunGitStateCache.generation !== apiRunGitStateGeneration) {
            const cache = { folder, generation: apiRunGitStateGeneration, state: computeApiRunGitState(folder) };
            apiRunGitStateCache = cache;
            cache.state.catch(() => {
                if (apiRunGitStateCache === cache) {
                    apiRunGitStateCache = undefined; // Try again next time
                }
            });
        }
        const apiRunGitState = await apiRunGitStateCache.state;
        // A slower earlier request must not overwrite a newer answer
        if (request === this.apiRunGitStateRequest) {
            await this.postMessage({ apiRunGitState });
        }
    }

    private async updateView(forceShowInVeritcalSplit:boolean, currentFileMetadata:any, freshCompilation: boolean = true) {
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        let webview = await this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata, freshCompilation);
        this.postChangedActions(false).catch((error) => logger.error(`Failed to refresh changed actions: ${error}`));
        this.postApiRunGitState().catch((error) => logger.error(`Failed to refresh the API run git state: ${error}`));
        if(webview){
            // this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        } else {
            // console.log(`Dont show webview`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, initialState: any = {}) {
        if (initialState.snoozeEndTime === undefined) {
            initialState.snoozeEndTime = snoozeManager.getSnoozeEndTime();
        }
        if (initialState.compilationBackend === undefined) {
            initialState.compilationBackend = isRemoteMode() ? "api" : "cli";
        }
        if (initialState.lastRun === undefined) {
            initialState.lastRun = getLastRunView();
        }
        if (initialState.compilationInfo === undefined) {
            initialState.compilationInfo = getCompilationInfo();
        }
        const scriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "preview_compiled.js"));
        const styleUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "preview_compiled.css"));
        const nonce = getNonce();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
            <link href="${styleUri}" rel="stylesheet">
            <title>Dataform Tools</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}">
                window.initialState = ${JSON.stringify(initialState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
            </script>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }



}
