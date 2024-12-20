import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { compiledQueryWtDryRun, dryRunAndShowDiagnostics, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getHighlightJsThemeUri, getNonce, getTableSchema, getVSCodeDocument, getWorkspaceFolder, handleSemicolonPrePostOps } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";

function showLoadingProgress(
    title: string,
    operation: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ) => Thenable<void>,
    cancellationMessage: string = "Dataform tools: operation cancelled"
): Thenable<void> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: title,
            cancellable: true
        },
        async (progress, token) => {
            token.onCancellationRequested(() => {
                console.log(cancellationMessage);
            });

            await operation(progress, token);
        }
    );
}

async function updateSchemaAutoCompletions(currentFileMetadata:any) {
    let allSchemaCompletions:{name:string, metadata: any}[] = [];

    if (currentFileMetadata?.fileMetadata?.tables) {
        await Promise.all(currentFileMetadata.fileMetadata.tables.map(async (table:any) => {
            const dependencyTargets = table.dependencyTargets;

            if (dependencyTargets) {
                const schemaPromises = dependencyTargets.map(async (dt:{database:string, schema:string, name:string}) => {
                    return getTableSchema(dt.database, dt.schema, dt.name);
                });
                const schemas = await Promise.all(schemaPromises);
                const allSchemas = schemas.flat();
                allSchemaCompletions.push(...allSchemas);
            }
        }));
    }
    schemaAutoCompletions = allSchemaCompletions;
}

