import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { compiledQueryWtDryRun, dryRunAndShowDiagnostics, formatBytes, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getNonce, getTableSchema, getWorkspaceFolder, handleSemicolonPrePostOps, selectWorkspaceFolder, openFileOnLeftEditorPane, findModelFromTarget, getPostionOfSourceDeclaration, showLoadingProgress } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";
import { runCurrentFile } from "../runCurrentFile";
import { ColumnMetadata,  Column, ActionDescription, CurrentFileMetadata, SupportedCurrency, BigQueryDryRunResponse, WebviewMessage  } from "../types";
import { currencySymbolMapping, getFileNotFoundErrorMessageForWebView } from "../constants";
import { costEstimator } from "../costEstimator";
import { getModelLastModifiedTime } from "../bigqueryDryRun";
import { logger } from "../logger";
import { formatCurrentFile } from "../formatCurrentFile";
import * as fs from 'fs';
import { debounce } from "../debounce";


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

    const debouncedActiveEditorChange = debounce(async (editor: vscode.TextEditor | undefined) => {
        const changedActiveEditorFileName = editor?.document?.fileName;
        const webviewPanelVisisble = CompiledQueryPanel?.centerPanel?.webviewPanel?.visible;
        if (!activeEditorFileName) {
            activeEditorFileName = changedActiveEditorFileName;
        } else if (editor && changedActiveEditorFileName && activeEditorFileName !== changedActiveEditorFileName && webviewPanelVisisble) {
            activeEditorFileName = changedActiveEditorFileName;
            activeDocumentObj = editor.document;
            let currentFileMetadata = await getCurrentFileMetadata(false);
            updateSchemaAutoCompletions(currentFileMetadata);
            CompiledQueryPanel.getInstance(context.extensionUri, context, false, true, currentFileMetadata);
        }
    }, 500);

    vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange, null, context.subscriptions);


    const debouncedSaveHandler = debounce(async (document: vscode.TextDocument) => {
        const fileExtension = document.fileName.split('.').pop();
        if (fileExtension && !(fileExtension === 'sqlx' || fileExtension === 'js')) {
            return;
        }
        activeEditorFileName = document?.fileName;
        activeDocumentObj = document;
        const showCompiledQueryInVerticalSplitOnSave: boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || (CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false)) {
            if (CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
                CompiledQueryPanel?.centerPanel?.webviewPanel?.webview.postMessage({
                    "recompiling": true
                });
                let currentFileMetadata = await getCurrentFileMetadata(true);
                updateSchemaAutoCompletions(currentFileMetadata);
                CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, currentFileMetadata);
            } else {
                showLoadingProgress(
                    "Dataform tools\n",
                    async (progress) => {
                        progress.report({ message: "Generating compiled query metadata..." });
                        CompiledQueryPanel.getInstance(context.extensionUri, context, true, true, undefined);
                    },
                );
            }
        } else {
            if (diagnosticCollection && showCompiledQueryInVerticalSplitOnSave === false) {
                compiledQueryWtDryRun(document, diagnosticCollection, showCompiledQueryInVerticalSplitOnSave);
            }
        }
    }, 500);

    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(debouncedSaveHandler));


}


