import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { getNonce, getWorkspaceFolder, openFileOnLeftEditorPane } from '../utils';
import { TraceController } from '../shared/columnLineage/traceController';
import { SAMPLE_FOCUS, SampleTraceSource, resolveSampleFile } from '../shared/columnLineage/sampleSource';
import { ColumnsController } from '../shared/columnLineage/columnsController';
import { CachedTraceSource } from '../shared/columnLineage/cachedSource';
import { HostToViewMessage, TraceFocus, TraceSource, ViewToHostMessage } from '../shared/columnLineage/types';
import { DataplexTraceSource } from '../columnLineage/dataplexSource';
import { loadColumns, onDidRecordDryRunSchema } from '../columnLineage/impactReport';

function getHtml(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'column_lineage.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'column_lineage.css'));
    const nonce = getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:;">
        <link href="${styleUri}" rel="stylesheet">
        <title>Column lineage</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
}

/**
 * One panel, reused. For a file it lists the columns of the file's table beside the trace of the selected one,
 * and stays on that file, relabelling the columns after each of its dry runs. It can also show a single trace
 * with no column list.
 */
export class ColumnLineagePanel {
    private static current: ColumnLineagePanel | undefined;

    private controller: TraceController | undefined;
    private columns: ColumnsController | undefined;
    private resolveFile: (table: string) => string | undefined = () => undefined;
    private ready = false;
    private pendingFocus: TraceFocus | undefined;

    /** The file the column list is for */
    private document: vscode.TextDocument | undefined;
    private preferred: string | undefined;
    /** Select `preferred` on the next load even when other columns changed: a recheck keeps the selection */
    private keepPreferred = false;
    /** Bumped per load, so a slow load doesn't overwrite a newer one */
    private loadRun = 0;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(private readonly panel: vscode.WebviewPanel) {
        this.disposables.push(
            panel.webview.onDidReceiveMessage((message: ViewToHostMessage) => this.handle(message)),
            onDidRecordDryRunSchema((event) => {
                if (this.columns && event.document.uri.toString() === this.document?.uri.toString()) {
                    void this.columns.relabel(event.fields);
                }
            }),
        );
        panel.onDidDispose(() => {
            this.disposables.forEach((disposable) => disposable.dispose());
            if (ColumnLineagePanel.current === this) {
                ColumnLineagePanel.current = undefined;
            }
        });
    }

