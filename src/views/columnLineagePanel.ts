import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { getNonce, getWorkspaceFolder, openFileOnLeftEditorPane } from '../utils';
import { TraceController } from '../shared/columnLineage/traceController';
import { SAMPLE_FOCUS, SampleTraceSource, resolveSampleFile } from '../shared/columnLineage/sampleSource';
import { TraceFocus, TraceSource, ViewToHostMessage } from '../shared/columnLineage/types';

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

/** One trace panel, reused for each column traced */
export class ColumnLineagePanel {
    private static current: ColumnLineagePanel | undefined;

    private controller: TraceController | undefined;
    private resolveFile: (table: string) => string | undefined = () => undefined;
    private ready = false;
    private pendingFocus: TraceFocus | undefined;

    private constructor(private readonly panel: vscode.WebviewPanel) {
        panel.webview.onDidReceiveMessage((message: ViewToHostMessage) => this.handle(message));
        panel.onDidDispose(() => {
            if (ColumnLineagePanel.current === this) {
                ColumnLineagePanel.current = undefined;
            }
        });
    }

    /** Traces `focus`, by default the made-up sample project */
    static show(
        context: vscode.ExtensionContext,
        focus: TraceFocus = SAMPLE_FOCUS,
        source: TraceSource = new SampleTraceSource(),
        resolveFile: (table: string) => string | undefined = resolveSampleFile,
    ) {
        const existing = ColumnLineagePanel.current;
        if (existing) {
            existing.panel.reveal(vscode.ViewColumn.Beside);
            existing.trace(focus, source, resolveFile);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'dataformColumnTrace',
            `Trace: ${focus.column}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
            },
        );
        panel.webview.html = getHtml(context, panel.webview);
        const created = new ColumnLineagePanel(panel);
        ColumnLineagePanel.current = created;
        created.trace(focus, source, resolveFile);
    }

    private trace(focus: TraceFocus, source: TraceSource, resolveFile: (table: string) => string | undefined) {
        this.panel.title = `Trace: ${focus.column}`;
        this.resolveFile = resolveFile;
        this.controller = new TraceController(
            source,
            (state) => void this.panel.webview.postMessage({ type: 'trace', state }),
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
                const state = this.controller?.current;
                if (this.pendingFocus) {
                    const focus = this.pendingFocus;
                    this.pendingFocus = undefined;
                    await this.controller?.open(focus);
                } else if (state) {
                    // The webview reloaded; send what we have
                    void this.panel.webview.postMessage({ type: 'trace', state });
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
