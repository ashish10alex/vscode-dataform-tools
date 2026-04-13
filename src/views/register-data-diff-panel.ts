import * as vscode from 'vscode';
import { getNonce } from '../utils';
import { logger } from '../logger';

import { GitService } from '../gitClient';
import { orchestrateDataDiff, previewDiffModels } from '../utils/dataDiffOrchestrator';

export class DataDiffPanel {
    public static currentPanel: DataDiffPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set the webview's initial html content
        this._update();
        
        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'webviewReady': {
                        try {
                            const gitService = new GitService();
                            const branchInfo = gitService.getGitBranchAndRepoName();
                            const allBranches = await gitService.getAllBranches();
                            const compilerOptions = vscode.workspace.getConfiguration('vscode-dataform-tools').get<string>('compilerOptions') || '';
                            const tablePrefixOpt = compilerOptions.split(' ').find(opt => opt.startsWith('--table-prefix'));
                            const tablePrefix = tablePrefixOpt ? (tablePrefixOpt.split('=')[1] || '').replace(/['"]/g, '') : '';
                            this._panel.webview.postMessage({
                                command: 'init',
                                data: {
                                    currentBranch: branchInfo ? branchInfo.gitBranch : "",
                                    branches: allBranches,
                                    tablePrefix,
                                }
                            });
                        } catch(e) {
                            logger.error(`Error initializing Git in webview: ${e}`);
                        }
                        break;
                    }
                    case 'runSingleModelDiff':
                        logger.info(`Running single model diff for: ${message.data.file}`);
                        orchestrateDataDiff(
                            message.data.sourceBranch,
                            message.data.targetBranch,
                            message.data.tablePrefix,
                            { [message.data.file]: message.data.primaryKeys || '' },
                            { [message.data.file]: message.data.targetFilter || '' },
                            { [message.data.file]: message.data.sourceFilter || '' },
                            { [message.data.file]: message.data.excludeColumns || '' },
                            this._panel,
                            [message.data.file]
                        );
                        break;
                    case 'previewAffectedModels':
                        logger.info(`Previewing data diff models for target: ${message.data.targetBranch}`);
                        previewDiffModels(
                            message.data.sourceBranch,
                            message.data.targetBranch,
                            message.data.tablePrefix,
                            this._panel
                        );
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (DataDiffPanel.currentPanel) {
            DataDiffPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'dataDiff',
            'Data Diff',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                    vscode.Uri.joinPath(extensionUri, 'node_modules')
                ],
                retainContextWhenHidden: true
            }
        );

        DataDiffPanel.currentPanel = new DataDiffPanel(panel, extensionUri);
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'data_diff.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'data_diff.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet" />
                <title>Data Diff</title>
            </head>
            <body>
                <div id="root"></div>
                <!-- Define the webview URI mapping for any dynamic assets if needed -->
                <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public dispose() {
        DataDiffPanel.currentPanel = undefined;

        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}