    /** `column`: the editor group a new panel opens in. An open panel stays in its group, wherever the user put it. */
    private static open(context: vscode.ExtensionContext, title: string, column: vscode.ViewColumn = vscode.ViewColumn.Beside): ColumnLineagePanel {
        const existing = ColumnLineagePanel.current;
        if (existing) {
            existing.panel.title = title;
            existing.panel.reveal(existing.panel.viewColumn);
            return existing;
        }
        const panel = vscode.window.createWebviewPanel(
            'dataformColumnTrace',
            title,
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
            },
        );
        panel.webview.html = getHtml(context, panel.webview);
        ColumnLineagePanel.current = new ColumnLineagePanel(panel);
        return ColumnLineagePanel.current;
    }

    /** Traces one column with no column list, by default in the made-up sample project */
    static showTrace(
        context: vscode.ExtensionContext,
        focus: TraceFocus = SAMPLE_FOCUS,
        source: TraceSource = new SampleTraceSource(),
        resolveFile: (table: string) => string | undefined = resolveSampleFile,
    ) {
        const panel = ColumnLineagePanel.open(context, `Trace: ${focus.column}`);
        panel.loadRun++;
        panel.document = undefined;
        panel.columns = undefined;
        panel.post({ type: 'columns', columns: null });
        panel.trace(focus, source, resolveFile);
    }

    /**
     * Lists the columns of the file's table and traces a changed column if there is one, else `preferred` (the
     * column under the cursor) or the top one. On the file the panel is already showing, only the selection moves.
     * `column`: the editor group to open in the first time, e.g. the compiled query panel's.
     */
    static showColumns(context: vscode.ExtensionContext, document: vscode.TextDocument, preferred?: string, column?: vscode.ViewColumn) {
        const title = `Columns: ${path.basename(document.uri.fsPath, path.extname(document.uri.fsPath))}`;
        const panel = ColumnLineagePanel.open(context, title, column);
        const columns = panel.columns;
        if (columns && panel.document?.uri.toString() === document.uri.toString() && columns.columns?.status !== 'error') {
            columns.selectDefault(preferred);
            return;
        }
        panel.document = document;
        panel.preferred = preferred;
        panel.keepPreferred = false;
        void panel.loadColumns();
    }

    private post(message: HostToViewMessage) {
        if (this.ready) {
            void this.panel.webview.postMessage(message);
        }
    }

    private async loadColumns() {
        const document = this.document;
        if (!document) {
            return;
        }
        const run = ++this.loadRun;
        this.controller = undefined;
        this.pendingFocus = undefined;
        const columns: ColumnsController = this.columns ??= new ColumnsController(
            (view) => this.columns === columns && this.post({ type: 'columns', columns: view }),
            (state) => this.columns === columns && this.post({ type: 'trace', state }),
        );
        columns.loading();
        try {
            const loaded = await loadColumns(document);
            if (run !== this.loadRun) {
                return;
            }
            const source = new DataplexTraceSource(loaded.schemas, loaded.index);
            this.resolveFile = source.resolveFile;
            await columns.load(loaded.input, new CachedTraceSource(source), source.resolveFile, this.preferred, this.keepPreferred);
        } catch (error: any) {
            if (run === this.loadRun) {
                columns.fail(error?.message ?? String(error));
            }
        }
    }

    private trace(focus: TraceFocus, source: TraceSource, resolveFile: (table: string) => string | undefined) {
        this.resolveFile = resolveFile;
        this.controller = new TraceController(
            source,
            (state) => this.post({ type: 'trace', state }),
            resolveFile,
        );
        if (!this.ready) {
            this.pendingFocus = focus;
            return;
        }
        void this.controller.open(focus);
    }

    /** The trace on screen: the selected column's when there is a column list */
    private get activeTrace(): TraceController | undefined {
        return this.columns ? this.columns.trace : this.controller;
    }

    private async handle(message: ViewToHostMessage) {
        switch (message.type) {
            case 'webviewReady': {
                this.ready = true;
                this.post({ type: 'columns', columns: this.columns?.columns ?? null });
                const state = this.activeTrace?.current;
                if (this.pendingFocus) {
                    const focus = this.pendingFocus;
                    this.pendingFocus = undefined;
                    await this.controller?.open(focus);
                } else if (state) {
                    // The webview reloaded; send what we have
                    this.post({ type: 'trace', state });
                }
                break;
            }
            case 'expand':
                await this.activeTrace?.expand(message.nodeId);
                break;
            case 'expandLevel':
                await this.activeTrace?.expandLevel(message.direction);
                break;
            case 'setUpstream':
                await (this.columns ? this.columns.setUpstream(message.on) : this.controller?.setUpstream(message.on));
                break;
            case 'refresh':
                await this.activeTrace?.refresh();
                break;
            case 'openFile':
                await this.openFile(message.nodeId);
                break;
            case 'selectColumn':
                this.columns?.select(message.column);
                break;
            case 'recheckColumns':
                this.preferred = this.columns?.columns?.selected ?? this.preferred;
                this.keepPreferred = true;
                await this.loadColumns();
                break;
        }
    }

    private async openFile(nodeId: string) {
        const node = this.activeTrace?.current?.nodes.find((candidate) => candidate.id === nodeId);
        const filePath = node && this.resolveFile(node.table);
        if (!filePath) {
            return;
        }
        const workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder || !fs.existsSync(path.join(workspaceFolder, filePath))) {
            logger.debug(`Column trace: ${filePath} is not in this workspace`);
            vscode.window.showInformationMessage(`${filePath} isn't in this workspace.`);
            return;
        }
        await openFileOnLeftEditorPane(filePath, new vscode.Position(0, 0));
    }
}
