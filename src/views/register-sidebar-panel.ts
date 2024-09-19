import { CancellationToken, commands, ExtensionContext, OutputChannel, ProgressLocation, Uri, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext, window, workspace } from "vscode";
import * as vscode from 'vscode';
import { getTableMetadata, getNonce, getFileNameFromDocument } from '../utils';
import { CenterPanel } from "./register-center-panel";
// import { dataformTags } from "../extension";


export async function registerWebViewProvider(context: ExtensionContext) {
    const provider = new SidebarWebViewProvider(context.extensionUri, context);
    context.subscriptions.push(window.registerWebviewViewProvider('dataform-sidebar', provider));

    context.subscriptions.push(commands.registerCommand('vscode-dataform-tools.getTableMetadataForSidePanel', async () => {
        let document = vscode.window.activeTextEditor?.document;
        if(!document){return;}
        var [filename, relativeFilePath, extension] = getFileNameFromDocument(document, true);
        if (!filename || !relativeFilePath || !extension){
          return;
        }
        if (document) {
            let tableMetadata = await getTableMetadata(document, false);
            if (tableMetadata) {
                provider.view?.webview.postMessage({ "tableMetadata": tableMetadata });
            }
        }
    }));


    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            vscode.commands.executeCommand('vscode-dataform-tools.getTableMetadataForSidePanel');
        }
    }, null, context.subscriptions);

}

export class SidebarWebViewProvider implements WebviewViewProvider {
    constructor(private readonly _extensionUri: Uri, public extensionContext: ExtensionContext) { }
    view?: WebviewView;

    resolveWebviewView(webviewView: WebviewView,
        webViewContext: WebviewViewResolveContext,
        token: CancellationToken) {
        this.view = webviewView;

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                vscode.commands.executeCommand('vscode-dataform-tools.getTableMetadataForSidePanel');
            }
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        let isFileOpen = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (isFileOpen) {
            vscode.commands.executeCommand('vscode-dataform-tools.getTableMetadataForSidePanel');
        }

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case "load-dependancy-graph-button": {
                    CenterPanel.getInstance(this.extensionContext.extensionUri, this.extensionContext);
                    break;
                }
            }
        });

    }

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));

        const scriptPanel = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "panel.js"));
        const sidePanelScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "sidePanel.js"));

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
                 script-src 'nonce-${nonce}';">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link href="${styleResetUri}" rel="stylesheet">
              <link href="${styleVSCodeUri}" rel="stylesheet">
           </head>
           <body>
              <h1> Dataform </h1>
              <br>
              <h3 id="loadingMessage"> Loading metadata ... </h3>
              <br>
              <button type="button" class="load-dependancy-graph-button">Load dependancy graph</button><br>
              <script nonce="${nonce}" src="${sidePanelScriptUri}"></script>
              <script nonce="${nonce}" src="${scriptPanel}"></script>
           </body>
        </html>`;
    }
}
