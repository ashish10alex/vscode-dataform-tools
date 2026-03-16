import {  ExtensionContext, Uri, WebviewPanel, window } from "vscode";
import * as vscode from 'vscode';
import { compiledQueryWtDryRun, dryRunAndShowDiagnostics, formatBytes, gatherQueryAutoCompletionMeta, getCurrentFileMetadata, getNonce, getTableSchema, getWorkspaceFolder, handleSemicolonPrePostOps, selectWorkspaceFolder, openFileOnLeftEditorPane, findModelFromTarget, getPostionOfSourceDeclaration, showLoadingProgress, executableIsAvailable, readDataformCoreVersion, getRelativePath } from "../utils";
import path from "path";
import { getLiniageMetadata } from "../getLineageMetadata";
import { runCurrentFile } from "../runCurrentFile";
import { runTests } from "../runTests";
import { ColumnMetadata,  Column, ActionDescription, CurrentFileMetadata, SupportedCurrency, BigQueryDryRunResponse, WebviewMessage, WorkflowUrlEntry, CompilationErrorType  } from "../types";
import { currencySymbolMapping, executablesToCheck } from "../constants";
import { costEstimator } from "../costEstimator";
import { getModelLastModifiedTime } from "../bigqueryDryRun";
import { logger } from "../logger";
import { formatCurrentFile } from "../formatCurrentFile";
import * as fs from 'fs';
import { debounce } from "../debounce";
import { DataformTools } from "@ashishalex/dataform-tools";


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

    context.subscriptions.push(
        vscode.commands.registerCommand('vscode-dataform-tools.refreshWorkflowUrls', () => {
            if (CompiledQueryPanel.centerPanel?.webviewPanel) {
                const workflowUrls = context.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                CompiledQueryPanel.centerPanel.webviewPanel.webview.postMessage({
                    workflowUrls: workflowUrls
                });
            }
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
    }, globalThis.DEBOUNCE_WAIT);

    vscode.window.onDidChangeActiveTextEditor(debouncedActiveEditorChange, null, context.subscriptions);


    const debouncedSaveHandler = debounce(async (document: vscode.TextDocument) => {
        const fileExtension = document.fileName.split('.').pop();
        const fileName = path.basename(document.fileName, '.' + fileExtension);
        const isConfigFile = fileName === 'workflow_settings' || fileName === 'dataform' || (fileName === 'package' && fileExtension === 'json');
        
        if (fileExtension && !(fileExtension === 'sqlx' || fileExtension === 'js' || isConfigFile)) {
            return;
        }
        activeEditorFileName = document?.fileName;
        activeDocumentObj = document;
        const showCompiledQueryInVerticalSplitOnSave: boolean | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave || (CompiledQueryPanel?.centerPanel?.centerPanelDisposed === false)) {
            if (CompiledQueryPanel?.centerPanel?.webviewPanel?.visible) {
                const workspaceFolder = await getWorkspaceFolder();
                let dataformCoreVersion = undefined;
                if (workspaceFolder) {
                    dataformCoreVersion = await readDataformCoreVersion(workspaceFolder);
                }
                CompiledQueryPanel?.centerPanel?.webviewPanel?.webview.postMessage({
                    "recompiling": true,
                    "dataformCoreVersion": dataformCoreVersion,
                    "relativeFilePath": getRelativePath(document.fileName),
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
    }, globalThis.DEBOUNCE_WAIT);

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
                if (!currentFileMetadata) {
                    return;
                }

                const isConfigFile = currentFileMetadata.pathMeta && (
                    currentFileMetadata.pathMeta.filename === 'workflow_settings' || 
                    currentFileMetadata.pathMeta.filename === 'dataform' || 
                    (currentFileMetadata.pathMeta.filename === 'package' && currentFileMetadata.pathMeta.extension === 'json')
                );

                if (!isConfigFile && (currentFileMetadata.errors?.errorGettingFileNameFromDocument || !currentFileMetadata.fileMetadata)) {
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
                "Dataform Tools",
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
              case 'copyToClipboard':
                const textToCopy = message.value;
                await vscode.env.clipboard.writeText(textToCopy);
                vscode.window.showInformationMessage('Schema copied to clipboard!');
                return;
              case 'exportSchema':
                const schemaData = message.value;
                const defaultFilename = message.filename || 'schema.json';
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultFilename),
                    filters: {
                        'JSON': ['json']
                    }
                });
                if (uri) {
                    const content = typeof schemaData === 'string' ? schemaData : JSON.stringify(schemaData, null, 2);
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                    vscode.window.showInformationMessage('Schema exported successfully!');
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
                return;
              case 'runTests':
                const _workspaceFolder = message.value.workspaceFolder;
                await runTests(_workspaceFolder);
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
                    "testQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.testQuery,
                    "expectedOutputQuery": this.centerPanel?._cachedResults?.fileMetadata.queryMeta.expectedOutputQuery,
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
                const updatedWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                messageDict = { ...messageDict, "workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation, "apiUrlLoading": false, "workflowUrls": updatedWorkflowUrls };
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
                        "testQuery": fileMetadata.queryMeta.testQuery,
                        "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
                        "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
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
                    "testQuery": fileMetadata.queryMeta.testQuery,
                    "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
                    "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
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
              case 'getWorkflowUrls':
                const currentWorkflowUrls = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];
                this.centerPanel?.webviewPanel.webview.postMessage({
                    workflowUrls: currentWorkflowUrls
                });
                return;
              case 'clearWorkflowUrls':
                await this.centerPanel?.extensionContext.workspaceState.update('dataform_workflow_urls', []);
                this.centerPanel?.webviewPanel.webview.postMessage({
                    workflowUrls: []
                });
                return;
              case 'runFilesTagsWtOptionsApi':
                await vscode.commands.executeCommand('vscode-dataform-tools.runFilesTagsWtOptionsApi');
                return;
              case 'runFilesTagsWtOptionsInRemoteWorkspace':
                await vscode.commands.executeCommand('vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace');
                return;
              case 'refreshWorkflowStatuses':
                const urlsToRefresh = this.centerPanel?.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];

                if (urlsToRefresh.length > 0) {
                    const updatedUrls = await Promise.all(urlsToRefresh.map(async (item) => {
                        if (item.state !== 'SUCCEEDED' && item.state !== 'FAILED' && item.state !== 'CANCELLED' && item.workflowInvocationId && item.projectId && item.location && item.repositoryName) {
                            try {
                                const dataformClient = new DataformTools(item.projectId, item.location);
                                const invocation = await dataformClient.getWorkflowInvocation(item.repositoryName, item.workflowInvocationId);
                                if (invocation && invocation.state) {
                                  item.state = invocation.state as string;
                                }
                            } catch (e: any) {
                                logger.error(`Error fetching workflow invocation status: ${e.message}`);
                            }
                        }
                        return item;
                    }));

                    await this.centerPanel?.extensionContext.workspaceState.update('dataform_workflow_urls', updatedUrls);
                    this.centerPanel?.webviewPanel.webview.postMessage({
                        workflowUrls: updatedUrls
                    });
                }
                return;
              case 'openExternal':
                if(message.url){
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
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
        const workflowUrls = this.extensionContext.workspaceState.get<WorkflowUrlEntry[]>('dataform_workflow_urls') || [];

        const workspaceFolder = await getWorkspaceFolder();
        let dataformCoreVersion = undefined;
        if (workspaceFolder) {
            dataformCoreVersion = await readDataformCoreVersion(workspaceFolder);
        }

        const missingExecutables: string[] = [];
        for (let i = 0; i < executablesToCheck.length; i++) {
            let executable = executablesToCheck[i];
            if (!executableIsAvailable(executable, false)) {
                missingExecutables.push(executable);
            }
        }

        if (missingExecutables.length > 0) {
            if(this.webviewPanel.webview.html === ""){
                this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { missingExecutables, recompiling: false, compilerOptions, dataformCoreVersion });
            } else {
                await webview.postMessage({
                    "missingExecutables": missingExecutables,
                    "recompiling": false,
                    "errorType": CompilationErrorType.MISSING_EXECUTABLE,
                    "isHelperFile": false,
                    "tableOrViewQuery": null,
                    "projectConfig": null,
                    "packageJsonContent": null,
                    "declarations": null,
                    "compiledQuerySchema": null,
                    "dryRunStat": null
                });
            }
            return;
        }

        if(this.webviewPanel.webview.html === ""){
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview, { recompiling: freshCompilation, compilerOptions, dataformCoreVersion });
        }

        // Notify webview that we are starting compilation
        if (freshCompilation) {
            await webview.postMessage({
                "recompiling": true,
                "compilerOptions": compilerOptions,
                "dataformCoreVersion": dataformCoreVersion,
                "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                "workspaceFolder": workspaceFolder,
            });
        }

        if(!curFileMeta){
            curFileMeta = await getCurrentFileMetadata(true);
        }

        if(!curFileMeta){
            await webview.postMessage({
                "errorMessage": `File type not supported. Supported file types are sqlx, js`,
                "recompiling": false,
                "errorType": CompilationErrorType.UNSUPPORTED_FILE_TYPE,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
                "dryRunStat": null
            });
            return;
        }


        if (curFileMeta.isDataformWorkspace===false){
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const currentDirectory = workspaceFolder?.uri.fsPath;
            await webview.postMessage({
                "errorMessage": `${currentDirectory} is not a Dataform workspace. Hint: Open workspace rooted in workflow_settings.yaml or dataform.json`,
                "recompiling": false,
                "errorType": CompilationErrorType.NOT_A_DATAFORM_WORKSPACE,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
                "dryRunStat": null
            });
            return;
        } else if (curFileMeta?.errors?.errorGettingFileNameFromDocument){
            await webview.postMessage({
                "errorMessage": curFileMeta?.errors?.errorGettingFileNameFromDocument,
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
                "dryRunStat": null,
                "workspaceFolder": workspaceFolder,
            });
        } else if ((curFileMeta?.errors?.fileNotFoundError===true || curFileMeta?.fileMetadata?.tables?.length === 0) && curFileMeta?.pathMeta?.relativeFilePath && curFileMeta?.pathMeta?.extension === "sqlx"){
            const workspaceFolder = await getWorkspaceFolder();
            await webview.postMessage({
                "errorType": CompilationErrorType.FILE_NOT_FOUND,
                "relativeFilePath": curFileMeta?.pathMeta?.relativeFilePath,
                "workspaceFolder": workspaceFolder,
                "recompiling": false,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null
            });
            return;
        } else if (curFileMeta?.errors?.queryMetaError){
            await webview.postMessage({
                "errorMessage": curFileMeta.errors.queryMetaError,
                "recompiling": false,
                "errorType": CompilationErrorType.QUERY_META_ERROR,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
                "dryRunStat": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }
        if(curFileMeta.errors?.dataformCompilationErrors){
            let errorString = "<h3>Error compiling Dataform:</h3><ul>";

            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                await webview.postMessage({ "recompiling": false });
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
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "declarations": null,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "compiledQuerySchema": null,
                "dryRunStat": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }

        const isConfigFile = curFileMeta.pathMeta && (
            curFileMeta.pathMeta.filename === 'workflow_settings' || 
            curFileMeta.pathMeta.filename === 'dataform' || 
            (curFileMeta.pathMeta.filename === 'package' && curFileMeta.pathMeta.extension === 'json')
        );

        if (isConfigFile) {
            await webview.postMessage({
                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                "projectConfig": curFileMeta.projectConfig,
                "dataformCoreVersion": curFileMeta.dataformCoreVersion,
                "packageJsonContent": curFileMeta.packageJsonContent,
                "recompiling": false,
                "isHelperFile": false,
                "declarations": null,
                "errorType": null,
                "errorMessage": null,
                "tableOrViewQuery": null,
                "assertionQuery": null,
                "preOperations": null,
                "postOperations": null,
                "incrementalPreOpsQuery": null,
                "incrementalQuery": null,
                "nonIncrementalQuery": null,
                "operationsQuery": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }
        const isJs = curFileMeta && curFileMeta.pathMeta && curFileMeta.pathMeta.extension === "js";
        
        updateSchemaAutoCompletions(curFileMeta);

        if((curFileMeta.errors?.fileNotFoundError === true || curFileMeta.fileMetadata?.tables.length === 0 ) && isJs){
            if(CompiledQueryPanel && CompiledQueryPanel.centerPanel){
                if(CACHED_COMPILED_DATAFORM_JSON){
                    if (CACHED_COMPILED_DATAFORM_JSON?.declarations) { 
                        const filteredDeclarations = CACHED_COMPILED_DATAFORM_JSON.declarations
                            .filter((declaration) => declaration.fileName === curFileMeta.pathMeta?.relativeFilePath);

                        if (filteredDeclarations.length > 0) {
                            if(diagnosticCollection){
                                diagnosticCollection.clear();
                            }
                            await webview.postMessage({
                                "declarations": filteredDeclarations,
                                "recompiling": false,
                                "errorType": null,
                                "errorMessage": null,
                                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                                "isHelperFile": false,
                                "workspaceFolder": workspaceFolder,
                            });
                            return;
                        }
                    }
                    
                    // If it's a JS file but has no tables and no declarations, it's a helper file
                    await webview.postMessage({
                        "isHelperFile": true,
                        "recompiling": false,
                        "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                        "errorType": null,
                        "errorMessage": null,
                        "declarations": null,
                        "tableOrViewQuery": null,
                        "assertionQuery": null,
                        "preOperations": null,
                        "postOperations": null,
                        "incrementalPreOpsQuery": null,
                        "incrementalQuery": null,
                        "nonIncrementalQuery": null,
                        "operationsQuery": null,
                        "workspaceFolder": workspaceFolder,
                    });
                    return;
                }
            }
        }


        const fm = curFileMeta.fileMetadata;
        if (!fm) {
            await webview.postMessage({
                "errorMessage": `Unable to retrieve metadata for this file. Please check if it's a valid Dataform file and ensure the project compiles correctly.`,
                "recompiling": false,
                "errorType": CompilationErrorType.COMPILATION_ERROR,
                "isHelperFile": false,
                "tableOrViewQuery": null,
                "projectConfig": null,
                "packageJsonContent": null,
                "declarations": null,
                "compiledQuerySchema": null,
                "dryRunStat": null,
                "workspaceFolder": workspaceFolder,
            });
            return;
        }

        let fileMetadata = handleSemicolonPrePostOps(fm);
        let targetTablesOrViews = fm.tables;

        await webview.postMessage({
            "tableOrViewQuery": fileMetadata.queryMeta.tableOrViewQuery,
            "assertionQuery": fileMetadata.queryMeta.assertionQuery,
            "preOperations": fileMetadata.queryMeta.preOpsQuery,
            "postOperations": fileMetadata.queryMeta.postOpsQuery,
            "incrementalPreOpsQuery": fileMetadata.queryMeta.incrementalPreOpsQuery,
            "incrementalQuery": fileMetadata.queryMeta.incrementalQuery,
            "nonIncrementalQuery": fileMetadata.queryMeta.nonIncrementalQuery,
            "operationsQuery": fileMetadata.queryMeta.operationsQuery,
            "testQuery": fileMetadata.queryMeta.testQuery,
            "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
            "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
            "lineageMetadata": curFileMeta.lineageMetadata,
            "compilationTimeMs": curFileMeta.compilationTimeMs,
            "compiledQuerySchema": compiledQuerySchema,
            "targetTablesOrViews": targetTablesOrViews,
            "dependents": curFileMeta.dependents,
            "dataformTags": dataformTags,
            "modelType": fileMetadata.queryMeta.type,
            "models": fm.tables,
            "recompiling": false,
            "dryRunning": true,
            "declarations": null,
            "compilerOptions": compilerOptions,
            "workflowUrls": workflowUrls,
            "errorType": null,
            "errorMessage": null,
            "dataformCoreVersion": curFileMeta.dataformCoreVersion,
            "packageJsonContent": curFileMeta.packageJsonContent,
            "isHelperFile": false,
            "workspaceFolder": workspaceFolder,
    });

        if(diagnosticCollection){
            diagnosticCollection.clear();
        }

        let queryAutoCompMeta = await gatherQueryAutoCompletionMeta();
        if (!queryAutoCompMeta || !curFileMeta.document || !targetTablesOrViews){
            await webview.postMessage({
                "recompiling": false,
                "dryRunning": false,
            });
            return;
        }

        // Filter out test nodes as they don't have a table to check last modified time for
        const tablesForLastModified = targetTablesOrViews.filter(table => table.type !== "test");

        const [dryRunResults, modelsLastUpdateTimesMeta] = await Promise.all([
            dryRunAndShowDiagnostics(curFileMeta, curFileMeta.document, diagnosticCollection, false),
            tablesForLastModified.length > 0 ? getModelLastModifiedTime(tablesForLastModified.map((table) => table.target)) : Promise.resolve([])
        ]);
        const [dryRunResult, preOpsDryRunResult, postOpsDryRunResult, incrementalDryRunResult, nonIncrementalDryRunResult, incrementalPreOpsDryRunResult, assertionDryRunResult, testDryRunResult, expectedOutputDryRunResult] = dryRunResults;


        let currency = "USD" as SupportedCurrency;
        let currencySymbol = "$";

        if(dryRunResult?.statistics?.cost?.currency){
            currency = dryRunResult?.statistics?.cost?.currency as SupportedCurrency;
            currencySymbol = currencySymbolMapping[currency];
        }

        let dryRunStat = "";
        const formatCost = (result: any, type: string) => {
            if(result?.statistics?.cost && result?.error?.hasError === false){
                if (result.statistics.statementType === 'SCRIPT' && result.statistics.totalBytesProcessedAccuracy !== 'PRECISE') {
                    return (type ? type + ": " : "") + "NOTE: Could not compute bytes processed estimate for script.";
                }
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
            { result: assertionDryRunResult, label: "Assertion" },
            { result: testDryRunResult, label: "Input Query" },
            { result: expectedOutputDryRunResult, label: "Expected Output Query" }
        ];

        for (const { result, label } of dryRunResultsMeta) {
            const cost = formatCost(result, label);
            dryRunStat += (cost ? cost + "<br>" : "");
        }


        let errorMessage = (preOpsDryRunResult?.error.message && !globalThis.errorInPreOpsDenyList ? "(Pre operations): " + preOpsDryRunResult?.error.message + "<br>" : "")
                            + (dryRunResult?.error.message ? "(Main query): " + dryRunResult?.error.message + "<br>" : "")
                            + (postOpsDryRunResult?.error.message ? "(Post operations): " + postOpsDryRunResult?.error.message + "<br>" : "")
                            + (incrementalPreOpsDryRunResult?.error.message ? "(Incremental pre operations): " + incrementalPreOpsDryRunResult?.error.message + "<br>" : "")
                            + (assertionDryRunResult?.error.message ? "(Assertion): " + assertionDryRunResult?.error.message + "<br>" : "")
                            + (incrementalDryRunResult?.error.message ? "(Incremental): " + incrementalDryRunResult?.error.message + "<br>" : "")
                            + (nonIncrementalDryRunResult?.error.message ? "(Non incremental): " + nonIncrementalDryRunResult?.error.message + "<br>" : "")
                            + (testDryRunResult?.error.message ? "(Input Query): " + testDryRunResult?.error.message + "<br>" : "")
                            + (expectedOutputDryRunResult?.error.message ? "(Expected Output Query): " + expectedOutputDryRunResult?.error.message + "<br>" : "");
        errorMessage = errorMessage.replace(/<br><br>/g, "<br>");
        const location = dryRunResult?.location?.toLowerCase();
        if(!errorMessage){
            errorMessage = "";
        }
        if(!dryRunStat){
            dryRunStat = "";
        }

        if (compiledQuerySchema?.fields) {
            const curFileActionDescriptor: ActionDescription | undefined = curFileMeta.fileMetadata?.tables[0]?.actionDescriptor;
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
                "testQuery": fileMetadata.queryMeta.testQuery,
                "expectedOutputQuery": fileMetadata.queryMeta.expectedOutputQuery,
                "relativeFilePath": curFileMeta.pathMeta?.relativeFilePath,
                "lineageMetadata": curFileMeta.lineageMetadata,
                "compilationTimeMs": curFileMeta.compilationTimeMs,
                "errorMessage": errorMessage,
                "dryRunStat":  dryRunStat,
                "testDryRunResult": testDryRunResult,
                "expectedOutputDryRunResult": expectedOutputDryRunResult,
                "currencySymbol": currencySymbol,
                "compiledQuerySchema": compiledQuerySchema,
                "targetTablesOrViews": targetTablesOrViews,
                "models": curFileMeta.fileMetadata?.tables,
                "dependents": curFileMeta.dependents,
                "dataformTags": dataformTags,
                "modelType": fileMetadata.queryMeta.type,
                "modelsLastUpdateTimesMeta": modelsLastUpdateTimesMeta,
                "recompiling": false,
                "dryRunning": false,
                "declarations": null,
                "compilerOptions": compilerOptions,
                "workflowUrls": workflowUrls,
                "errorType": null,
                "projectConfig": curFileMeta.projectConfig,
                "dataformCoreVersion": curFileMeta.dataformCoreVersion,
                "packageJsonContent": curFileMeta.packageJsonContent,
                "isHelperFile": false
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
        const nonce = getNonce();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
            <link href="${styleUri}" rel="stylesheet">
            <title>Dataform Tools</title>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}">
                window.initialState = ${JSON.stringify(initialState).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
            </script>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }



}
