import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { getNonce, getWorkspaceFolder, openFileOnLeftEditorPane } from '../utils';
import { TraceController } from '../shared/columnLineage/traceController';
import { SAMPLE_FOCUS, SampleTraceSource, resolveSampleFile } from '../shared/columnLineage/sampleSource';
import { HostToViewMessage, ImpactView, TraceFocus, TraceSource, ViewToHostMessage } from '../shared/columnLineage/types';
import { DataplexTraceSource } from '../columnLineage/dataplexSource';
import { ImpactAnalysis, toImpactEntries } from '../columnLineage/impactReport';

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
        <title>Column trace</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
}

/** One trace panel, reused for each column traced. In impact mode it also lists the columns changed against prod. */
export class ColumnLineagePanel {
    private static current: ColumnLineagePanel | undefined;

    private controller: TraceController | undefined;
    private resolveFile: (table: string) => string | undefined = () => undefined;
    private ready = false;
    private pendingFocus: TraceFocus | undefined;

    private impact: ImpactView | null = null;
    private runImpact: (() => Promise<ImpactAnalysis>) | undefined;
    private analysis: ImpactAnalysis | undefined;
    /** Bumped per impact check, so a slow check doesn't overwrite a newer one */
    private impactRun = 0;

    private constructor(private readonly panel: vscode.WebviewPanel) {
        panel.webview.onDidReceiveMessage((message: ViewToHostMessage) => this.handle(message));
        panel.onDidDispose(() => {
            if (ColumnLineagePanel.current === this) {
                ColumnLineagePanel.current = undefined;
            }
        });
    }

    private static open(context: vscode.ExtensionContext, title: string): ColumnLineagePanel {
        const existing = ColumnLineagePanel.current;
        if (existing) {
            existing.panel.title = title;
            existing.panel.reveal(vscode.ViewColumn.Beside);
            return existing;
        }
        const panel = vscode.window.createWebviewPanel(
            'dataformColumnTrace',
            title,
            vscode.ViewColumn.Beside,
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

    /** Traces `focus`, by default the made-up sample project */
    static show(
        context: vscode.ExtensionContext,
        focus: TraceFocus = SAMPLE_FOCUS,
        source: TraceSource = new SampleTraceSource(),
        resolveFile: (table: string) => string | undefined = resolveSampleFile,
    ) {
        const panel = ColumnLineagePanel.open(context, `Trace: ${focus.column}`);
        panel.runImpact = undefined;
        panel.setImpact(null);
        panel.trace(focus, source, resolveFile);
    }

    /** Runs a column impact check and shows its changed columns, tracing the first one with readers */
    static showImpact(context: vscode.ExtensionContext, run: () => Promise<ImpactAnalysis>) {
        const panel = ColumnLineagePanel.open(context, 'Column impact');
        panel.runImpact = run;
        void panel.checkImpact();
    }

    private post(message: HostToViewMessage) {
        if (this.ready) {
            void this.panel.webview.postMessage(message);
        }
    }

    private setImpact(impact: ImpactView | null) {
        this.impact = impact;
        this.post({ type: 'impact', impact });
    }

    private async checkImpact() {
        if (!this.runImpact) {
            return;
        }
        const run = ++this.impactRun;
        this.controller = undefined;
        this.pendingFocus = undefined;
        this.post({ type: 'trace', state: null });
        this.setImpact({ status: 'loading', entries: [] });
        try {
            const analysis = await this.runImpact();
            if (run !== this.impactRun) {
                return;
            }
            this.analysis = analysis;
            const entries = toImpactEntries(analysis);
            const first = entries.find((entry) => entry.copies + entry.derived + entry.mayRead > 0) ?? entries[0];
            this.setImpact({ status: 'ready', table: analysis.table, entries, message: analysis.note, checkedAt: Date.now() });
            if (first) {
                this.selectImpact(first.column);
            }
        } catch (error: any) {
            if (run === this.impactRun) {
                this.setImpact({ status: 'error', entries: [], message: error?.message ?? String(error), checkedAt: Date.now() });
            }
        }
    }

    private selectImpact(column: string) {
        const entry = this.impact?.entries.find((candidate) => candidate.column === column);
        if (!entry || !this.analysis || !this.impact) {
            return;
        }
        this.setImpact({ ...this.impact, selected: column });
        const source = new DataplexTraceSource(this.analysis.schemas, this.analysis.index);
        this.trace({ table: this.analysis.table, column, change: entry.change }, source, source.resolveFile);
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

    private async handle(message: ViewToHostMessage) {
        switch (message.type) {
            case 'webviewReady': {
                this.ready = true;
                this.post({ type: 'impact', impact: this.impact });
                const state = this.controller?.current;
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
                await this.controller?.expand(message.nodeId);
                break;
            case 'setUpstream':
                await this.controller?.setUpstream(message.on);
                break;
            case 'refresh':
                await this.controller?.refresh();
                break;
            case 'openFile':
                await this.openFile(message.nodeId);
                break;
            case 'selectImpact':
                this.selectImpact(message.column);
                break;
            case 'recheckImpact':
                await this.checkImpact();
                break;
        }
    }

    private async openFile(nodeId: string) {
        const node = this.controller?.current?.nodes.find((candidate) => candidate.id === nodeId);
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
