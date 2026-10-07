import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import { compileNumber, compiledGraph, compiledJson, currentDataformRoot, dataformBackend, requiredTools } from '../project';
import type { BigQuerySlice, DataformBlock, DryRunKey, FileProblem, FileSlice, HostEvent, HostMessage, PanelMessage } from '../shared/panelContract';
import { CompileState, bigQuerySlice, compileStatusSlice, fileSlice, projectSlice } from '../panel/slices';
import { SliceSender } from '../panel/sliceSender';
import { toDryRunResult } from '../bigquery/dryRunService';
import { ActionId, dryRunScripts, slashPath, targetId } from '../shared/compiledGraph';
import { fileModels } from '../shared/panelFileView';
import type { PanelSlices } from '../shared/panelState';
import { applyDeferralToAction } from '../defer/deferRules';
import type { Tool } from '../project/tools';
import * as vscode from 'vscode';
import { snoozeManager, compiledQueryWtDryRun, dryRunAndShowDiagnostics, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getNonce, getTableSchema, getWorkspaceFolder, handleSemicolonPrePostOps, selectWorkspaceFolder, openFileOnLeftEditorPane, findModelFromTarget, getPostionOfSourceDeclaration, showLoadingProgress, executableIsAvailable, readDataformCoreVersion, getRelativePath, isCompilationStale, ensureFreshCompilation, setOnStartupCompileSettled } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";
import { runActions } from "../runActions";
import { previewAction } from "../previewQueryResults";
import { runMultipleTagsFromSelection, runTagWtApi } from "../runTag";
import { runTests } from "../runTests";
import { ActionDescription, CurrentFileMetadata, SupportedCurrency, WorkflowUrlEntry, ActionCounts, WorkflowAction, SchemaMetadata, CachedResults } from "../types";
import { currencySymbolMapping } from "../constants";
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
import { setOnRemoteCompileCompleted } from '../utils/remoteCompiler';
import { buildLastRunView, getLastRun, onDidChangeLastRun } from '../lastRun';
import { getChangedActionsView, runChangedActions, toChangedActionsView } from '../changedActions';
import { watchGitHead, watchGitState } from '../gitHeadWatcher';
import { computeApiRunGitState } from '../apiRunGitState';
import type { ApiRunGitState } from '../shared/apiRunGitState';
import { getDeferToProdState, onDeferralUpdated, toDeferralView } from '../defer';
import { changedColumnCount, onDidRecordDryRunSchema } from '../columnLineage/impactReport';
import { isRemoteMode, resolveDataformOptions, setCompilationMode } from '../project/dataformOptions';

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
async function validatePropertyGraphs(send: (validations: PropertyGraphValidation[]) => void, propertyGraphs: PropertyGraph[]) {
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

    send(validations);
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
/** Whether the git extension will report a change to this file, see `watchGitState` */
let gitStateIsWatchedFor: (filePath: string) => boolean = () => false;
/** How long a save waits for the git extension to report the change before reporting it itself */
const GIT_EVENT_GRACE_MS = 3000;
let saveFallbackTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A save changes the uncommitted files, and so does the git extension's report of that same save. Counting both made
 * the state be computed twice whenever they landed more than the refresh debounce apart. So a save in a repository
 * the git extension watches gives it a moment to report first, and only speaks up itself when it does not: the git
 * extension stops refreshing while its window is unfocused or with `git.autorefresh` off. Without the git
 * extension, or outside its repositories, the save is the only signal there is.
 */
function apiRunGitStateChangedBySave(filePath: string) {
    if (!gitStateIsWatchedFor(filePath)) {
        apiRunGitStateChanged();
        return;
    }
    clearTimeout(saveFallbackTimer);
    saveFallbackTimer = setTimeout(() => {
        saveFallbackTimer = undefined;
        apiRunGitStateChanged();
    }, GIT_EVENT_GRACE_MS);
}

function apiRunGitStateChanged() {
    apiRunGitStateGeneration++;
    refreshApiRunGitStateSoon();
}

function getLastRunView() {
    return buildLastRunView(getLastRun(), isRemoteMode(), globalThis.compilerOptionsMap);
}

/** The latest dry run per file, so only its "N changed" hint is shown */
const impactHintSeq = new Map<string, number>();

export function registerCompiledQueryPanel(context: ExtensionContext) {

    context.subscriptions.push(
        onDidChangeLastRun(() => {
            CompiledQueryPanel.centerPanel?.updateDataformBlock({ lastRun: getLastRunView() });
        }),
        onDeferralUpdated(() => {
            const panel = CompiledQueryPanel.centerPanel;
            panel?.updateDataformBlock({ deferral: toDeferralView(panel.deferral) });
        }),
        onDidRecordDryRunSchema(async ({ document, relativeFilePath, fields }) => {
            if (!CompiledQueryPanel.centerPanel || !relativeFilePath) {
                return;
            }
            // A count for an older dry run that resolves late mustn't overwrite the newer one's
            const seq = (impactHintSeq.get(relativeFilePath) ?? 0) + 1;
            impactHintSeq.set(relativeFilePath, seq);
            const post = (changed: number | undefined) => {
                if (impactHintSeq.get(relativeFilePath) === seq) {
                    CompiledQueryPanel.centerPanel?.updateDataformBlock({ columnImpact: { file: relativeFilePath, changed } });
                }
            };
            if (!fields) {
                post(undefined);
                return;
            }
            try {
                post(await changedColumnCount(document, fields));
            } catch (error: any) {
                // Not a single-table file, not compiled yet, or no known prod table: no hint
                logger.debug(`Column impact hint: ${error?.message ?? error}`);
                post(undefined);
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
                CompiledQueryPanel.centerPanel.updateDataformBlock({ workflowUrls });
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
            // The snooze manager only ever says when the pause ends
            if (CompiledQueryPanel.centerPanel?.webviewPanel) {
                CompiledQueryPanel.centerPanel.updateDataformBlock({ snoozeEndTime: msg.snoozeEndTime ?? null });
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
                CompiledQueryPanel?.centerPanel?.sendCompileStatus({ compiling: { showingPrevious: false, startedAt: Date.now(), file: slashPath(getRelativePath(document.fileName)) } });
                CompiledQueryPanel?.centerPanel?.updateDataformBlock({ compilationMode: isRemoteMode() ? "api" : "cli", dataformCoreVersion: dataformCoreVersion ?? undefined });
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
        CompiledQueryPanel?.centerPanel?.updateDataformBlock({ compilationInfo: info });
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
        apiRunGitStateChangedBySave(document.uri.fsPath);

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
        CompiledQueryPanel.centerPanel?.updateDataformBlock({ changedActions: { status: 'idle' } });
        if (snoozeManager.isSnoozeActive()) {
            snoozeManager.markDirtyDuringSnooze();
            return;
        }
        await triggerCompilationForDocument(doc);
    });

    // Edits, commits, pushes and fetches change what a Dataform API run leaves out
    gitStateIsWatchedFor = watchGitState(context, () => {
        // This is the save's own change arriving through the git extension: the save need not report it as well
        clearTimeout(saveFallbackTimer);
        saveFallbackTimer = undefined;
        apiRunGitStateChanged();
    });
    context.subscriptions.push({ dispose: () => clearTimeout(saveFallbackTimer) });
}


const panelMessagePosted = new vscode.EventEmitter<unknown>();
/** Every message the compiled query panel is sent. For the recorded panel output tests, see src/panelRecordings */
export const onDidPostPanelMessage = panelMessagePosted.event;

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
    public postMessage(message: HostMessage | HostEvent): Thenable<boolean> {
        if (this.centerPanelDisposed) {
            return Promise.resolve(false);
        }
        panelMessagePosted.fire(message);
        return this.webviewPanel.webview.postMessage(message);
    }

    /**
     * Sends the slices both Backends have, each only when it differs from what the panel was last sent: a save does
     * not send the Project again, and a dry-run result does not send the SQL again. The `dataform` block is not
     * sent through it: the panel acts on some of its fields arriving, changed or not (see `updateDataformBlock`).
     */
    private readonly slices = new SliceSender((message) => this.postMessage(message));

    /**
     * Has the next send of each slice go out whatever was sent before. For the recorded panel output, which reads
     * each file as a panel that starts with it would.
     */
    public forgetSentSlices() {
        this.slices.reset();
    }

    /** Tells the panel of something that happened once, see `HostEvent` */
    public sendEvent(event: HostEvent) {
        this.postMessage(event);
    }

    /** What only a Dataform Project has, as the panel was last told */
    public dataformBlock: DataformBlock = {
        compile: 0, compilerOptions: '', compilationMode: 'cli', snoozeEndTime: null, deferral: null, leftoverProxies: null,
        lastRun: null, propertyGraphs: null, propertyGraphValidations: null, propertyGraphElementSchemas: {},
    };

    /**
     * Tells the panel how the Project's compile stands: one of the seven values of the contract. Called with what is
     * special about the place it is called from; the rest is what the last compile left.
     */
    public sendCompileStatus(state: Partial<CompileState> = {}) {
        const info = getCompilationInfo();
        const compiled = info ? { compiledAt: info.compiledAt, ...(info.durationMs === undefined ? {} : { durationMs: info.durationMs }) } : undefined;
        this.slices.send('compile status', compileStatusSlice({ inProject: true, errors: [], compiled, ...state }, compileNumber()));
    }

    /**
     * Tells the panel which Project the file belongs to: its root and its tags. Not sent for a file in no Project.
     */
    private sendProject() {
        const backend = dataformBackend();
        const root = currentDataformRoot();
        if (backend && root) {
            this.slices.send('project', projectSlice({ root }, backend, compiledGraph(), compileNumber()));
        }
    }

    /**
     * Tells the panel what the file on show defines: its actions, each with its SQL and its neighbours.
     *
     * @param file Relative to the Project root
     * @param shown `deferral`: the SQL is sent after defer's rewrite, as it is dry-run. `registered`: actions shown
     * with the file though the graph gives them another, see `fileSlice`. `role`: what the render found the file to
     * be, where that is not for the graph to say; no action is sent then.
     */
    private sendFileSlice(file: string | undefined, shown: { deferral?: CurrentFileMetadata['deferral']; registered?: ActionId[]; role?: 'project settings' | 'helper' } = {}): FileSlice | undefined {
        const backend = dataformBackend();
        if (!backend || !file) {
            this.sendNoActions(file);
            return undefined;
        }
        const relativePath = slashPath(file);
        let graph = compiledGraph();
        const entries = shown.deferral?.entries ?? [];
        if (graph && entries.length > 0) {
            const rewritten = [...(graph.files[relativePath] ?? []), ...(shown.registered ?? [])]
                .filter((id) => graph!.actions[id])
                .map((id) => [id, applyDeferralToAction(graph!.actions[id], entries)]);
            graph = { ...graph, actions: { ...graph.actions, ...Object.fromEntries(rewritten) } };
        }
        let value = fileSlice(graph, backend, relativePath, compileNumber(), shown.registered);
        if (shown.role) {
            value = { ...value, role: shown.role, actions: [] };
        }
        this.slices.send('file', value);
        return value;
    }

    /**
     * Tells the panel that there is nothing of the file to show.
     *
     * @param problem What is wrong with the file. Left out when the reason is the compile's, which the compile status
     * sent before this has given: the file is in no Project, the tool was not found, or the compile left errors
     */
    private sendNoActions(file?: string, problem?: FileProblem) {
        this.slices.send('file', { compile: compileNumber(), file: file ? slashPath(file) : '', role: 'not compiled', actions: [], ...(problem ? { problem } : {}) });
        // And BigQuery has said nothing of it
        this.sendBigQuery({ results: [], tables: {}, dryRunning: [] });
    }

    /** What BigQuery has said of the file on show, as last sent */
    private bigQuery: Omit<BigQuerySlice, 'compile'> = { results: [], dryRunning: [], tables: {}, currencySymbol: '$' };

    /**
     * Changes what BigQuery has said of the file on show and sends the `bigquery` slice.
     */
    public sendBigQuery(fields: Partial<Omit<BigQuerySlice, 'compile'>>) {
        this.bigQuery = { ...this.bigQuery, ...fields };
        this.slices.send('bigquery', bigQuerySlice(this.bigQuery, compileNumber()));
    }

    /**
     * Changes fields of the `dataform` block and sends the block, saying which fields this send is about (`touched`
     * in the contract). It is sent every time, changed or not: the panel acts on some of these fields arriving.
     */
    public updateDataformBlock(fields: Partial<Omit<DataformBlock, 'compile'>>) {
        this.dataformBlock = { ...this.dataformBlock, ...fields, compile: compileNumber() };
        const message: HostMessage = { slice: 'dataform', value: this.dataformBlock, touched: Object.keys(fields) as Array<Exclude<keyof DataformBlock, 'compile'>> };
        this.postMessage(message);
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
          async (message: PanelMessage) => {
            switch (message.command) {
              case 'dataform.startSnooze':
                await vscode.commands.executeCommand('vscode-dataform-tools.snoozeCompilation');
                return;
              case 'dataform.stopSnooze':
                await vscode.commands.executeCommand('vscode-dataform-tools.stopSnoozeCompilation');
                return;
              case 'openAction':
                const { database: projectId, schema: datasetId, name: tableId } = message.action;

                if(!compiledJson()){
                    // this should never happen as the view exposing the dependents can only be created when compilation is done;
                    vscode.window.showWarningMessage(`compile Dataform project before navigating to dependencies & dependents`);
                }

                let tables = compiledJson()?.tables;
                let operations = compiledJson()?.operations;
                let assertions = compiledJson()?.assertions;
                let declarations = compiledJson()?.declarations;

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
                const textToCopy = message.text;
                await vscode.env.clipboard.writeText(textToCopy);
                vscode.window.showInformationMessage('Schema copied to clipboard!');
                return;
              case 'exportSchema':
                const schemaData = message.content;
                const defaultFilename = message.fileName || 'schema.json';
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
              case 'dataform.exportTagCostCsv':
                const csvData = message.content;
                const defaultCsvFilename = message.fileName || 'cost_estimate.csv';
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
              case 'selectProject':
                await selectWorkspaceFolder();
                vscode.commands.executeCommand("vscode-dataform-tools.showCompiledQueryInWebView");
                return;
              case 'dataform.updateCompilerOptions': {
                const compilerOptions = message.compilerOptions;
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
              case 'showDependencyGraph':
                await vscode.commands.executeCommand("vscode-dataform-tools.dependencyGraphPanel");
                return;
              case 'dataform.showDependencyInspector':
                await vscode.commands.executeCommand("vscode-dataform-tools.dependencyInspector");
                return;
              case 'dataform.showColumnLineage':
                await vscode.commands.executeCommand("vscode-dataform-tools.columnLineage");
                return;
              case 'preview':
                await previewAction(message.action, message.section, message.alone);
                return;
              case 'dataform.compileRemotely':
                await vscode.commands.executeCommand('vscode-dataform-tools.compileRemotely');
                return;
              case 'dataform.deferToProdActions':
                await vscode.commands.executeCommand('vscode-dataform-tools.deferToProdActions');
                return;
              case 'dataform.removeProxyViews':
                await vscode.commands.executeCommand('vscode-dataform-tools.removeProxyViews', message.targets);
                await refreshCompiledQueryPanel();
                return;
              case 'dataform.toggleDeferToProd':
                await vscode.commands.executeCommand('vscode-dataform-tools.toggleDeferToProd', message.on);
                return;
              case 'dataform.openDeferToProdSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-dataform-tools.prodCompilerOptions');
                return;
              case 'dataform.retryDeferral':
                try {
                  await vscode.commands.executeCommand('vscode-dataform-tools.refreshDeferToProd');
                } catch (error: any) {
                  // The banner waits for a new deferral after Retry, so without one it would stay on "looking up"
                  logger.error(`Defer to prod: retry failed: ${error?.message}`);
                  panel.updateDataformBlock({ deferral: toDeferralView(undefined, `Retry failed: ${error?.message ?? error}`) });
                }
                return;
              case 'showLogs':
                logger.show();
                return;
              case 'dataform.switchCompilationMode': {
                try {
                  await setCompilationMode(message.compilationMode === 'api' ? 'api' : 'cli');
                  await recompileActiveDocument?.();
                } catch (error: any) {
                  vscode.window.showErrorMessage(`Unable to switch the compilation mode: ${error.message}`);
                }
                return;
              }
              case 'dataform.runTests': {
                await runTests(currentDataformRoot());
                return;
              }
              case 'run':
                await runActions(extensionContext, message.actions.map(targetId), message, "cli");
                return;
              case 'runTags': {
                const tagsWorkspaceFolder = await getWorkspaceFolder();
                if (!tagsWorkspaceFolder || message.tags.length === 0) { return; }
                await runMultipleTagsFromSelection(tagsWorkspaceFolder, message.tags, message.includeDependencies, message.includeDependents, message.fullRefresh);
                return;
              }
              case 'dataform.runApi':
                if (!(await runActions(extensionContext, message.actions.map(targetId), message, message.workspace ? "api_workspace" : "api"))) {
                    return;
                }
                const updatedWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                this.centerPanel?.updateDataformBlock({ workflowUrls: updatedWorkflowUrls });
                return;
              case 'dataform.runTagsApi': {
                const tagsToRun: string[] = Array.isArray(message.tags)
                    ? message.tags.filter((t: unknown): t is string => typeof t === 'string' && t.trim() !== '')
                    : [];
                if (tagsToRun.length === 0) { return; }
                const includeDependencies = !!message.includeDependencies;
                const includeDependents = !!message.includeDependents;
                const fullRefresh = !!message.fullRefresh;
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
              case 'dataform.estimateTagCost': {

                const selectedTags: string[] = message.tags;
                const includeDependenciesCost = message.includeDependencies;
                const includeDependentsCost = message.includeDependents;
                const costWorkspaceFolder = await getWorkspaceFolder();
                if (costWorkspaceFolder) {
                    await ensureFreshCompilation(costWorkspaceFolder, resolveDataformOptions(costWorkspaceFolder));
                }
                const compiledForCost = compiledJson(costWorkspaceFolder);
                if(compiledForCost){
                    logger.debug('Using cached compilation for tag cost estimation');
                    const tagDryRunStatsMeta = await costEstimator(compiledForCost, selectedTags, includeDependenciesCost, includeDependentsCost);
                    let currency = "USD" as SupportedCurrency;
                    let currencySymbol = "$";
                    if(tagDryRunStatsMeta?.tagDryRunStatsList){
                        currency = tagDryRunStatsMeta?.tagDryRunStatsList[0].currency;
                        currencySymbol = currencySymbolMapping[currency];
                    }
                    this.centerPanel?.sendBigQuery({ currencySymbol });
                    this.centerPanel?.updateDataformBlock({ tagCostEstimate: tagDryRunStatsMeta && { rows: tagDryRunStatsMeta.tagDryRunStatsList, error: tagDryRunStatsMeta.error, tags: selectedTags } });
                }else{
                    vscode.window.showErrorMessage("No cached data to estimate cost from");
                }
                return;
              }
              case 'formatFile':
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
              case 'lintFile':
                await vscode.commands.executeCommand('vscode-dataform-tools.lintCurrentFile');
                return;
              case 'dataform.loadLineage': {
                const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                const locationLineage = this.centerPanel?._cachedResults?.location ||
                    curFileMeta?.projectConfig?.defaultLocation ||
                    compiledJson()?.projectConfig?.defaultLocation;

                if (!locationLineage) {
                    vscode.window.showErrorMessage("Location for lineage metadata not found. Please set 'defaultLocation' in your Dataform configuration.");
                    return;
                }

                const lineageMetadata = await getLiniageMetadata(fileMetadata?.tables?.[0]?.target, locationLineage);

                this.centerPanel?.updateDataformBlock({ lineage: lineageMetadata });
                return;
              }
              case 'dataform.loadWorkflowUrls':
                const currentWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                this.centerPanel?.updateDataformBlock({ workflowUrls: currentWorkflowUrls });
                return;
              case 'dataform.clearWorkflowUrls':
                await this.centerPanel?.extensionContext.workspaceState.update('dataform_workflow_urls', []);
                this.centerPanel?.updateDataformBlock({ workflowUrls: [] });
                return;
              case 'dataform.cancelWorkflowInvocation':
                if (message.workflowInvocationId && this.centerPanel) {
                    const cancelled = await cancelWorkflowInvocation(this.centerPanel.extensionContext, message.workflowInvocationId);
                    if (!cancelled) {
                        this.centerPanel?.sendEvent({ event: 'workflow cancel failed', workflowInvocationId: message.workflowInvocationId });
                    }
                }
                return;
              case 'dataform.loadWorkflowJobStats':
              case 'dataform.exportWorkflowActionsCsv':
              case 'dataform.openExecutedSql':
              case 'dataform.openBigQueryJob': {
                const context = this.centerPanel?.extensionContext;
                const storedUrls = context?.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                const entry = storedUrls.find((item) => item.workflowInvocationId === message.workflowInvocationId);
                if (!context || !entry) {
                    return;
                }
                if (message.command === 'dataform.openExecutedSql') {
                    await openExecutedSql(entry, message.action);
                } else if (message.command === 'dataform.exportWorkflowActionsCsv') {
                    await exportWorkflowActionsCsv(entry);
                } else if (message.command === 'dataform.openBigQueryJob') {
                    const jobAction = message.action;
                    const action = entry.actions?.find((a) => a.target === jobAction);
                    if (action) {
                        openBigQueryJobInConsole(entry, action);
                    }
                } else if (await loadJobStatsForInvocation(entry)) {
                    await context.workspaceState.update('dataform_workflow_urls', storedUrls);
                    this.centerPanel?.updateDataformBlock({ workflowUrls: storedUrls });
                }
                return;
              }
              case 'repeatLastRun': {
                const previousTimestamp = getLastRun()?.timestamp;
                await vscode.commands.executeCommand('vscode-dataform-tools.rerunLastExecution');
                // Every runner records the run just before dispatching it, so an unchanged timestamp means
                // the rerun was cancelled or failed its checks and the webview should stop showing progress.
                if (getLastRun()?.timestamp === previousTimestamp) {
                  this.centerPanel?.sendEvent({ event: 'rerun aborted' });
                }
                return;
              }
              case 'dataform.computeChangedActions':
                await this.centerPanel?.postChangedActions(true);
                return;
              case 'dataform.runChangedActions': {
                const _workspaceFolder = await getWorkspaceFolder();
                if (!_workspaceFolder) { return; }
                const result = await runChangedActions(
                    extensionContext,
                    _workspaceFolder,
                    !!message.includeDependencies,
                    !!message.includeDependents,
                    !!message.fullRefresh,
                    message.api ? 'api' : 'cli',
                    Array.isArray(message.files) ? message.files : undefined,
                );
                if (result) {
                    this.centerPanel?.updateDataformBlock({ changedActions: toChangedActionsView(result) });
                }
                return;
              }
              case 'dataform.runWithOptions':
                await vscode.commands.executeCommand(message.workspace ? 'vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace' : 'vscode-dataform-tools.runFilesTagsWtOptionsApi');
                return;
              case 'dataform.refreshWorkflowStatuses':
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
                    this.centerPanel?.updateDataformBlock({ workflowUrls: updatedUrls });
                }
                return;
              case 'dataform.loadPropertyGraphElementSchema': {
                const { elementName, table: target } = message;
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
                if (this.centerPanel) {
                    const known = this.centerPanel.dataformBlock.propertyGraphElementSchemas;
                    this.centerPanel.updateDataformBlock({ propertyGraphElementSchemas: { ...known, [elementSchema.elementName]: elementSchema } });
                }
                return;
              }
              case 'dataform.runGeneratedQuery':
                await vscode.commands.executeCommand(
                    'vscode-dataform-tools.runGeneratedQuery',
                    message.query,
                    message.kind ?? "table",
                );
                return;
              case 'openExternal':
                if(message.url){
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                return;
              case 'dbt.setTarget':
              case 'dbt.compileWithHooks':
              case 'dbt.chooseExecutable':
              case 'dbt.lookForDbtAgain':
                // A dbt Project's panel sends these; it has none until Step 5
                return;
              default: {
                // Every message of the contract has a case above: this line fails the type-check when one is added without
                const unhandled: never = message;
                logger.error(`Unhandled message from the compiled query panel: ${JSON.stringify(unhandled)}`);
              }
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

        const workspaceFolder = await getWorkspaceFolder();
        let dataformCoreVersion = undefined;
        if (workspaceFolder) {
            dataformCoreVersion = await readDataformCoreVersion(workspaceFolder);
        }

        // Only the Backend's own tool gates the panel. Signing in to Google Cloud is not checked: a BigQuery call says so
        const missingExecutables: string[] = requiredTools('dataform', { compilationMode: isRemoteMode() ? 'api' : 'cli' })
            .filter((executable) => !executableIsAvailable(executable, false, workspaceFolder));

        // Setting html on a panel closed during the awaits above would throw
        if (this.centerPanelDisposed) {
            return;
        }

        if (missingExecutables.length > 0) {
            if(this.webviewPanel.webview.html === ""){
                this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { compiling: false, missingTool: missingExecutables[0] as Tool, compilerOptions, dataformCoreVersion });
            } else {
                this.sendCompileStatus({ missingTool: { tool: missingExecutables[0] as Tool, lookedIn: [] } });
                this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath);
                this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            }
            return;
        }

        if(this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { compiling: freshCompilation, compilerOptions, dataformCoreVersion });
        }

        // Every render that gets this far sends these, as the payloads of a compiled file used to
        this.updateDataformBlock({
            workflowUrls: this.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [],
            lastRun: getLastRunView(),
        });

        // Notify webview that we are starting compilation
        if (freshCompilation) {
            const compilingFor = curFileMeta?.pathMeta?.relativeFilePath;
            this.sendCompileStatus({ compiling: { showingPrevious: false, startedAt: Date.now(), ...(compilingFor ? { file: slashPath(compilingFor) } : {}) } });
            this.sendProject();
            this.updateDataformBlock({ compilerOptions: compilerOptions ?? '', compilationMode: isRemoteMode() ? "api" : "cli", dataformCoreVersion: dataformCoreVersion ?? undefined });
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(freshCompilation, { deferralInBackground: true });
        }

        if(!curFileMeta){
            this.sendCompileStatus();
            this.sendNoActions(undefined, { kind: 'unsupported file type', message: `File type not supported. Supported file types are sqlx, js` });
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            return;
        }


        if (curFileMeta.isDataformWorkspace===false){
            this.sendCompileStatus({ inProject: false });
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath);
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            return;
        } else if (curFileMeta?.errors?.errorGettingFileNameFromDocument){
            this.sendCompileStatus();
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, { kind: 'other', message: curFileMeta?.errors?.errorGettingFileNameFromDocument });
            this.sendProject();
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
        } else if ((curFileMeta?.errors?.fileNotFoundError===true || curFileMeta?.fileMetadata?.tables?.length === 0) && curFileMeta?.pathMeta?.relativeFilePath && curFileMeta?.pathMeta?.extension === "sqlx"){
            this.sendCompileStatus();
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, { kind: 'no action' });
            this.sendProject();
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            return;
        } else if (curFileMeta?.errors?.queryMetaError){
            this.sendCompileStatus();
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, { kind: 'no sql', message: curFileMeta.errors.queryMetaError });
            this.sendProject();
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            return;
        }
        if(curFileMeta.errors?.dataformCompilationErrors){
            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                this.sendCompileStatus();
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

            this.sendCompileStatus({
                errors: curFileMeta.errors.dataformCompilationErrors.map((compilationError: { error: string; fileName: string; stack?: string }) => {
                    const { lineNumber, sourceContext } = parseCompilationStack(compilationError.stack);
                    return { message: compilationError.error, fileName: compilationError.fileName, line: lineNumber, sourceContext };
                }),
            });
            // The compile status has named the errors; with none to name, the file still has nothing to show
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, curFileMeta.errors.dataformCompilationErrors.length === 0 ? { kind: 'other' } : undefined);
            this.sendProject();
            this.updateDataformBlock({ possibleResolutions: curFileMeta.possibleResolutions ?? [], projectConfig: undefined, packageJson: undefined });
            return;
        }

        const isConfigFile = curFileMeta.pathMeta && (
            curFileMeta.pathMeta.filename === 'workflow_settings' || 
            curFileMeta.pathMeta.filename === 'dataform' || 
            (curFileMeta.pathMeta.filename === 'package' && curFileMeta.pathMeta.extension === 'json')
        );

        if (isConfigFile) {
            this.sendCompileStatus();
            // package.json is shown as the settings files are
            this.sendFileSlice(curFileMeta.pathMeta?.relativeFilePath, { role: 'project settings' });
            this.sendProject();
            this.updateDataformBlock({ dataformCoreVersion: curFileMeta.dataformCoreVersion ?? undefined });
            this.updateDataformBlock({ projectConfig: curFileMeta.projectConfig ?? undefined, packageJson: curFileMeta.packageJsonContent ?? undefined });
            return;
        }
        // PropertyGraph actions live in yaml files that produce no queries, so they never
        // reach the table/assertion/operation pipeline below and would otherwise render as
        // an empty panel.
        const relativeFilePathForGraphs = curFileMeta.pathMeta?.relativeFilePath;
        if (isPropertyGraphCandidateFile(relativeFilePathForGraphs)) {
            const propertyGraphs = getPropertyGraphsForFile(relativeFilePathForGraphs, compiledJson());

            if (propertyGraphs.length > 0) {
                if (diagnosticCollection) {
                    diagnosticCollection.clear();
                }
                this.sendCompileStatus();
                this.sendFileSlice(relativeFilePathForGraphs);
                this.sendProject();
                // The validation of a graph is a dry run of the statement that would create it
                this.sendBigQuery({ results: [], tables: {}, dryRunning: propertyGraphs.map((graph) => ({ action: targetId(graph.target), script: 'validation', incremental: false })) });
                this.updateDataformBlock({ propertyGraphs, propertyGraphValidations: null });
                this.updateDataformBlock({ compilerOptions: compilerOptions ?? '', dataformCoreVersion: curFileMeta.dataformCoreVersion ?? undefined });
                this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });

                if (isCompilationStale()) {
                    this.sendBigQuery({ dryRunning: [] });
                    return;
                }
                // Validation is a network round trip; do not hold up the render for it.
                validatePropertyGraphs((validations) => {
                    this.updateDataformBlock({ propertyGraphValidations: validations });
                    this.sendBigQuery({ dryRunning: [] });
                }, propertyGraphs).catch((error) => {
                    logger.error(`Error validating property graphs: ${error}`);
                    // The render above said a dry run is out; without this the webview spins forever.
                    this.sendBigQuery({ dryRunning: [] });
                });
                return;
            }

            const coreVersion = curFileMeta.dataformCoreVersion ?? compiledJson()?.dataformCoreVersion;
            if (!isCoreVersionAtLeast(coreVersion, PROPERTY_GRAPHS_MIN_CORE_VERSION)) {
                this.sendCompileStatus();
                this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, { kind: 'other', message: `Property graphs require @dataform/core ${PROPERTY_GRAPHS_MIN_CORE_VERSION} or later. This project is on ${coreVersion}, so the compiled output contains no propertyGraphs for this file.` });
                this.sendProject();
                this.sendBigQuery({ dryRunning: [] });
                this.updateDataformBlock({ propertyGraphs: null });
                this.updateDataformBlock({ dataformCoreVersion: coreVersion ?? undefined });
                this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
                return;
            }
        }

        const isJs = curFileMeta && curFileMeta.pathMeta && curFileMeta.pathMeta.extension === "js";
        
        const schemaFetch = updateSchemaAutoCompletions(curFileMeta);

        if((curFileMeta.errors?.fileNotFoundError === true || curFileMeta.fileMetadata?.tables.length === 0 ) && isJs){
            if(CompiledQueryPanel && CompiledQueryPanel.centerPanel){
                const compiled = compiledJson();
                if(compiled){
                    if (compiled.declarations) { 
                        const filteredDeclarations = compiled.declarations
                            .filter((declaration) => declaration.fileName === curFileMeta.pathMeta?.relativeFilePath);

                        if (filteredDeclarations.length > 0) {
                            if(diagnosticCollection){
                                diagnosticCollection.clear();
                            }
                            this.sendCompileStatus();
                            this.sendFileSlice(curFileMeta.pathMeta?.relativeFilePath);
                            this.sendProject();
                            this.updateDataformBlock({ propertyGraphs: null });
                            return;
                        }
                    }
                    
                    // If it's a JS file but has no tables and no declarations, it's a helper file
                    this.sendCompileStatus();
                    this.sendFileSlice(curFileMeta.pathMeta?.relativeFilePath, { role: 'helper' });
                    this.sendProject();
                    this.updateDataformBlock({ propertyGraphs: null });
                    return;
                }
            }
        }


        const fm = curFileMeta.fileMetadata;
        if (!fm) {
            this.sendCompileStatus();
            this.sendNoActions(curFileMeta?.pathMeta?.relativeFilePath, { kind: 'other', message: `Unable to retrieve metadata for this file. Please check if it's a valid Dataform file and ensure the project compiles correctly.` });
            this.sendProject();
            this.updateDataformBlock({ projectConfig: undefined, packageJson: undefined });
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(fm);
        let targetTablesOrViews = fm.tables;
        this.deferral = curFileMeta.deferral;

        this.sendCompileStatus();
        // A notebook belongs to its own file in the graph; the JavaScript file that registers it shows it
        const registered = fm.tables.filter((table) => table.type === "notebook" && table.target).map((table) => targetId(table.target));
        const shownFile = this.sendFileSlice(curFileMeta.pathMeta?.relativeFilePath, { deferral: curFileMeta.deferral, registered });
        // The panel lists the actions in the slice's order, and matches the last-modified times to them by position
        const shown = shownFile ? fileModels(shownFile) : [];
        this.sendProject();
        this.updateDataformBlock({ lineage: curFileMeta.lineageMetadata ?? null });
        // The dry runs that are now out: every script of every action shown. Their results are for this compile
        const dryRunCompile = compileNumber();
        const graph = compiledGraph();
        const dryRunning: DryRunKey[] = (shownFile?.actions ?? []).flatMap(({ id }) =>
            (graph?.actions[id] ? dryRunScripts(graph.actions[id]) : []).map((script) => ({ action: id, script: script.name, incremental: script.incremental })));
        this.sendBigQuery({ results: [], tables: {}, dryRunning });
        this.updateDataformBlock({ deferral: toDeferralView(curFileMeta.deferral, curFileMeta.deferralError), deferToProd: getDeferToProdState(workspaceFolder), leftoverProxies: curFileMeta.leftoverProxies ?? null, propertyGraphs: null });
        this.updateDataformBlock({ compilerOptions: compilerOptions ?? '', dataformCoreVersion: curFileMeta.dataformCoreVersion ?? undefined });

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
            this.sendBigQuery({ dryRunning: [] });
            return;
        }

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
        if (!queryAutoCompMeta || !curFileMeta.document || !targetTablesOrViews){
            this.sendCompileStatus();
            this.sendBigQuery({ dryRunning: [] });
            return;
        }

        // Filter out test nodes as they don't have a table to check last modified time for
        const tablesForLastModified = shown.filter(({ model }) => model.type !== "test" && model.target);


        const [dryRunResults, _modelsLastUpdateTimesMeta] = await Promise.all([
            perfTimed('dryRuns', () => dryRunAndShowDiagnostics(curFileMeta, curFileMeta.document!, diagnosticCollection, false)),
            tablesForLastModified.length > 0 ? perfTimed('lastModified', () => getModelLastModifiedTime(tablesForLastModified.map(({ model }) => model.target!))) : Promise.resolve([]),
        ]);
        if (dryRunResults.accessDeniedTargets.length > 0) {
            // Read again so the prod tables we cannot read keep their dev refs, then show and dry run that
            return this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, await getCurrentFileMetadata(false), false);
        }
        const { mainQuery: dryRunResult } = dryRunResults;
        // What BigQuery knows of each table, by its action. Nothing is known when there is no BigQuery client
        const tables: BigQuerySlice['tables'] = {};
        (_modelsLastUpdateTimesMeta ?? []).forEach((meta, index) => {
            const table = tablesForLastModified[index];
            if (meta && table) {
                tables[table.action.id] = { lastModified: meta.lastModifiedTime, modifiedToday: meta.modelWasUpdatedToday, error: meta.error?.message };
            }
        });


        let currency = "USD" as SupportedCurrency;
        let currencySymbol = "$";

        if(dryRunResult?.statistics?.cost?.currency){
            currency = dryRunResult?.statistics?.cost?.currency as SupportedCurrency;
            currencySymbol = currencySymbolMapping[currency];
        }

        this.updateDataformBlock({ packageJson: curFileMeta.packageJsonContent ?? undefined });

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
            this.sendCompileStatus();
            this.sendProject();
            this.updateDataformBlock({ lineage: curFileMeta.lineageMetadata ?? null });
            this.sendBigQuery({ results: dryRunResults.dryRuns.map(({ action, script, response }) => toDryRunResult(action, script, dryRunCompile, response)), dryRunning: [], tables, currencySymbol });
            this.updateDataformBlock({ deferral: toDeferralView(curFileMeta.deferral, curFileMeta.deferralError), deferToProd: getDeferToProdState(workspaceFolder), leftoverProxies: curFileMeta.leftoverProxies ?? null });
            this.updateDataformBlock({ compilerOptions: compilerOptions ?? '', dataformCoreVersion: curFileMeta.dataformCoreVersion ?? undefined });
            this.updateDataformBlock({ snoozeEndTime: snoozeManager.getSnoozeEndTime(), projectConfig: curFileMeta.projectConfig ?? undefined, packageJson: curFileMeta.packageJsonContent ?? undefined });
            this._cachedResults = {
                fileMetadata,
                curFileMeta,
                targetTablesOrViews,
                errorMessage,
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
        if (this.centerPanelDisposed || (!allowCompile && !compiledJson())) {
            return; // Nothing compiled yet, e.g. not a Dataform workspace, which the compile has already reported
        }
        if (allowCompile) {
            this.updateDataformBlock({ changedActions: { status: 'computing' } });
        }
        const changedActions = await getChangedActionsView(await getWorkspaceFolder(), allowCompile);
        this.updateDataformBlock({ changedActions });
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
            this.updateDataformBlock({ apiRunGitState });
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

    /**
     * The panel's page. It is given the slices the panel starts with, so that its first paint is right before any
     * message: the `dataform` block and how the compile stands.
     */
    private _getHtmlForWebview(webview: vscode.Webview, first: { compiling: boolean; missingTool?: Tool; compilerOptions?: string; dataformCoreVersion?: string | null }) {
        const compilationInfo = getCompilationInfo();
        this.dataformBlock = {
            ...this.dataformBlock,
            compilerOptions: first.compilerOptions ?? '',
            compilationMode: isRemoteMode() ? "api" : "cli",
            dataformCoreVersion: first.dataformCoreVersion ?? undefined,
            snoozeEndTime: snoozeManager.getSnoozeEndTime() ?? null,
            lastRun: getLastRunView() ?? null,
            compilationInfo: compilationInfo ?? undefined,
        };
        const compile = compileStatusSlice({
            inProject: true,
            errors: [],
            ...(first.missingTool ? { missingTool: { tool: first.missingTool, lookedIn: [] } } : {}),
            ...(first.compiling ? { compiling: { showingPrevious: false, startedAt: Date.now() } } : {}),
            ...(compilationInfo ? { compiled: { compiledAt: compilationInfo.compiledAt } } : {}),
        }, compileNumber());
        const initialState: Partial<PanelSlices> = { dataform: this.dataformBlock, compile };
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
