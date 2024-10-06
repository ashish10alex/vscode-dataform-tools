import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { dryRunAndShowDiagnostics, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getNonce, getVSCodeDocument, handleSemicolonPrePostOps } from "../utils";


export function registerCompiledQueryPanel(context: ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQuery', async() => {
            CompiledQueryPanel.getInstance(context.extensionUri, context, true);
        })
    );

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
            CompiledQueryPanel.getInstance(context.extensionUri, context, false);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
            CompiledQueryPanel.getInstance(context.extensionUri, context, true);
    }));

}


export class CompiledQueryPanel {
    public static centerPanel: CompiledQueryPanel | undefined;
    private centerPanelDisposed: boolean = false;
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext) {
        this.updateView();
    }

    public static getInstance(extensionUri: Uri, extensionContext: ExtensionContext, freshCompilation:boolean) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        if(CompiledQueryPanel.centerPanel && !this.centerPanel?.centerPanelDisposed){
            CompiledQueryPanel.centerPanel.sendUpdateToView(freshCompilation);
        } else {
            const panel = window.createWebviewPanel(
                CompiledQueryPanel.viewType,
                "Compiled query preview",
                // vscode.ViewColumn.Beside,
                { preserveFocus: true, viewColumn: vscode.ViewColumn.Beside },
                {
                    enableFindWidget: true,
                    retainContextWhenHidden: true,
                    enableScripts: true,
                    localResourceRoots: [
                        Uri.joinPath(extensionUri, "media")
                    ],
                }
            );
            CompiledQueryPanel.centerPanel = new CompiledQueryPanel(panel, extensionUri, extensionContext);
        }

        this.centerPanel?.webviewPanel.onDidDispose(() => {
            if(this.centerPanel){
                this.centerPanel.centerPanelDisposed  = true;
            }
        });
    }

    private async sendUpdateToView(freshCompilation:boolean) {
        let curFileMeta = await getCurrentFileMetadata(freshCompilation);
        if (!curFileMeta?.fileMetadata) {
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
        const webview = this.webviewPanel.webview;
        await webview.postMessage({
            "tableOrViewQuery": fileMetadata.queryMeta.tableOrViewQuery,
            "assertionQuery": fileMetadata.queryMeta.assertionQuery,
            "preOperations": fileMetadata.queryMeta.preOpsQuery,
            "postOperations": fileMetadata.queryMeta.postOpsQuery,
            "incrementalPreOpsQuery": fileMetadata.queryMeta.incrementalPreOpsQuery,
            "incrementalQuery": fileMetadata.queryMeta.incrementalQuery,
            "nonIncrementalQuery": fileMetadata.queryMeta.nonIncrementalQuery,
            "operationsQuery": fileMetadata.queryMeta.operationsQuery,
            "relativeFilePath": curFileMeta.pathMeta.relativeFilePath,
        });

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
        if (!queryAutoCompMeta){
            return;
        }
        dryRunAndShowDiagnostics(curFileMeta, queryAutoCompMeta, curFileMeta.document, diagnosticCollection);
        return webview;
    }

    private async updateView() {
        let webview = await this.sendUpdateToView(true);
        if(webview){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const showCompiledQueryUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showCompiledQuery.js"));
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
        const highlightJsCssUri = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css";
        const highlightJsUri = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js";
        const highlightJsCopyExtUri = "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js";
        const highlightJsCopyExtCssUri = "https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css";
        const highlightJsOneDarkThemeUri = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css";
        const highlightJsLineNoExtUri = "https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js";
        const tabulatorCssUri = "https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator.min.css";
        const tabulatorUri = "https://unpkg.com/tabulator-tables@6.2.5/dist/js/tabulator.min.js";
        const nonce = getNonce();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${highlightJsCssUri}">
            <script src="${highlightJsUri}"></script>
            <script src="${highlightJsCopyExtUri}"></script>
            <link rel="stylesheet" href="${highlightJsCopyExtCssUri}" />
            <link rel="stylesheet" href="${highlightJsOneDarkThemeUri}">
            <script src="${highlightJsLineNoExtUri}"></script>

            <link href="${tabulatorCssUri}" rel="stylesheet">
            <script type="text/javascript" src="${tabulatorUri}"></script>

            <link href="${styleResetUri}" rel="stylesheet">
            <style>
        </style>
        </head>

        <body>

        <p><span id="relativeFilePath"></span></p>

        <span class="bigquery-job-cancelled"></span>

        <div id="codeBlock">
            <div id="preOperationsDiv">
                <h4>Pre Operations</h4>
                <pre><code  id="preOperations" class="language-sql"></code></pre>
            </div>

            <div id="postOperationsDiv">
                <h4>Post Operations</h4>
                <pre><code  id="postOperations" class="language-sql"></code></pre>
            </div>

            <div id="tableOrViewQueryDiv">
                <h4>Query</h4>
                <pre><code  id="tableOrViewQuery" class="language-sql"></code></pre>
            </div>
            <div id="assertionQueryDiv">
                <h4>Assertion</h4>
                <pre><code  id="assertionQuery" class="language-sql"></code></pre>
            </div>

            <div id="incrementalPreOpsQueryDiv">
                <h4>Incremental Pre Operations</h4>
                <pre><code  id="incrementalPreOpsQuery" class="language-sql"></code></pre>
            </div>

            <div id="incrementalQueryDiv">
                <h4>Incremental Query</h4>
                <pre><code  id="incrementalQuery" class="language-sql"></code></pre>
            </div>

            <div id="nonIncrementalQueryDiv">
                <h4>Non Incremental Query</h4>
                <pre><code  id="nonIncrementalQuery" class="language-sql"></code></pre>
            </div>

            <div id="operationsQueryDiv">
                <h4>Operations</h4>
                <pre><code  id="operationsQuery" class="language-sql"></code></pre>
            </div>
            <script nonce="${nonce}" type="text/javascript" src="${showCompiledQueryUri}"></script>
        </div>

        </body>
        </html>
        `;
    }

}
