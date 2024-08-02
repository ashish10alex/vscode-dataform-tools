import { commands, ExtensionContext, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import { generateDependancyTreeMetadata } from "../utils";
import { getNonce } from '../utils';
//import * as vscode from 'vscode';

//NOTE: global variables to keep track of treeRoot and direction incase user switches active editor and intends to come back to dependancy tree the web panel
let treeRoot:string;
let direction:string;

/*
export function registerCenterPanel(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('ipoc.show.center.panel', () => {
            CenterPanel.getInstance(context.extensionUri, context);
        })
    );

    context.subscriptions.push(
        commands.registerCommand('ipoc.send.data', (data) => {
            window.showInformationMessage('ipoc.send.data: ' + data.data);
        })
    );
}
*/

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
                enableScripts: true,
                localResourceRoots: [
                    Uri.joinPath(extensionUri, "media")
                ],
            }
        );

        panel.onDidChangeViewState(
            async e => {
                const panel = e.webviewPanel;
                const webview = panel.webview;
                if (panel.visible) {
                    let output = await generateDependancyTreeMetadata();
                    if (!output){
                        return;
                    }
                    let dependancyTreeMetadata = output.dependancyTreeMetadata;
                    let declarationsLegendMetadata = output.declarationsLegendMetadata;
                    if (this.centerPanel) {
                        e.webviewPanel.webview.html = this.centerPanel?._getHtmlForWebview(webview);
                    }
                    let treeRootExsistInLatestCompilation = false;
                    if (treeRoot){
                        for (let i=0; i<dependancyTreeMetadata.length; i++){
                            if (dependancyTreeMetadata[i]._name === treeRoot){
                                treeRootExsistInLatestCompilation = true;
                                await webview.postMessage({ "dataformTreeMetadata": dependancyTreeMetadata, "treeRoot": treeRoot, "direction": direction, "declarationsLegendMetadata":declarationsLegendMetadata  });
                                break;
                            }
                        }
                    }
                    if (!treeRootExsistInLatestCompilation){
                        await webview.postMessage({ "dataformTreeMetadata": dependancyTreeMetadata, "treeRoot": treeRoot, "direction": direction, "declarationsLegendMetadata":declarationsLegendMetadata  });
                    }
                }
            },
            null, // TODO: verify this option
            undefined // TODO: verify this option
        );

        CenterPanel.centerPanel = new CenterPanel(panel, extensionUri, extensionContext);
    }

    private async updateView() {
        const webview = this.webviewPanel.webview;
        let output = await generateDependancyTreeMetadata();
        if (!output){
            return;
        }
        let dependancyTreeMetadata = output.dependancyTreeMetadata;
        let declarationsLegendMetadata = output.declarationsLegendMetadata;

        // TODO: check if treeRoot still exsists in dataformTreeMetadata
        await webview.postMessage({ "dataformTreeMetadata": dependancyTreeMetadata, "treeRoot": treeRoot, "direction": direction, "declarationsLegendMetadata":declarationsLegendMetadata  });
        if (dependancyTreeMetadata.length === 0){
            this.webviewPanel.webview.html = this._getHtmlForWebviewNoTreeMetadata();
        } else {
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);
            this.webviewPanel.webview.onDidReceiveMessage((data) => {
                switch (data.entity) {
                    case 'treeRoot':
                        treeRoot = data.value;
                        return;
                    case 'direction':
                        direction = data.value;
                        return;
                }
            });
        }
    }

    private _getHtmlForWebviewNoTreeMetadata(){
        return `<!DOCTYPE html>
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
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));

        /**Used for searchable dropdowns */
        const jqueryMinified = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "jquery-3.7.1.slim.min.js"));
        const select2MinCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "select2.min.css"));
        const select2MinJs = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "select2.min.js"));

        /**Dependencies for generating the tree using dependtree */
        const d3minJs = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "d3.v7.min.js"));
        const dependTreeScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "dependtree.js"));

        const colorsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "colors.js"));
        const treePanelScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "treePanel.js"));

        const nonce = getNonce();

        return `<!DOCTYPE html>
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
              <link href="${styleResetUri}" rel="stylesheet">
              <link href="${styleVSCodeUri}" rel="stylesheet">
              <script nonce="${nonce}" type="text/javascript" src="${jqueryMinified}"></script>
              <link href="${select2MinCss}" rel="stylesheet">
              <script nonce="${nonce}" type="text/javascript" src="${select2MinJs}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${d3minJs}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${colorsScriptUri}"></script>
           </head>
           <body>

        <h1>Dataform dependancy graph</h1>
        <div id="dataform-stats" style="padding-top: 20px;"></div>

        <div id="svg-legends">
            <p style="color: black; margin-top: 5px; margin-left: 40px;"> <b>Dataset lengend</b> </p>
            <svg id="my-svg"></svg>
        </div>

           <div class="content">
           <form>
            <select id="list" class="tree-metadata-selection"></select>
            <select id="direction" class="tree-direction-selection">
                <option value="downstream">downstream</option>
                <option value="upstream">upstream</option>
            </select>
            </form>
              <body><div style="overflow: auto;" id="tree"></div></body>
              <script nonce="${nonce}" type="text/javascript" src="${dependTreeScriptUri}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${treePanelScriptUri}"></script>
            </div>
           </body>
        </html>`;
    }
}
