import { commands, ExtensionContext, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import { getTreeRootFromRef, getWorkspaceFolder, getPostionOfSourceDeclaration, getCurrentFileMetadata } from "../utils";
import { getNonce, getLineUnderCursor } from '../utils';
import * as vscode from 'vscode';
import path from 'path';
import { generateDependancyTreeMetadata } from "../dependancyTree";

//NOTE: global variables to keep track of treeRoot and direction incase user switches active editor and intends to come back to dependancy tree the web panel
let treeRoot: string;
let treeRootFromRef: string | undefined;
let direction: string;

export function registerCenterPanel(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('vscode-dataform-tools.showDependentsInGraph', async() => {

            let line = getLineUnderCursor();

            if (!line || line.indexOf("${ref(") === -1) {
                vscode.window.showWarningMessage("Could not determine tree root || Expects reference to be in the format ${ref('table_name')}");
                return;
            }

            let _treeRootFromRef = await getTreeRootFromRef();

            if (!_treeRootFromRef) {
                vscode.window.showErrorMessage("Could not determine tree root || Expects reference to be in the format ${ref('table_name')}");
                return;
            }

            //FIX: This now needs to be `project.database.table`
            treeRootFromRef = _treeRootFromRef;
            direction = "downstream";

            CenterPanel.getInstance(context.extensionUri, context);
        })
    );
}

export class CenterPanel {
    public static centerPanel: CenterPanel | undefined;
    private static readonly viewType = "CenterPanel";
    private constructor(public readonly webviewPanel: WebviewPanel, private readonly _extensionUri: Uri, public extensionContext: ExtensionContext) {
        this.updateView();
    }

    public static getInstance(extensionUri: Uri, extensionContext: ExtensionContext) {
        const column = window.activeTextEditor
            ? window.activeTextEditor.viewColumn
            : undefined;

        // NOTE: When kept in this complains that webview is already disposed on second invocation
        // if (CenterPanel.centerPanel) {
        //     CenterPanel.centerPanel.webviewPanel.reveal(column);
        //     CenterPanel.centerPanel.updateView();
        //     return;
        // }

        const panel = window.createWebviewPanel(
            CenterPanel.viewType,
            "Dataform dependancy tree",
            column || ViewColumn.One,
            {
                enableFindWidget: true,
                retainContextWhenHidden: true,
                enableScripts: true,
                localResourceRoots: [
                    Uri.joinPath(extensionUri, "media")
                ],
            }
        );

        CenterPanel.centerPanel = new CenterPanel(panel, extensionUri, extensionContext);
    }

    private async updateView() {

        // Use current table/view created by current file as root
        if (treeRootFromRef){
            treeRoot = treeRootFromRef;
        }

        if (!treeRootFromRef) {
            let curFileMeta = await getCurrentFileMetadata(false);
            if (curFileMeta?.fileMetadata) {
                let treeRootTarget = curFileMeta.fileMetadata?.tables[0]?.target;
                treeRoot = `${treeRootTarget?.database}.${treeRootTarget?.schema}.${treeRootTarget?.name}`;
            }
        }
        treeRootFromRef = undefined;

        const webview = this.webviewPanel.webview;
        let output = await generateDependancyTreeMetadata();
        if (!output) {
            return;
        }
        let dependancyTreeMetadata = output.dependancyTreeMetadata;
        let declarationsLegendMetadata = output.declarationsLegendMetadata;

        // TODO: check if treeRoot still exsists in dataformTreeMetadata
        await webview.postMessage({ "dataformTreeMetadata": dependancyTreeMetadata, "treeRoot": treeRoot, "direction": direction, "declarationsLegendMetadata": declarationsLegendMetadata, "dataformTags": dataformTags  });

        if (dependancyTreeMetadata.length === 0) {
            this.webviewPanel.webview.html = this._getHtmlForWebviewNoTreeMetadata();
        } else {
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
            this.webviewPanel.webview.onDidReceiveMessage(async (data) => {
                switch (data.entity) {
                    case 'treeRoot':
                        treeRoot = data.value;
                        return;
                    case 'openNodeSource':
                        let filePath = data.value._fileName;
                        let _schema_idx = data.value._schema;
                        let workspaceFolder = getWorkspaceFolder();
                        if (!workspaceFolder){return;}
                        let fullSourcePath = path.join(workspaceFolder, filePath);
                        let sourcesJsUri = vscode.Uri.file(fullSourcePath);

                        //_schema_idx 0 is reserved for nodes generated by Dataform pipeline
                        if (_schema_idx === 0){
                            await vscode.window.showTextDocument(sourcesJsUri);
                        }else{
                            let _name = data.value._name;
                            let tableName = _name.split('.').pop();
                            let sourcePosition = await getPostionOfSourceDeclaration(sourcesJsUri, tableName);
                            if(sourcePosition){
                                vscode.window.showTextDocument(sourcesJsUri).then(editor => {
                                    editor.selection = new vscode.Selection(sourcePosition, sourcePosition);
                                    editor.revealRange(new vscode.Range(sourcePosition, sourcePosition));
                                });
                            }
                        }
                        return;
                    case 'direction':
                        direction = data.value;
                        return;
                }
            });
        }
    }

