import * as vscode from 'vscode';
import { Uri } from 'vscode';
import { getNonce } from '../utils';
import { cliRunHint } from '../cliRunJobs';
import { backendContext, onDidChangeActiveProject } from '../project';
import { RunsController, cancelRun } from '../runs/runsController';
import type { ApiRunGitState } from '../shared/apiRunGitState';
import type { HostEvent, PanelMessage, RunsHostMessage, RunsPanelMessage, RunsView } from '../shared/panelContract';
import { runKey } from '../shared/runPolling';
import type { WorkflowUrlEntry } from '../types';
import { exportWorkflowActionsCsv, loadJobStatsForInvocation, openBigQueryJobInConsole, openExecutedSql } from '../workflowJobTelemetry';
import { WorkflowWatcher } from '../workflowWatch/watchWorkflow';
import { cachedApiRunGitState, onDidChangeApiRunGitState } from './register-preview-compiled-panel';

/*
 * The Runs view at the bottom: the runs of the workspace on the left, and the jobs of the one chosen on the right,
 * with what each cost. Runs through the Dataform API start here, and a workflow the extension did not start is
 * watched from here.
 */

export const RUNS_VIEW_ID = 'runsView';
const WATCH_COMMAND = 'vscode-dataform-tools.watchWorkflow';
const SHOW_COMMAND = 'vscode-dataform-tools.showRuns';

const PROMPT = 'Paste the ID of a workflow, or the URL of its page in the Cloud console. It is added to the runs as external, '
    + 'with what each action\'s BigQuery job cost; if it is still running, it is followed until it ends. It is never cancelled.';

/** The run that started last */
function newestKey(history: WorkflowUrlEntry[]): string | undefined {
    const newest = history.reduce<WorkflowUrlEntry | undefined>((found, entry) => (!found || entry.timestamp >= found.timestamp ? entry : found), undefined);
    return newest && runKey(newest);
}

export class RunsViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private selected: string | undefined;
    /** The newest run at the last look: a selection on it moves to a newer run as one starts */
    private newest: string | undefined;
    private gitState: ApiRunGitState | undefined;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly watcher: WorkflowWatcher,
        private readonly runs: RunsController,
        private readonly context: vscode.ExtensionContext,
    ) {
        this.follow();
        watcher.onDidChange(() => this.post());
        runs.onDidChange(() => {
            this.follow();
            this.post();
        });
        runs.onDidProgress(() => this.post());
        onDidChangeApiRunGitState(() => this.readGitState());
        onDidChangeActiveProject(() => this.post());
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
        webviewView.webview.onDidReceiveMessage((message: RunsPanelMessage | PanelMessage) => this.onMessage(message));
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
        await this.show();
        await this.watch(input);
    }

    /** Shows the view, at the run with that key where one is given */
    async show(key?: string): Promise<void> {
        if (key && this.runs.history().some((entry) => runKey(entry) === key)) {
            this.selected = key;
        }
        await vscode.commands.executeCommand(`${RUNS_VIEW_ID}.focus`);
        this.post();
    }

    private async watch(input: string): Promise<void> {
        const entry = await this.watcher.watch(input);
        if (entry) {
            this.selected = runKey(entry);
            this.post();
        }
    }

    /** A selection on the newest run moves to a run that starts; one on a run that is gone moves to the newest */
    private follow(): void {
        const history = this.runs.history();
        const newest = newestKey(history);
        if (!this.selected || this.selected === this.newest || !history.some((entry) => runKey(entry) === this.selected)) {
            this.selected = newest;
        }
        this.newest = newest;
    }

    private readGitState(): void {
        if (backendContext().backend === 'dbt') { return; }
        cachedApiRunGitState()?.then((state) => {
            this.gitState = state;
            this.post();
        }, () => undefined);
    }

    private post(): void {
        if (!this.view) { return; }
        const view: RunsView = {
            history: this.runs.history(),
            selected: this.selected,
            progress: this.runs.progress(),
            problems: this.runs.problems(),
            watch: this.watcher.state,
            backend: backendContext().backend,
            apiRunGitState: this.gitState,
            cliRunHint: cliRunHint(),
        };
        const message: RunsHostMessage = { type: 'runsState', view };
        this.view.webview.postMessage(message);
    }

    private async onMessage(message: RunsPanelMessage | PanelMessage): Promise<void> {
        switch (message.command) {
            case 'runs.ready':
                this.post();
                this.readGitState();
                return;
            case 'reloadPage':
                // After an error while it drew: the page loads again and asks for the state with runs.ready
                if (this.view) { this.view.webview.html = this.html(this.view.webview); }
                return;
            case 'runs.select':
                this.selected = message.key;
                this.post();
                return;
            case 'watch.submit':
                await this.watch(message.input);
                return;
            case 'watch.stop':
                await this.watcher.stop(message.workflowInvocationId);
                return;
            case 'dataform.refreshWorkflowStatuses':
                await this.runs.refreshAll();
                return;
            case 'dataform.clearWorkflowUrls':
                await this.runs.clear();
                return;
            case 'dataform.cancelWorkflowInvocation':
                if (!await cancelRun(this.context, message.workflowInvocationId)) {
                    const event: HostEvent = { event: 'workflow cancel failed', workflowInvocationId: message.workflowInvocationId };
                    this.view?.webview.postMessage(event);
                }
                return;
            case 'dataform.runWithOptions':
                await vscode.commands.executeCommand(message.workspace ? 'vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace' : 'vscode-dataform-tools.runFilesTagsWtOptionsApi');
                return;
            case 'openExternal':
                await vscode.env.openExternal(vscode.Uri.parse(message.url));
                return;
            case 'dataform.loadWorkflowJobStats':
            case 'dataform.openBigQueryJob':
            case 'dataform.openExecutedSql':
            case 'dataform.exportWorkflowActionsCsv': {
                const history = this.runs.history();
                const entry = history.find((item) => item.workflowInvocationId === message.workflowInvocationId);
                if (!entry) { return; }
                if (message.command === 'dataform.exportWorkflowActionsCsv') {
                    await exportWorkflowActionsCsv(entry);
                } else if (message.command === 'dataform.openExecutedSql') {
                    await openExecutedSql(entry, message.action);
                } else if (message.command === 'dataform.openBigQueryJob') {
                    // A CLI run has a row for each job, and an action may have several
                    const action = entry.actions?.find((a) => a.target === message.action && (!message.jobId || a.jobId === message.jobId));
                    if (action) { openBigQueryJobInConsole(entry, action); }
                } else if (await loadJobStatsForInvocation(entry)) {
                    await this.runs.save(history);
                }
                return;
            }
        }
    }

    private html(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(Uri.joinPath(this.extensionUri, 'dist', 'runs.js'));
        const styleUri = webview.asWebviewUri(Uri.joinPath(this.extensionUri, 'dist', 'runs.css'));
        const nonce = getNonce();
        return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
          <link href="${styleUri}" rel="stylesheet">
          <title>Runs</title>
      </head>
      <body>
          <div id="root"></div>
          <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
    }
}

export function registerRunsPanel(context: vscode.ExtensionContext, runs: RunsController): void {
    const watcher = new WorkflowWatcher(context);
    const provider = new RunsViewProvider(context.extensionUri, watcher, runs, context);
    context.subscriptions.push(
        watcher,
        vscode.window.registerWebviewViewProvider(RUNS_VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.commands.registerCommand(WATCH_COMMAND, () => provider.promptAndWatch()),
        vscode.commands.registerCommand(SHOW_COMMAND, (key?: unknown) => provider.show(typeof key === 'string' ? key : undefined)),
    );
}
