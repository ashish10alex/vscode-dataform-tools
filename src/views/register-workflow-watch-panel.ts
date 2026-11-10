import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { getNonce } from '../utils';
import type { PanelMessage, WatchHostMessage, WatchPanelMessage } from '../shared/panelContract';
import type { WorkflowUrlEntry } from '../types';
import { exportWorkflowActionsCsv, openBigQueryJobInConsole, openExecutedSql } from '../workflowJobTelemetry';
import { WorkflowWatcher } from '../workflowWatch/watchWorkflow';

/*
 * The Dataform Workflow view at the bottom: paste a workflow the extension did not start and see what each of its
 * actions' BigQuery jobs cost, followed until the workflow ends.
 */

export const WATCH_VIEW_ID = 'workflowWatchView';
const WATCH_COMMAND = 'vscode-dataform-tools.watchWorkflow';
/**
 * The view's tab is there once a workflow has been watched in the workspace, and stays. Shown from the start, a panel
 * tab of its own took the focus from the editor as VS Code started, with the first keys typed.
 */
const SHOWN_CONTEXT = 'vscode-dataform-tools.workflowWatchShown';
const SHOWN_KEY = 'dataform_workflow_watch_shown';

const PROMPT = 'Paste the ID of a workflow, or the URL of its page in the Cloud console. It is added to the run history as external, '
    + 'with what each action\'s BigQuery job cost; if it is still running, it is followed until it ends. It is never cancelled.';

export class WorkflowWatchViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(private readonly extensionUri: vscode.Uri, private readonly watcher: WorkflowWatcher, private readonly context: vscode.ExtensionContext) {
        watcher.onDidChange(() => this.post());
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [Uri.joinPath(this.extensionUri, 'dist')],
        };
        webviewView.webview.html = this.html(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) { this.post(); }
        });
        webviewView.onDidDispose(() => { this.view = undefined; });
        webviewView.webview.onDidReceiveMessage((message: WatchPanelMessage | PanelMessage) => this.onMessage(message));
    }

    /** Shows the view, asks for a workflow and watches it */
    async promptAndWatch(): Promise<void> {
        const input = await vscode.window.showInputBox({
            title: 'Watch a workflow by ID or URL',
            prompt: PROMPT,
            placeHolder: '1700000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            ignoreFocusOut: true,
        });
        if (!input?.trim()) { return; }
        await this.reveal();
        await this.watcher.watch(input);
    }

    private async reveal(): Promise<void> {
        if (!this.context.workspaceState.get<boolean>(SHOWN_KEY)) {
            await this.context.workspaceState.update(SHOWN_KEY, true);
        }
        await vscode.commands.executeCommand('setContext', SHOWN_CONTEXT, true);
        await vscode.commands.executeCommand(`${WATCH_VIEW_ID}.focus`);
    }

    private post(): void {
        const message: WatchHostMessage = { type: 'watchState', view: this.watcher.state };
        this.view?.webview.postMessage(message);
    }

    private async onMessage(message: WatchPanelMessage | PanelMessage): Promise<void> {
        switch (message.command) {
            case 'watch.ready':
                this.post();
                return;
            case 'reloadPage':
                // After an error while it drew: the page loads again and asks for the state with watch.ready
                if (this.view) { this.view.webview.html = this.html(this.view.webview); }
                return;
            case 'watch.submit':
                await this.watcher.watch(message.input);
                return;
            case 'watch.stop':
                this.watcher.stop();
                return;
            case 'watch.openInConsole': {
                const url = this.watcher.state.entry?.url;
                if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
                return;
            }
            case 'dataform.openBigQueryJob':
            case 'dataform.openExecutedSql':
            case 'dataform.exportWorkflowActionsCsv': {
                const entry = this.entryOf(message.workflowInvocationId);
                if (!entry) { return; }
                if (message.command === 'dataform.exportWorkflowActionsCsv') {
                    await exportWorkflowActionsCsv(entry);
                } else if (message.command === 'dataform.openExecutedSql') {
                    await openExecutedSql(entry, message.action);
                } else {
                    const action = entry.actions?.find((a) => a.target === message.action && (!message.jobId || a.jobId === message.jobId));
                    if (action) { openBigQueryJobInConsole(entry, action); }
                }
                return;
            }
        }
    }

    /** The watched entry, which the view shows, or the one of the history with that ID */
    private entryOf(workflowInvocationId: string): WorkflowUrlEntry | undefined {
        const watched = this.watcher.state.entry;
        if (watched?.workflowInvocationId === workflowInvocationId) { return watched; }
        return (this.context.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [])
            .find((item) => item.workflowInvocationId === workflowInvocationId);
    }

    private html(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(Uri.joinPath(this.extensionUri, 'dist', 'workflow_watch.js'));
        const styleUri = webview.asWebviewUri(Uri.joinPath(this.extensionUri, 'dist', 'workflow_watch.css'));
        const nonce = getNonce();
        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
          <link href="${styleUri}" rel="stylesheet">
          <title>Dataform Workflow</title>
      </head>
      <body>
          <div id="root"></div>
          <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
    }
}

export function registerWorkflowWatchPanel(context: vscode.ExtensionContext): void {
    if (context.workspaceState.get<boolean>(SHOWN_KEY)) {
        void vscode.commands.executeCommand('setContext', SHOWN_CONTEXT, true);
    }
    const watcher = new WorkflowWatcher(context);
    const provider = new WorkflowWatchViewProvider(context.extensionUri, watcher, context);
    context.subscriptions.push(
        watcher,
        vscode.window.registerWebviewViewProvider(WATCH_VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.commands.registerCommand(WATCH_COMMAND, () => provider.promptAndWatch()),
    );
}