    private _getHtmlForWebviewNoTreeMetadata() {
        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body>
        <h3>No nodes to create compilation graph or you have a compilation error<h3>
        <p>Please run "dataform compile" to check for errors</p>
        </body>
        </html>`;

    }

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));

        /**Used for searchable dropdowns */
        const jqueryMinified = "https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js";
        const select2MinCss = "https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css";
        const select2MinJs = "https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js";

        /**Dependencies for generating the tree using dependtree */
        const d3minJs = "https://cdn.jsdelivr.net/npm/d3@7";
        const dependTreeScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "dependtree.js"));

        const colorsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "colors.js"));
        const treePanelScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "treePanel.js"));

        const nonce = getNonce();

        return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
            <head>
              <meta charset="UTF-8">
              <!--
                 Use a content security policy to only allow loading images from https or from our extension directory,
                 and only allow scripts that have a specific nonce.
                 -->
              <meta http-equiv="Content-Security-Policy"
               content="
                 img-src ${webview.cspSource}
                 style-src ${webview.cspSource}
                 script-src 'nonce-${nonce}';">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link href="${styleVSCodeUri}" rel="stylesheet">
              <script src="${jqueryMinified}"></script>
              <link href="${select2MinCss}" rel="stylesheet" />
              <script src="${select2MinJs}"></script>
              <script src="${d3minJs}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${colorsScriptUri}"></script>
              <link href="${styleResetUri}" rel="stylesheet">
           </head>
           <body>

        <div class="container">
            <div class="navbar">
                <button class="toggle-btn" onclick="toggleNavbar()">☰</button>
                <div class="navbar-content" id="navbar-content">
                    <p style="color: black; margin-top: 5px; margin-left: 40px;"><b>Dataset legend</b></p>
                    <svg id="my-svg"></svg>
                </div>
            </div>

           <div class="content">

            <h1>Dataform dependancy graph</h1>
            <div id="dataform-stats" style="padding-top: 20px;"></div>

            <div style="padding-bottom: 2px;">
                <p>Click node to expand graph or click on text object to navigate file to where the node is defined</p>
            </div>

                <div class="button-container">
                    <button id="expandAll">expand all</button>
                    <button id="collapseAll">collapse all</button>
                </div>

            <form>
                <select id="list" class="tree-metadata-selection">
                    <option disabled selected>Root Node</option>
                </select>

                <select id="tags" class="tree-tags-selection">
                    <option disabled selected>Tags</option>
                    <option value="__all__">all</option>
                </select>

                <select id="direction" class="tree-direction-selection">
                    <option disabled selected>Direction</option>
                    <option value="downstream">downstream</option>
                    <option value="upstream">upstream</option>
                </select>

                </form>

                <body><div style="overflow: auto;" id="tree"></div></body>
                <script nonce="${nonce}" type="text/javascript" src="${dependTreeScriptUri}"></script>
                <script nonce="${nonce}" type="text/javascript" src="${treePanelScriptUri}"></script>
                </div>
           </div>
           </body>
        </html>`;
    }
}
