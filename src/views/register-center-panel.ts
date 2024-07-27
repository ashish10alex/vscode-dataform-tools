import { commands, ExtensionContext, Uri, ViewColumn, Webview, WebviewPanel, window } from "vscode";
import { generateDependancyTreeMetada } from "../utils";
import { getNonce } from '../utils';
import * as vscode from 'vscode';

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
            "Extension HTML Feature",
            column || ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    Uri.joinPath(extensionUri, "media")
                ],
            }
        );

        CenterPanel.centerPanel = new CenterPanel(panel, extensionUri, extensionContext);
    }

    private async updateView() {
        const webview = this.webviewPanel.webview;
        let document = vscode.window.activeTextEditor?.document;
        if (document){
            let dataformTreeMetadata = await generateDependancyTreeMetada(document);
            webview.postMessage({ "data" : dataformTreeMetadata});
            this.webviewPanel.webview.html = this._getHtmlForWebview(webview);

            this.webviewPanel.webview.onDidReceiveMessage((data) => {
            });
        }
    }

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));
        const scriptUri2 = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "dependtree.js"));
        const treeDataScript = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "royals.js"));
        const mainScript = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "treePanel.js"));

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
              <script nonce="${nonce}"></script>
           </head>
           <body>
           <form>
            <select id="list"></select>
            <select id="direction">
                <option value="downstream">downstream</option>
                <option value="upstream">upstream</option>
            </select>
            </form>
             <p> This is my paragraph</p>
             <body><div style="overflow: auto;" id="tree"></div></body>
              <script nonce="${nonce}" type="text/javascript" src="${scriptUri2}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${treeDataScript}"></script>
              <script nonce="${nonce}" type="text/javascript" src="${mainScript}"></script>
           </body>
        </html>`;
    }
}