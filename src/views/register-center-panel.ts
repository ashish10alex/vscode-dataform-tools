import { commands, ExtensionContext, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import { generateDependancyTreeMetada } from "../utils";
import { getNonce } from '../utils';
//import * as vscode from 'vscode';

// global variables to keep track of treeRoot and direction incase user switches active editor and intends to come back to dependancy tree the web panel
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
                    let dataformTreeMetadata = await generateDependancyTreeMetada();
                    // TODO: check if treeRoot still exsists in dataformTreeMetadata
                    await webview.postMessage({ "dataformTreeMetadata": dataformTreeMetadata, "treeRoot": treeRoot, "direction": direction });
                    if (this.centerPanel) {
                        e.webviewPanel.webview.html = this.centerPanel?._getHtmlForWebview(webview);
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
        let dataformTreeMetadata = await generateDependancyTreeMetada();
        // TODO: check if treeRoot still exsists in dataformTreeMetadata
        await webview.postMessage({ "dataformTreeMetadata": dataformTreeMetadata, "treeRoot": treeRoot, "direction": direction });
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

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));
        const scriptUri2 = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "dependtree.js"));
        const mainScript = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "treePanel.js"));
        const jqueryMinified = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "jquery-3.7.1.slim.min.js"));
        const select2MinJs = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "select2.min.js"));
        const select2MinCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "select2.min.css"));

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
           </head>
           <body>
           <form>
            <select id="list" class="tree-metadata-selection"></select>
            <select id="direction" class="tree-direction-selection">
                <option value="downstream">downstream</option>
                <option value="upstream">upstream</option>
            </select>
            </form>
              <body><div style="overflow: auto;" id="tree"></div></body>
              <script nonce="${nonce}" type="text/javascript" src="${scriptUri2}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${mainScript}"></script>
           </body>
        </html>`;
    }
}