export class CompiledQueryPanel {
    public static centerPanel: CompiledQueryPanel | undefined;
    public centerPanelDisposed: boolean = false;
    public currentFileMetadata: any;
    private lastMessageTime = 0;
    private readonly DEBOUNCE_INTERVAL = 300; // milliseconds
    private _cachedResults?: {fileMetadata: any, curFileMeta:any, targetTablesOrViews:any, errorMessage: string, dryRunStat:any, location: string|undefined, compilerOptions: string|undefined};
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext, forceShowVerticalSplit:boolean, currentFileMetadata:any, freshCompilation: boolean = true) {
        this.updateView(forceShowVerticalSplit, currentFileMetadata, freshCompilation);
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
            CompiledQueryPanel.centerPanel.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata, freshCompilation);
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
                        Uri.joinPath(extensionUri, "media"),
                        Uri.joinPath(extensionUri, "dist")
                    ],
                }
            );
            CompiledQueryPanel.centerPanel = new CompiledQueryPanel(panel, extensionUri, extensionContext, forceShowInVeritcalSplit, currentFileMetadata, freshCompilation);
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
              case 'lineageNavigation':
                const projectId = message.value.split(".")[0];
                const datasetId = message.value.split(".")[1];
                const tableId = message.value.split(".")[2];

                if(!CACHED_COMPILED_DATAFORM_JSON){
                    // this should never happen as the view exposing the dependents can only be created when compilation is done;
                    vscode.window.showWarningMessage(`compile Dataform project before navigating to dependencies & dependents`);
                }

                let tables = CACHED_COMPILED_DATAFORM_JSON?.tables;
                let operations = CACHED_COMPILED_DATAFORM_JSON?.operations;
                let assertions = CACHED_COMPILED_DATAFORM_JSON?.assertions;
                let declarations = CACHED_COMPILED_DATAFORM_JSON?.declarations;

                const modelTypes = [tables, operations, assertions];
                for (const model of modelTypes) {
                    if (model) {
                        const result = findModelFromTarget({ projectId, tableId, datasetId }, model);
                        if(result){
                            const { filePath } = result;
                            if (filePath) {
                                const position =  new vscode.Position(0, 0);
                                openFileOnLeftEditorPane(filePath, position);
                                return;
                            }
                        }
                    }
                }

                if(declarations){
                    const result = findModelFromTarget({ projectId, tableId, datasetId }, declarations);
                    if(result){
                            const { filePath, targetName } = result;
                            const workspaceFolder = await getWorkspaceFolder();
                            if(workspaceFolder){
                                const fullFilePath = path.join(workspaceFolder, filePath);
                                const filePathUri = vscode.Uri.file(fullFilePath);
                                const position = await getPostionOfSourceDeclaration(filePathUri, targetName);

                                if(position){
                                    openFileOnLeftEditorPane(filePath, position);
                                    return;
                                }
                            }
                }
                }

                return;
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
                const includeDependents = message.value.includeDependents;
                const fullRefresh = message.value.fullRefresh;
                await runCurrentFile(extensionContext, includeDependencies, includeDependents, fullRefresh, "cli");
                return;
              case 'runModelApi':
                const _includeDependencies = message.value.includeDependencies;
                const _includeDependents = message.value.includeDependents;
                const _fullRefresh = message.value.fullRefresh;
                // FIXME: there must be a way to avoid double calls before and after function invocation ?
                let messageDict: WebviewMessage = {
                    "tableOrViewQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.tableOrViewQuery,
                    "assertionQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.assertionQuery,
                    "preOperations": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.preOpsQuery,
                    "postOperations": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.postOpsQuery,
                    "incrementalPreOpsQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.incrementalPreOpsQuery,
                    "incrementalQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.incrementalQuery,
                    "nonIncrementalQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.nonIncrementalQuery,
                    "operationsQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.operationsQuery,
                    "relativeFilePath": this.centerPanel?._cachedResults?.fileMetadata.pathMeta?.relativeFilePath,
                    "errorMessage": this.centerPanel?._cachedResults?.errorMessage,
                    "dryRunStat":  this.centerPanel?._cachedResults?.dryRunStat,
                    "compiledQuerySchema": compiledQuerySchema,
                    "targetTablesOrViews": this.centerPanel?._cachedResults?.targetTablesOrViews,
                    "models": this.centerPanel?._cachedResults?.curFileMeta.fileMetadata.tables,
                    "dependents": this.centerPanel?._cachedResults?.curFileMeta.dependents,
                    "dataformTags": dataformTags,
                    "apiUrlLoading": true,
                };
                this.centerPanel?.webviewPanel.webview.postMessage(messageDict);
                const result = await runCurrentFile(extensionContext, _includeDependencies, _includeDependents, _fullRefresh, "api");
                if(!result){
                    return;
                }
                const {workflowInvocationUrlGCP, errorWorkflowInvocation} = result;
                messageDict = { ...messageDict, "workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation, "apiUrlLoading": false };
                this.centerPanel?.webviewPanel.webview.postMessage(messageDict);
                return;
              case 'costEstimator':

                const selectedTag = message.value.selectedTag;
                if(CACHED_COMPILED_DATAFORM_JSON){
                    logger.debug('Using cached compilation for tag cost estimation');
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
                        "modelType": fileMetadata.queryMeta.type,
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
              case 'lintCurrentFile':
                await vscode.commands.executeCommand('vscode-dataform-tools.lintCurrentFile');
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
                    "modelType": fileMetadata.queryMeta.type,
                });
                return;
            }
            return;
          },
          undefined,
          undefined,
      );

    }


    //@ts-ignore
    private async sendUpdateToView(showCompiledQueryInVerticalSplitOnSave:boolean | undefined, forceShowInVeritcalSplit:boolean, curFileMeta:CurrentFileMetadata|undefined, freshCompilation: boolean = true) {
        const webview = this.webviewPanel.webview;
        const compilerOptions = vscode.workspace.getConfiguration('vscode-dataform-tools').get<string>('compilerOptions');

        if(this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { recompiling: freshCompilation, compilerOptions });
        }

        // Notify webview that we are starting compilation
        if (freshCompilation) {
            await webview.postMessage({
                "recompiling": true,
                "compilerOptions": compilerOptions
            });
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(true);
        }

        if(!curFileMeta){
            await webview.postMessage({
                "errorMessage": `File type not supported. Supported file types are sqlx, js`,
                "recompiling": false
            });
            return;
        }


        if (curFileMeta.isDataformWorkspace===false){
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const currentDirectory = workspaceFolder?.uri.fsPath;
            await webview.postMessage({
                "errorMessage": `${currentDirectory} is not a Dataform workspace. Hint: Open workspace rooted in workflow_settings.yaml or dataform.json`,
                "recompiling": false
            });
            return;
        } else if (curFileMeta?.errors?.errorGettingFileNameFromDocument){
            await webview.postMessage({
                "errorMessage": curFileMeta?.errors?.errorGettingFileNameFromDocument,
                "recompiling": false
            });
        } else if ((curFileMeta?.errors?.fileNotFoundError===true || curFileMeta?.fileMetadata?.tables?.length === 0) && curFileMeta?.pathMeta?.relativeFilePath && curFileMeta?.pathMeta?.extension === "sqlx"){
            const errorMessage = await getFileNotFoundErrorMessageForWebView(curFileMeta?.pathMeta?.relativeFilePath);
            await webview.postMessage({
                "errorMessage": errorMessage,
                "recompiling": false
            });
            return;
        } else if (curFileMeta?.errors?.queryMetaError){
            await webview.postMessage({
                "errorMessage": curFileMeta.errors.queryMetaError,
                "recompiling": false
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
                "errorMessage": errorString,
                "recompiling": false
            });
            return;
        }
        const isJs = curFileMeta && curFileMeta.pathMeta && curFileMeta.pathMeta.extension === "js";
        if((curFileMeta.errors?.fileNotFoundError === true || curFileMeta.fileMetadata?.tables.length === 0 ) &&  isJs){
            if(CompiledQueryPanel && CompiledQueryPanel.centerPanel){
                if(CACHED_COMPILED_DATAFORM_JSON){
                    if (!CACHED_COMPILED_DATAFORM_JSON?.declarations) { return; }
                    const filteredDeclarations = CACHED_COMPILED_DATAFORM_JSON.declarations
                        .filter((declaration) => declaration.fileName === curFileMeta.pathMeta?.relativeFilePath);

                    if(diagnosticCollection){
                        diagnosticCollection.clear();
                    }
                    await webview.postMessage({
                        "declarations": filteredDeclarations,
                        "recompiling": false
                    });
                    return;
                }
            }
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
            "modelType": fileMetadata.queryMeta.type,
            "models": curFileMeta.fileMetadata.tables,
            "recompiling": false,
            "dryRunning": true,
            "declarations": null,
            "compilerOptions": compilerOptions
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
        const [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, incrementalDryRunResult, nonIncrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult] = dryRunResults;


        let currency = "USD" as SupportedCurrency;
        let currencySymbol = "$";

        if(dryRunResult?.statistics?.cost?.currency){
            currency = dryRunResult?.statistics?.cost?.currency as SupportedCurrency;
            currencySymbol = currencySymbolMapping[currency];
        }

        let dryRunStat = "";
        const formatCost = (result: any, type: string) => {
            if(result?.statistics?.cost && result?.error?.hasError === false){
                return (type ? type + ": " : "") + "(" + formatBytes(result?.statistics?.totalBytesProcessed) + " " + currencySymbol + (result?.statistics?.cost?.value.toFixed(3) || "0.00") + ")";
            }
            return "";
        };

        const dryRunResultsMeta: { result: BigQueryDryRunResponse, label: string }[] = [
            { result: dryRunResult, label: "Main query" },
            { result: preOpsDryRunResult, label: fileMetadata.queryMeta.type === "incremental" ? "Non incremental pre operations" : "Pre operations" },
            { result: postOpsDryRunResult, label: "Post operations" },
            { result: incrementalPreOpsDryRunResult, label: "Incremental pre operations" },
            { result: incrementalDryRunResult, label: "Incremental" },
            { result: nonIncrementalDryRunResult, label: "Non incremental" },
            { result: assertionDryRunResult, label: "Assertion" }
        ];

        for (const { result, label } of dryRunResultsMeta) {
            const cost = formatCost(result, label);
            dryRunStat += (cost ? cost + "<br>" : "");
        }


        let errorMessage = (preOpsDryRunResult?.error.message && !errorInPreOpsDenyList ? "(Pre operations): " + preOpsDryRunResult?.error.message + "<br>" : "")
                            + (dryRunResult?.error.message ? "(Main query): " + dryRunResult?.error.message + "<br>" : "")
                            + (postOpsDryRunResult?.error.message ? "(Post operations): " + postOpsDryRunResult?.error.message + "<br>" : "")
                            + (incrementalPreOpsDryRunResult?.error.message ? "(Incremental pre operations): " + incrementalPreOpsDryRunResult?.error.message + "<br>" : "")
                            + (assertionDryRunResult?.error.message ? "(Assertion): " + assertionDryRunResult?.error.message + "<br>" : "")
                            + (incrementalDryRunResult?.error.message ? "(Incremental): " + incrementalDryRunResult?.error.message + "<br>" : "")
                            + (nonIncrementalDryRunResult?.error.message ? "(Non incremental): " + nonIncrementalDryRunResult?.error.message + "<br>" : "");
        errorMessage = errorMessage.replace(/<br><br>/g, "<br>");
        const location = dryRunResult?.location?.toLowerCase();
        if(!errorMessage){
            errorMessage = "";
        } else if (dryRunResult?.error.message.includes("Error creating BigQuery client")){
            errorMessage = dryRunResult?.error.message + "<br>";
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
            dryRunStat = "";
        }

        if (compiledQuerySchema?.fields) {
            const curFileActionDescriptor: ActionDescription = curFileMeta.fileMetadata?.tables[0]?.actionDescriptor;
            // Remove 'mode' attribute from each field
            compiledQuerySchema.fields = compiledQuerySchema.fields.map(({ mode, ...rest }) => rest);

            if (curFileActionDescriptor?.columns) {
                const columnMap = new Map(
                    curFileActionDescriptor.columns.map((column: Column) =>  {
                        //TODO: assumes that there will only be one level of nesting. We can do something dynamically by recursively searching
                        // NOTE: record type columns have their path as [BASE_COLUMN_NAME, NESTED_COLUMN_NAME]. Which is why we have to do column.path[1]
                        if(column.path.length === 2){
                            return [column.path[1], column.description];
                        }
                         return[column.path[0], column.description || ""];
                        })
                );

                compiledQuerySchema.fields.forEach((columnMetadata: ColumnMetadata) => {
                    if(columnMetadata?.name){
                        const description = columnMap.get(columnMetadata.name);
                        if (description !== undefined) {
                            columnMetadata.description = description;
                        }
                    }
                    if (columnMetadata?.fields){
                        columnMetadata?.fields.forEach((columnMetadata: ColumnMetadata) => {
                            if(columnMetadata?.name){
                                const description = columnMap.get(columnMetadata.name);
                                if (description !== undefined) {
                                    columnMetadata.description = description;
                                }
                                compiledQuerySchema?.fields.push(
                                    {
                                        name: columnMetadata.name,
                                        type: columnMetadata.type,
                                        description: columnMetadata.description,
                                    }

                                );
                            }
                        });
                    }
                });
            }
        } else {
            compiledQuerySchema = {fields: [{"name": "", type:""}]};
        }

        columnHoverDescription = {
            ...compiledQuerySchema,
            fields: [...(compiledQuerySchema?.fields || [])]
        };

        schemaAutoCompletions.forEach((column: { name: string; metadata: any }) => {
                columnHoverDescription?.fields.push({
                    name: column.name,
                    type: column.metadata.type,
                    description: column.metadata.description,
                });
        });

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
                "modelType": fileMetadata.queryMeta.type,
                "modelsLastUpdateTimesMeta": modelsLastUpdateTimesMeta,
                "recompiling": false,
                "dryRunning": false,
                "declarations": null,
                "compilerOptions": compilerOptions
            });
            this._cachedResults = { 
                fileMetadata, 
                curFileMeta, 
                targetTablesOrViews, 
                errorMessage, 
                dryRunStat, 
                location, 
                compilerOptions
            };
            declarationsAndTargets = queryAutoCompMeta.declarationsAndTargets;
            return webview;
        }
    }

    private async updateView(forceShowInVeritcalSplit:boolean, currentFileMetadata:any, freshCompilation: boolean = true) {
        const showCompiledQueryInVerticalSplitOnSave:boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        let webview = await this.sendUpdateToView(showCompiledQueryInVerticalSplitOnSave, forceShowInVeritcalSplit, currentFileMetadata, freshCompilation);
        if(webview){
            // this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
        } else {
            // console.log(`Dont show webview`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview, initialState: any = {}) {
        const scriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "preview_compiled.js"));
        const styleUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "preview_compiled.css"));
        const codiconsUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css"));
        const nonce = getNonce();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
            <link href="${styleUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            <title>Compiled Query Preview</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}">
                window.initialState = ${JSON.stringify(initialState)};
            </script>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }



}
