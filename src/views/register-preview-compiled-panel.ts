import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { compiledQueryWtDryRun, dryRunAndShowDiagnostics, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getHighlightJsThemeUri, getNonce, getVSCodeDocument, getWorkspaceFolder, handleSemicolonPrePostOps } from "../utils";
import { GraphError} from "../types";
import path from "path";



export function registerCompiledQueryPanel(context: ExtensionContext) {

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryInWebView', async() => {
            const currentFileMetadata = CompiledQueryPanel?.centerPanel?.currentFileMetadata;
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, false, currentFileMetadata);
        })
    );

    vscode.window.onDidChangeActiveTextEditor(async(editor) => {
        if (editor && CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
            let currentFileMetadata = await getCurrentFileMetadata(false);
            CompiledQueryPanel.getInstance(context.extensionUri, context, false, true, currentFileMetadata);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || ( CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false && CompiledQueryPanel?.centerPanel?.webviewPanel?.visible)){
            let currentFileMetadata = await getCurrentFileMetadata(true);
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, currentFileMetadata);
        } else {
            if (diagnosticCollection && showCompiledQueryInVerticalSplitOnSave === false){
                compiledQueryWtDryRun(document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);
            }
        }
    }));

}


export class CompiledQueryPanel {
    public static centerPanel: CompiledQueryPanel | undefined;
    public centerPanelDisposed: boolean = false;
    public currentFileMetadata: any;
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext, forceShowVerticalSplit:boolean, currentFileMetadata:any) {
        this.updateView(forceShowVerticalSplit, currentFileMetadata);
    }

    public static async getInstance(extensionUri: Uri, extensionContext: ExtensionContext, freshCompilation:boolean, forceShowInVeritcalSplit:boolean, currentFileMetadata:any) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        if(CompiledQueryPanel.centerPanel && !this.centerPanel?.centerPanelDisposed){
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave && !forceShowInVeritcalSplit){
                if (CompiledQueryPanel?.centerPanel?.webviewPanel){
                    CompiledQueryPanel.centerPanel.webviewPanel.dispose();
                }
                return;
            }
            CompiledQueryPanel.centerPanel.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata);
        } else {
            const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
            if(!showCompiledQueryInVerticalSplitOnSave && showCompiledQueryInVerticalSplitOnSave !== undefined && !forceShowInVeritcalSplit){
                let currentFileMetadata = await getCurrentFileMetadata(freshCompilation);
                if (!currentFileMetadata?.isDataformWorkspace || !currentFileMetadata.fileMetadata) {
                    return;
                }

                let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(currentFileMetadata);
                if (!queryAutoCompMeta){
                    return;
                }

                dataformTags = queryAutoCompMeta.dataformTags;
                declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

                if(diagnosticCollection){
                    diagnosticCollection.clear();
                }
                dryRunAndShowDiagnostics(currentFileMetadata, queryAutoCompMeta, currentFileMetadata.document, diagnosticCollection, false);
                return;
            }

            //TODO: Handle this later
            if (!currentFileMetadata?.isDataformWorkspace) {
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
            CompiledQueryPanel.centerPanel = new CompiledQueryPanel(panel, extensionUri, extensionContext, forceShowInVeritcalSplit, currentFileMetadata);
        }

        this.centerPanel?.webviewPanel.onDidDispose(() => {
            if(this.centerPanel){
                this.centerPanel.centerPanelDisposed  = true;
            }
        });
    }

    private async sendUpdateToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:any) {
        const webview = this.webviewPanel.webview;
        if (this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        }

        if (curFileMeta.isDataformWorkspace===false){
            return;
        }
        
        if(curFileMeta.dataformCompilationErrors){
            let errorString = "<p>Error compiling Dataform:</p><ul>" + curFileMeta.dataformCompilationErrors.map(({error, fileName}:GraphError) => `<li>${error} at ${fileName}</li><br>`).join('') + "</ul>";
            errorString += "Run `dataform compile` to see more details";

            await webview.postMessage({
                "errorMessage": errorString
            });

            let workspaceFolder = getWorkspaceFolder();
            if (!workspaceFolder){return;}

            curFileMeta.dataformCompilationErrors.forEach(({error, fileName}:GraphError) => {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(0,0,0,0),
                    `(** compilation error **): ${error}`,
                    vscode.DiagnosticSeverity.Error
                );
                if(diagnosticCollection){
                    let fullSourcePath = path.join(workspaceFolder, fileName);
                    let sourcesJsUri = vscode.Uri.file(fullSourcePath);
                    diagnosticCollection.set(sourcesJsUri, [diagnostic]);
                }
                }
            );
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
        let targetTableOrView = curFileMeta.fileMetadata.tables[0]?.target;

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
        if (!queryAutoCompMeta){
            return;
        }

        dataformTags = queryAutoCompMeta.dataformTags;
        declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

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
            "compiledQuerySchema": compiledQuerySchema,
            "targetTableOrView": targetTableOrView,
        });

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }
        let dryRunResult = await dryRunAndShowDiagnostics(curFileMeta, queryAutoCompMeta, curFileMeta.document, diagnosticCollection, false);
        let dryRunStat = dryRunResult?.statistics?.totalBytesProcessed;
        let errorMessage = dryRunResult?.error.message;
        if(!errorMessage){
            errorMessage = " ";
        }
        if(!dryRunStat){
            dryRunStat = "0 GB";
        }
        if(showCompiledQueryInVerticalSplitOnSave || forceShowInVeritcalSplit){
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
                "compiledQuerySchema": compiledQuerySchema,
                "targetTableOrView": targetTableOrView,
                "models": curFileMeta.fileMetadata.tables,
            });
            return webview;
        }
    }

    private async updateView(forceShowInVeritcalSplit:boolean, currentFileMetadata:any) {
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        let webview = await this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata);
        if(webview){
            // this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        } else {
            // console.log(`Dont show webview`);
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

            <link href="${cdnLinks.tabulatorCssUri}" rel="stylesheet">
            <script type="text/javascript" src="${cdnLinks.tabulatorUri}"></script>

            <link href="${styleResetUri}" rel="stylesheet">
            <style>
        </style>
        </head>

        <body>

        <div style="padding-bottom: 20px; padding-top: 10px;">
            <div class="topnav">
                <a class="active" href="#compilation">Compiled Query</a>
                <a href="#schema">Schema</a>
            </div>
        </div>

        <div id="compiledQueryloadingIcon">
            <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="25" cy="25" r="10" fill="none" stroke="#3498db" stroke-width="4">
                        <animate attributeName="stroke-dasharray" dur="2s" repeatCount="indefinite"
                        values="0 126;126 126;126 0"/>
                        <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite"
                        values="0;-126;-252"/>
                    </circle>
            </svg>
        </div>

        <div>
           <a id="targetTableOrViewLink"></a>
        </div>

        <div class="dependency-container" style="padding-bottom: 10px;">
            <div class="dependency-header">
                <div class="arrow-toggle">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                    </svg>
                </div>
                <span class="dependency-title">Dependencies</span>
            </div>
            <div id="depsDiv" class="dependency-list">
            </div>
        </div>


        <div id="schemaBlock" style="display: none;">
            <table id="schemaTable" class="display" width="100%"></table>
        </div>


        <div id="compilationBlock" style="display: block;">

            <div id="dryRunloadingIcon">
                <svg width="50" height="50" viewBox="0 0 50 50" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="25" cy="25" r="10" fill="none" stroke="#32cd32" stroke-width="4">
                            <animate attributeName="stroke-dasharray" dur="2s" repeatCount="indefinite"
                            values="0 126;126 126;126 0"/>
                            <animate attributeName="stroke-dashoffset" dur="2s" repeatCount="indefinite"
                            values="0;-126;-252"/>
                        </circle>
                </svg>
            </div>


            <div class="error-message-container" id="errorMessageDiv" style="display: none;">
                <p><span id="errorMessage" class="language-bash"></span></p>
            </div>

            <div class="no-errors-container" id="dryRunStatDiv" style="display: none;">
                <p><span id="dryRunStat" class="language-bash"></span></p>
            </div>

            <span class="bigquery-job-cancelled"></span>

            <p><span id="relativeFilePath"></span></p>

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
        </div>

        </body>
        </html>
        `;
    }

}
