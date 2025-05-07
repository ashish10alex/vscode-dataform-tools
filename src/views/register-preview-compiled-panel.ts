import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { compiledQueryWtDryRun, dryRunAndShowDiagnostics, formatBytes, gatherQueryAutoCompletionMeta, getTabulatorThemeUri, getCurrentFileMetadata, getHighlightJsThemeUri, getNonce, getTableSchema, getWorkspaceFolder, handleSemicolonPrePostOps, selectWorkspaceFolder } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";
import { runCurrentFile } from "../runFiles";
import { ColumnMetadata,  Column, ActionDescription, CurrentFileMetadata, SupportedCurrency } from "../types";
import { currencySymbolMapping, getFileNotFoundErrorMessageForWebView } from "../constants";
import { costEstimator } from "../costEstimator";
import { getModelLastModifiedTime } from "../bigqueryDryRun";
import { formatCurrentFile } from "../formatCurrentFile";
import * as fs from 'fs';
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
            activeDocumentObj = editor.document;
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
        activeDocumentObj = document;
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || ( CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false)){
            if(CompiledQueryPanel?.centerPanel?.webviewPanel?.visible){
                let currentFileMetadata = await getCurrentFileMetadata(true);
                updateSchemaAutoCompletions(currentFileMetadata);
                CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, currentFileMetadata);
            } else{
                showLoadingProgress(
                    "Dataform tools\n",
                    async (progress) => {
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
    private lastMessageTime = 0;
    private readonly DEBOUNCE_INTERVAL = 300; // milliseconds
    private _cachedResults?: {fileMetadata: any, curFileMeta:any, targetTablesOrViews:any, errorMessage: string, dryRunStat:any, location: string|undefined};
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext, forceShowVerticalSplit:boolean, currentFileMetadata:any) {
        this.updateView(forceShowVerticalSplit, currentFileMetadata);
    }

    public static async getInstance(extensionUri: Uri, extensionContext: ExtensionContext, freshCompilation:boolean, forceShowInVeritcalSplit:boolean, currentFileMetadata:any) {
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
                if (!currentFileMetadata?.errors?.errorGettingFileNameFromDocument || !currentFileMetadata.fileMetadata) {
                    return;
                }

                let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
                if (!queryAutoCompMeta){
                    return;
                }

                dataformTags = queryAutoCompMeta.dataformTags;
                declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;

                if(diagnosticCollection){
                    diagnosticCollection.clear();
                }
                if (currentFileMetadata.document){
                    dryRunAndShowDiagnostics(currentFileMetadata, currentFileMetadata.document, diagnosticCollection, false);
                }
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
            const now = Date.now();
            if(this.centerPanel){
                if (now - this?.centerPanel?.lastMessageTime < this?.centerPanel?.DEBOUNCE_INTERVAL) {
                    // NOTE: vscode.postMessage form webview sends in multiple messages when active editor is switched
                    // NOTE: This is debounce hack build to avoid processing multiple messages and process only the first message
                    return;
                }
                this.centerPanel.lastMessageTime = now;
            }

            switch (message.command) {
              case 'selectWorkspaceFolder':
                await selectWorkspaceFolder();
                vscode.commands.executeCommand("vscode-dataform-tools.showCompiledQueryInWebView");
                return;
              case 'updateCompilerOptions':
                const compilerOptions = message.value;
                vscode.workspace.getConfiguration('vscode-dataform-tools').update('compilerOptions', compilerOptions);
                return;
              case 'dependencyGraph':
                await vscode.commands.executeCommand("vscode-dataform-tools.dependencyGraphPanel");
                return;
              case 'previewResults':
                if(message.value){
                    await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                }
                return;
              case 'runModel':
                const includeDependencies = message.value.includeDependencies;
                const includeDependents  = message.value.includeDependents;
                const fullRefresh  = message.value.fullRefresh;
                await runCurrentFile(includeDependencies, includeDependents, fullRefresh);
                return;
              case 'costEstimator':

                const selectedTag = message.value.selectedTag;
                if(CACHED_COMPILED_DATAFORM_JSON){
                    const tagDryRunStatsMeta = await costEstimator(CACHED_COMPILED_DATAFORM_JSON, selectedTag);
                    let currency = "USD" as SupportedCurrency;
                    let currencySymbol = "$";
                    if(tagDryRunStatsMeta?.tagDryRunStatsList){
                        currency = tagDryRunStatsMeta?.tagDryRunStatsList[0].currency;
                        currencySymbol = currencySymbolMapping[currency];
                    }
                    const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                    const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                    const targetTablesOrViews  = this.centerPanel?._cachedResults?.targetTablesOrViews;
                    const errorMessage  = this.centerPanel?._cachedResults?.errorMessage;
                    const dryRunStat  = this.centerPanel?._cachedResults?.dryRunStat;
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
                        "tagDryRunStatsMeta": tagDryRunStatsMeta,
                        "currencySymbol": currencySymbol,
                        "errorMessage": errorMessage,
                        "dryRunStat":  dryRunStat,
                        "compiledQuerySchema": compiledQuerySchema,
                        "targetTablesOrViews": targetTablesOrViews,
                        "models": curFileMeta.fileMetadata.tables,
                        "dependents": curFileMeta.dependents,
                        "dataformTags": dataformTags,
                        "selectedTag": selectedTag,
                    });
                }else{
                    vscode.window.showErrorMessage("No cached data to estimate cost from");
                }
                return;
              case 'formatCurrentFile':
                const formattedText:any = await formatCurrentFile(diagnosticCollection);
                const activeEditorFilePath = activeDocumentObj?.uri.fsPath;
                if(activeEditorFilePath){
                    fs.writeFile(activeEditorFilePath, formattedText, (err: any) => {
                        if (err) {throw err;};
                        vscode.window.showInformationMessage(`Formatted: ${path.basename(activeEditorFilePath)}`);
                        return;
                    });
                }
                return;
              case 'lineageMetadata':
                const fileMetadata  = this.centerPanel?._cachedResults?.fileMetadata;
                const curFileMeta  = this.centerPanel?._cachedResults?.curFileMeta;
                const targetTablesOrViews  = this.centerPanel?._cachedResults?.targetTablesOrViews;
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
                    "targetTablesOrViews": targetTablesOrViews,
                    "models": curFileMeta.fileMetadata.tables,
                    "dependents": curFileMeta.dependents,
                    "dataformTags": dataformTags,
                });
                return;
            }
          },
          undefined,
          undefined,
      );

    }


    //@ts-ignore
    private async sendUpdateToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:CurrentFileMetadata|undefined) {
        const webview = this.webviewPanel.webview;
        if (this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(true);
        }

        if(!curFileMeta){
            await webview.postMessage({
                "errorMessage": `File type not supported. Supported file types are sqlx, js`
            });
            return;
        }

        if (curFileMeta.isDataformWorkspace===false){
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const currentDirectory = workspaceFolder?.uri.fsPath;
            await webview.postMessage({
                "errorMessage": `${currentDirectory} is not a Dataform workspace. Hint: Open workspace rooted in workflowsetting.yaml or dataform.json`
            });
            return;
        } else if (curFileMeta?.errors?.errorGettingFileNameFromDocument){
            await webview.postMessage({
                "errorMessage": curFileMeta?.errors?.errorGettingFileNameFromDocument
            });
        } else if ((curFileMeta?.errors?.fileNotFoundError===true || curFileMeta?.fileMetadata?.tables?.length === 0) && curFileMeta?.pathMeta?.relativeFilePath && curFileMeta?.pathMeta?.extension === "sqlx"){
            const errorMessage = await getFileNotFoundErrorMessageForWebView(curFileMeta?.pathMeta?.relativeFilePath);
            await webview.postMessage({
                "errorMessage": errorMessage
            });
            return;
        }
        updateSchemaAutoCompletions(curFileMeta);

        if(curFileMeta.errors?.dataformCompilationErrors){
            let errorString = "<h3>Error compiling Dataform:</h3><ul>";

            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                return;
            }

            for (const { error, fileName } of curFileMeta?.errors?.dataformCompilationErrors) {
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

            errorString += "</ul> Run `dataform compile` to see more details <br>";
            if (curFileMeta?.possibleResolutions && curFileMeta?.possibleResolutions?.length > 0) {
                errorString += "<h4>Possible fixes:</h4><ul>";
                for (let i = 0; i < curFileMeta.possibleResolutions.length; i++) {
                    errorString += `<li>${curFileMeta.possibleResolutions[i]}</li>`;
                }
                errorString += "</ul>";
            }

            await webview.postMessage({
                "errorMessage": errorString
            });
            return;
        }

        if(!curFileMeta.fileMetadata || !curFileMeta.pathMeta){
            //TODO: show some error message in this case
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(curFileMeta.fileMetadata);
        let targetTablesOrViews = curFileMeta.fileMetadata.tables;

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
            "targetTablesOrViews": targetTablesOrViews,
            "dependents": curFileMeta.dependents,
            "dataformTags": dataformTags,
    });

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
        if (!queryAutoCompMeta || !curFileMeta.document || !targetTablesOrViews){
            //TODO: show some error message in this case
            return;
        }

        const [dryRunResults, modelsLastUpdateTimesMeta] = await Promise.all([
            dryRunAndShowDiagnostics(curFileMeta, curFileMeta.document, diagnosticCollection, false),
            getModelLastModifiedTime(targetTablesOrViews.map((table) => table.target))
        ]);
        const [dryRunResult, preOpsDryRunResult, postOpsDryRunResult] = dryRunResults;

        let dryRunStat = formatBytes(dryRunResult?.statistics?.totalBytesProcessed);

        let currency = "USD" as SupportedCurrency;
        let currencySymbol = "$";

        if(dryRunResult?.statistics?.cost?.currency){
            currency = dryRunResult?.statistics?.cost?.currency as SupportedCurrency;
            currencySymbol = currencySymbolMapping[currency];
        }
        let dryRunCost = currencySymbol + (dryRunResult?.statistics?.cost?.value.toFixed(3) || "0.00");

        let errorMessage = (preOpsDryRunResult?.error.message ? preOpsDryRunResult?.error.message + "<br>" : "") + dryRunResult?.error.message + (postOpsDryRunResult?.error.message ?  "<br>" + postOpsDryRunResult?.error.message: "");
        const location = dryRunResult?.location?.toLowerCase();
        if(!errorMessage){
            errorMessage = " ";
        }else if (dryRunResult?.error.message ==="BigQuery client not available."){
            errorMessage += `<h4>Possible fix: </h4>
            <a href="https://cloud.google.com/sdk/docs/install">Install gcloud cli</a> <br>
            <p> After gcloud cli is installed run the following in the terminal in order </p>
             <ol>
                <li><b>gcloud init</b></li>
                <li><b>gcloud auth application-default login</b></li>
                <li><b>gcloud config set project your-project-id</b>  #replace with your gcp project id</li>
             </ol>`;
        }
        if(!dryRunStat){
            dryRunStat = "0 B";
        }else{
            dryRunStat += ` (${dryRunCost})`;
        }

        if (compiledQuerySchema?.fields) {
            const curFileActionDescriptor: ActionDescription = curFileMeta.fileMetadata.tables[0].actionDescriptor;
            // Remove 'mode' attribute from each field
            compiledQuerySchema.fields = compiledQuerySchema.fields.map(({ mode, ...rest }) => rest);

            if (curFileActionDescriptor?.columns) {
                const columnMap = new Map(
                    curFileActionDescriptor.columns.map((column: Column) => [column.path[0], column.description || ""])
                );

                compiledQuerySchema.fields.forEach((columnMetadata: ColumnMetadata) => {
                    const description = columnMap.get(columnMetadata.name);
                    if (description !== undefined) {
                        columnMetadata.description = description;
                    }
                });
            }
            //TODO: there seem to be any issue with loading many columns
            // compiledQuerySchema.fields = compiledQuerySchema.fields.slice(0, 69);
        } else {
            compiledQuerySchema = {fields: [{"name": "", type:""}]};
        }

        dataformTags = queryAutoCompMeta.dataformTags;
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
                "currencySymbol": currencySymbol,
                "compiledQuerySchema": compiledQuerySchema,
                "targetTablesOrViews": targetTablesOrViews,
                "models": curFileMeta.fileMetadata.tables,
                "dependents": curFileMeta.dependents,
                "dataformTags": dataformTags,
                "modelsLastUpdateTimesMeta": modelsLastUpdateTimesMeta
            });
            this._cachedResults = { fileMetadata, curFileMeta, targetTablesOrViews, errorMessage, dryRunStat, location};
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
        let customTabulatorCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "tabulator_custom_dark.css"));
        const highlightJsCopyExtUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "highlightjs-copy", "highlightjs-copy.min.js"));
        const highlightJsCopyExtCssUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "highlightjs-copy", "highlightjs-copy.min.css"));
        const nonce = getNonce();
        const compilerOptions = vscode.workspace.getConfiguration('vscode-dataform-tools').get('compilerOptions');
        const escapedCompilerOptions = compilerOptions && typeof compilerOptions === 'string'
            ? compilerOptions.replace(/"/g, "&quot;")
            : "";

        let highlighJstThemeUri = getHighlightJsThemeUri();

        let {tabulatorCssUri, type} = getTabulatorThemeUri();
        if(type === "light"){
            customTabulatorCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "tabulator_custom_light.css"));
        }

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="${cdnLinks.highlightJsCssUri}">
            <script src="${cdnLinks.highlightJsUri}"></script>
            <script src="${highlightJsCopyExtUri}"></script>
            <link rel="stylesheet" href="${highlightJsCopyExtCssUri}" />
            <link rel="stylesheet" href="${highlighJstThemeUri}">
            <script src="${cdnLinks.highlightJsLineNoExtUri}"></script>

            <link href="${tabulatorCssUri}" rel="stylesheet">
            <script type="text/javascript" src="${cdnLinks.tabulatorUri}"></script>

            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${customTabulatorCss}" rel="stylesheet">
        </head>

        <body>

        <div class="report-widget">
        <a href="https://github.com/ashish10alex/vscode-dataform-tools/issues" class="report-link">
            Report an issue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 5H19V14M19 5L5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </a>
        </div>

        <div style="padding-bottom: 20px; padding-top: 10px;">
            <div class="topnav">
                <a class="active" href="#compilation">Compiled Query</a>
                <a href="#schema">Schema</a>
                <a href="#cost">Cost Estimator</a>
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

        <div id="modelLinkDiv" style="display: flex; align-items: center; display: none;">
            <a id="targetTableOrViewLink"></a>
        </div>

        <div class="dependency-container" id="dataLineageDiv" style="padding-bottom: 10px;">
            <div class="dependency-header">
                <div class="arrow-toggle">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                    </svg>
                </div>
                <span class="dependency-title" style="font-weight: bold;">Data Lineage</span>
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


        <div id="schemaCodeBlockDiv" style="display: none;">
            <pre><code  id="schemaCodeBlock" class="language-javascript"></code></pre>
        </div>

        <div id="schemaBlock" style="display: none; margin-top: 20px;">
            <div id="noSchemaBlock"> </div>
            <p><i>Edit description to generate documentation code for the columns. See <a href="https://cloud.google.com/dataform/docs/create-tables#reuse-column-documentation-includes">documentation</a> for how to use the generated code.</i></p>
            <table id="schemaTable" class="display" width="100%"></table>
        </div>

        <div id="costBlock" style="display: none; margin-top: 20px;">
            <div class="cost-estimator-header">
                <h2>Cost Estimator</h2>
                <div class="cost-estimator-info">
                    <p>For each model in the tag, we construct a full query and perform dry run:</p>
                    <div class="query-types">
                        <div class="query-type">
                            <span class="query-type-title">Table/View</span>
                            <span class="query-type-desc">Pre operation + Create or replaces a table/view statement + main query</span>
                        </div>
                        <div class="query-type">
                            <span class="query-type-title">Partitioned/Clustered Tables</span>
                            <span class="query-type-desc">Pre operations + main query</span>
                        </div>
                        <div class="query-type">
                            <span class="query-type-title">Incremental</span>
                            <span class="query-type-desc">Incremental pre operation query + Create or replaces a table/view statement + main query</span>
                        </div>
                        <div class="query-type">
                            <span class="query-type-title">Partitioned/Clustered Incremental</span>
                            <span class="query-type-desc">Incremental pre operation query + main query</span>
                        </div>
                        <div class="query-type">
                            <span class="query-type-title">Assertion & Operation</span>
                            <span class="query-type-desc">Main query</span>
                        </div>
                    </div>
                </div>

                <div id="costEstimatorloadingIcon" style="display: none;">
                    <div class="loading-spinner"></div>
                </div>

                <div class="tag-selection-container">
                    <div class="select-wrapper">
                        <select id="tags" class="tag-select">
                            <option value="" disabled selected>Select a tag to estimate cost</option>
                        </select>
                    </div>
                    <button class="cost-estimate-button" id="costEstimator">
                        Estimate Cost
                    </button>
                </div>

                <div class="cost-table-container">
                    <table id="costTable" class="cost-table"></table>
                </div>
            </div>
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

            <div class="file-path-container">
                <span id="relativeFilePath"></span>
                <button id="formatButton" class="format-button" title="Format Model">
                    <svg class="format-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 3.34V2m0 16.36v-1.34M3.34 8H2m16.36 0h-1.34M4.93 4.93l-.95-.95m11.31 11.31l-.95-.95M14.5 5.5l-9 9 2 2 9-9-2-2z"
                            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M17 3l1 1m1 2l1 1M19 2l1 1m-2 2l1 1"
                            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Format
                </button>
            </div>

            <div>
                <div class="compiler-options-input-container">
                    <label for="compilerOptionsInput" class="compiler-options-label">
                        <a href="https://dataformtools.com/blog/compiler-options" target="_blank" class="compiler-options-link">Compiler options: </a>
                    </label>
                    <input
                        type="text"
                        id="compilerOptionsInput"
                        class="compiler-options-input"
                        title="Additional compiler options to pass to dataform cli commands e.g. --table-prefix=&quot;AA&quot; --vars=someKey=someValue,a=b"
                        style="width: 40%;"
                        value="${escapedCompilerOptions}"
                    />
                </div>
                <div class="checkbox-group">
                    <label class="model-checkbox-container">
                        <input type="checkbox" id="includeDependencies" class="checkbox">
                        <span class="custom-checkbox"></span>
                        Include Dependencies (upstream)
                    </label>
                    <label class="model-checkbox-container">
                        <input type="checkbox" id="includeDependents" class="checkbox">
                        <span class="custom-checkbox"></span>
                        Include Dependents (downstream)
                    </label>
                    <label class="model-checkbox-container">
                        <input type="checkbox" id="fullRefresh" class="checkbox">
                        <span class="custom-checkbox"></span>
                        full Refresh (Forces incremental tables to be rebuilt from scratch)
                    </label>
                </div>

                <div class="button-container">
                    <button class="run-model" id="dependencyGraph" title="Dependency Graph">Dependency Graph</button>
                    <button class="run-model" id="previewResults" title="Preview the data in BigQuery like console before running the model">Data Preview</button>
                    <button class="run-model" id="runModel" title="Execute the model in BigQuery with specified settings">Run</button>
                </div>

            </div>

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
