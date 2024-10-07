import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { dryRunAndShowDiagnostics, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getHighlightJsThemeUri, getNonce, getVSCodeDocument, handleSemicolonPrePostOps } from "../utils";


export function registerCompiledQueryPanel(context: ExtensionContext) {

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryInWebView', async() => {
            CompiledQueryPanel.getInstance(context.extensionUri, context, true);
        })
    );

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        let useWebViewToShowCompiledQuery = vscode.workspace.getConfiguration('vscode-dataform-tools').get('useWebViewToShowCompiledQuery');
        if (useWebViewToShowCompiledQuery && editor && CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
            CompiledQueryPanel.getInstance(context.extensionUri, context, false);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        let useWebViewToShowCompiledQuery = vscode.workspace.getConfiguration('vscode-dataform-tools').get('useWebViewToShowCompiledQuery');
        if(useWebViewToShowCompiledQuery){
            CompiledQueryPanel.getInstance(context.extensionUri, context, true);
        }
    }));

}


export class CompiledQueryPanel {
    public static centerPanel: CompiledQueryPanel | undefined;
    private centerPanelDisposed: boolean = false;
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext) {
        this.updateView();
    }

    public static async getInstance(extensionUri: Uri, extensionContext: ExtensionContext, freshCompilation:boolean) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        if(CompiledQueryPanel.centerPanel && !this.centerPanel?.centerPanelDisposed){
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave){
                CompiledQueryPanel.centerPanel.webviewPanel.dispose();
                return;
            }
            CompiledQueryPanel.centerPanel.sendUpdateToView(freshCompilation, showCompiledQueryInVerticalSplitOnSave);
        } else {
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave && showCompiledQueryInVerticalSplitOnSave !== undefined){
                let curFileMeta = await getCurrentFileMetadata(freshCompilation);
                if (!curFileMeta?.isDataformWorkspace || !curFileMeta.fileMetadata) {
                    return;
                }

                let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
                if (!queryAutoCompMeta){
                    return;
                }

                dataformTags = queryAutoCompMeta.dataformTags;
                declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

                let launchedFromWebView = true;

                if(diagnosticCollection){
                    diagnosticCollection.clear();
                }
                dryRunAndShowDiagnostics(launchedFromWebView, curFileMeta, queryAutoCompMeta, curFileMeta.document, diagnosticCollection, false, "");
                return;
            }
            let curFileMeta = await getCurrentFileMetadata(freshCompilation);
            if (!curFileMeta?.isDataformWorkspace || !curFileMeta.fileMetadata) {
                return;
            }
            const panel = window.createWebviewPanel(
                CompiledQueryPanel.viewType,
                "Compiled query preview",
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

    private async sendUpdateToView(freshCompilation:boolean, showCompiledQueryInVerticalSplitOnSave:boolean | undefined) {
        let curFileMeta = await getCurrentFileMetadata(freshCompilation);
        if (!curFileMeta?.isDataformWorkspace || !curFileMeta.fileMetadata) {
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
        if (!queryAutoCompMeta){
            return;
        }

        dataformTags = queryAutoCompMeta.dataformTags;
        declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

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
            "errorMessage":  " ",
            "dryRunStat":  " ",
        });
        this.webviewPanel.webview.html = this._getHtmlForWebview(webview);

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }
        let launchedFromWebView = true;
        let dryRunResult = await dryRunAndShowDiagnostics(launchedFromWebView, curFileMeta, queryAutoCompMeta, curFileMeta.document, diagnosticCollection, false, "");
        let dryRunStat = dryRunResult?.statistics?.totalBytesProcessed;
        let errorMessage = dryRunResult?.error.message;
        if(!errorMessage){
            errorMessage = " ";
        }
        if(!dryRunStat){
            dryRunStat = "0 GB";
        }
        if(showCompiledQueryInVerticalSplitOnSave){
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
                "errorMessage": errorMessage,
                "dryRunStat":  dryRunStat,
            });
            return webview;
        } 
    }

    private async updateView() {
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        let webview = await this.sendUpdateToView(true, showCompiledQueryInVerticalSplitOnSave);
        if(webview){
            // this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        } else {
            console.log(`Dont show webview`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const showCompiledQueryUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showCompiledQuery.js"));
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
        const nonce = getNonce();

        let highlighJstThemeUri = getHighlightJsThemeUri();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${cdnLinks.highlightJsCssUri}">
            <script src="${cdnLinks.highlightJsUri}"></script>
            <script src="${cdnLinks.highlightJsCopyExtUri}"></script>
            <link rel="stylesheet" href="${cdnLinks.highlightJsCopyExtCssUri}" />
            <link rel="stylesheet" href="${highlighJstThemeUri}">
            <script src="${cdnLinks.highlightJsLineNoExtUri}"></script>

            <link href="${styleResetUri}" rel="stylesheet">
            <style>
        </style>
        </head>

        <body>

        <p><span id="relativeFilePath"></span></p>

        <div class="error-message" id="errorMessageDiv" style="display: none;">
            <p><span id="errorMessage" class="language-bash"></span></p>
        </div>

        <div class="dry-run-stat" id="dryRunStatDiv" style="display: none;">
            <p><span id="dryRunStat" class="language-bash"></span></p>
        </div>

        <span class="bigquery-job-cancelled"></span>

        <div id="codeBlock">
            <div id="preOperationsDiv" style="display: none;">
                <h4>Pre Operations</h4>
                <pre><code  id="preOperations" class="language-sql"></code></pre>
            </div>

            <div id="postOperationsDiv" style="display: none;">
                <h4>Post Operations</h4>
                <pre><code  id="postOperations" class="language-sql"></code></pre>
            </div>

            <div id="tableOrViewQueryDiv" style="display: none;">
                <h4>Query</h4>
                <pre><code  id="tableOrViewQuery" class="language-sql"></code></pre>
            </div>
            <div id="assertionQueryDiv" style="display: none;">
                <h4>Assertion</h4>
                <pre><code  id="assertionQuery" class="language-sql"></code></pre>
            </div>

            <div id="incrementalPreOpsQueryDiv" style="display: none;" >
                <h4>Incremental Pre Operations</h4>
                <pre><code  id="incrementalPreOpsQuery" class="language-sql"></code></pre>
            </div>

            <div id="incrementalQueryDiv" style="display: none;">
                <h4>Incremental Query</h4>
                <pre><code  id="incrementalQuery" class="language-sql"></code></pre>
            </div>

            <div id="nonIncrementalQueryDiv" style="display: none;">
                <h4>Non Incremental Query</h4>
                <pre><code  id="nonIncrementalQuery" class="language-sql"></code></pre>
            </div>

            <div id="operationsQueryDiv" style="display: none;">
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