export function registerCompiledQueryPanel(context: ExtensionContext) {

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.showCompiledQueryInWebView', async() => {
            const currentFileMetadata = CompiledQueryPanel?.centerPanel?.currentFileMetadata;
            CompiledQueryPanel.getInstance(context.extensionUri, context, true, false, currentFileMetadata);
        })
    );

    vscode.window.onDidChangeActiveTextEditor(async(editor) => {
        const changedActiveEditorFileName = editor?.document?.fileName;
        const webviewPanelVisisble = CompiledQueryPanel?.centerPanel?.webviewPanel?.visible;
        if(!activeEditorFileName){
            activeEditorFileName = changedActiveEditorFileName;
        } else if (editor && changedActiveEditorFileName && activeEditorFileName!== changedActiveEditorFileName && webviewPanelVisisble ){
            activeEditorFileName = changedActiveEditorFileName;
            let currentFileMetadata = await getCurrentFileMetadata(false);
            updateSchemaAutoCompletions(currentFileMetadata);
            CompiledQueryPanel.getInstance(context.extensionUri, context, false, true, currentFileMetadata);
        }
    }, null, context.subscriptions);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document: vscode.TextDocument) => {
        const fileExtension = document.fileName.split('.').pop();
        if (fileExtension && !(fileExtension === 'sqlx' || fileExtension === 'js')){
            return;
        }
        activeEditorFileName = document?.fileName;
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || ( CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false)){
            if(CompiledQueryPanel?.centerPanel?.webviewPanel?.visible){
                let currentFileMetadata = await getCurrentFileMetadata(true);
                updateSchemaAutoCompletions(currentFileMetadata);
                CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, currentFileMetadata);
            } else{
                showLoadingProgress(
                    "Dataform tools\n",
                    async (progress, token) => {
                        progress.report({ message: "Generating compiled query metadata..." });
                        CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, undefined);
                    },
                );
            }
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
    private _cachedResults?: {fileMetadata: any, curFileMeta:any, targetTableOrView:any, errorMessage: string, dryRunStat:any, location: string};
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
            // if (!currentFileMetadata?.isDataformWorkspace) {
            //     return;
            // }

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
                    this.centerPanel = undefined;
                }
            },
            null,
            );
        
        this.centerPanel?.webviewPanel.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'lineageMetadata':
                const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                const targetTableOrView  = this.centerPanel?._cachedResults?.targetTableOrView;
                const errorMessage  = this.centerPanel?._cachedResults?.errorMessage;
                const dryRunStat  = this.centerPanel?._cachedResults?.dryRunStat;
                const location = this.centerPanel?._cachedResults?.location || "eu"; // TODO: check if there is way to have a better default

                const lineageMetadata = await getLiniageMetadata(fileMetadata.tables[0].target, location);

                this.centerPanel?.webviewPanel.webview.postMessage({
                    "tableOrViewQuery": fileMetadata.queryMeta.tableOrViewQuery,
                    "assertionQuery": fileMetadata.queryMeta.assertionQuery,
                    "preOperations": fileMetadata.queryMeta.preOpsQuery,
                    "postOperations": fileMetadata.queryMeta.postOpsQuery,
                    "incrementalPreOpsQuery": fileMetadata.queryMeta.incrementalPreOpsQuery,
                    "incrementalQuery": fileMetadata.queryMeta.incrementalQuery,
                    "nonIncrementalQuery": fileMetadata.queryMeta.nonIncrementalQuery,
                    "operationsQuery": fileMetadata.queryMeta.operationsQuery,
                    "relativeFilePath": curFileMeta.pathMeta.relativeFilePath,
                    "lineageMetadata": lineageMetadata,
                    "errorMessage": errorMessage,
                    "dryRunStat":  dryRunStat,
                    "compiledQuerySchema": compiledQuerySchema,
                    "targetTableOrView": targetTableOrView,
                    "models": curFileMeta.fileMetadata.tables,
                    "dependents": curFileMeta.dependents,
                });
                return;
            }
          },
          undefined,
          undefined,
      );

    }


    private async sendUpdateToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:any) {
        const webview = this.webviewPanel.webview;
        if (this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(true);
            updateSchemaAutoCompletions(curFileMeta);
        }

        if (curFileMeta.isDataformWorkspace===false){
            return;
        }

        if(curFileMeta.dataformCompilationErrors){
            let errorString = "<p>Error compiling Dataform:</p><ul>";

            let workspaceFolder = getWorkspaceFolder();
            if (!workspaceFolder) {
                return;
            }

            for (const { error, fileName } of curFileMeta.dataformCompilationErrors) {
                errorString += `<li>${error} at ${fileName}</li><br>`;

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

            errorString += "</ul>Run `dataform compile` to see more details";

            await webview.postMessage({
                "errorMessage": errorString
            });
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
        let targetTableOrView = curFileMeta.fileMetadata.tables[0]?.target;

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
            "lineageMetadata": curFileMeta.lineageMetadata,
            "compiledQuerySchema": compiledQuerySchema,
            "targetTableOrView": targetTableOrView,
            "dependents": curFileMeta.dependents,
        });

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta(curFileMeta);
        if (!queryAutoCompMeta){
            return;
        }

        let dryRunResult = await dryRunAndShowDiagnostics(curFileMeta, queryAutoCompMeta, curFileMeta.document, diagnosticCollection, false);
        let dryRunStat = dryRunResult?.statistics?.totalBytesProcessed;
        let errorMessage = dryRunResult?.error.message;
        const location:string = dryRunResult?.location?.toLowerCase();
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
                "lineageMetadata": curFileMeta.lineageMetadata,
                "errorMessage": errorMessage,
                "dryRunStat":  dryRunStat,
                "compiledQuerySchema": compiledQuerySchema,
                "targetTableOrView": targetTableOrView,
                "models": curFileMeta.fileMetadata.tables,
                "dependents": curFileMeta.dependents,
            });
            this._cachedResults = { fileMetadata, curFileMeta, targetTableOrView, errorMessage, dryRunStat, location};
            dataformTags = queryAutoCompMeta.dataformTags;
            declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;
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
        const customTabulatorCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "tabulator_custom.css"));
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
            <link href="${customTabulatorCss}" rel="stylesheet">
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
                <span class="dependency-title" style="font-weight: bold;">Dependencies & Dependents</span>
            </div>
            <div id="depsDiv" class="dependency-list">
            </div>
        </div>

        <div class="error-message-container" id="errorMessageDiv" style="display: none;">
            <p><span id="errorMessage" class="language-bash"></span></p>
        </div>

        <div class="no-errors-container" id="dryRunStatDiv" style="display: none;">
            <p><span id="dryRunStat" class="language-bash"></span></p>
        </div>


        <div id="schemaBlock" style="display: none; margin-top: 20px;">
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
