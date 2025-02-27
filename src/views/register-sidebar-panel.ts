import { commands, ExtensionContext, Uri, Webview, WebviewView, WebviewViewProvider, window } from "vscode";
import * as vscode from 'vscode';
import {getNonce, getCurrentFileMetadata } from '../utils';

export async function registerWebViewProvider(context: ExtensionContext) {
    const provider = new SidebarWebViewProvider(context.extensionUri, context);
    context.subscriptions.push(window.registerWebviewViewProvider('dataform-sidebar', provider));

    context.subscriptions.push(commands.registerCommand('vscode-dataform-tools.getCurrFileMetadataForSidePanel', async () => {
        let currFileMetadata = await getCurrentFileMetadata(false);
        if (currFileMetadata) {
            provider.view?.webview.postMessage({ "currFileMetadata": currFileMetadata });
        } else {
            provider.view?.webview.postMessage({ 
                "errorMessage": `File type not supported. Supported file types are sqlx, js`
            });
        }
    }));

    context.subscriptions.push(commands.registerCommand('vscode-dataform-tools.showFileMetadataForSidePanel', async () => {
        vscode.commands.executeCommand('dataform-sidebar.focus');
    }));

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            vscode.commands.executeCommand('vscode-dataform-tools.getCurrFileMetadataForSidePanel');
        }
    }, null, context.subscriptions);
}

export class SidebarWebViewProvider implements WebviewViewProvider {
    constructor(private readonly _extensionUri: Uri, public extensionContext: ExtensionContext) { }
    view?: WebviewView;

    resolveWebviewView(webviewView: WebviewView) {
        this.view = webviewView;

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                vscode.commands.executeCommand('vscode-dataform-tools.getCurrFileMetadataForSidePanel');
            }
        });

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        let isFileOpen = vscode.window.activeTextEditor?.document.uri.fsPath;
        if (isFileOpen) {
            vscode.commands.executeCommand('vscode-dataform-tools.getCurrFileMetadataForSidePanel');
        }
    }

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));

        const scriptPanel = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "panel.js"));
        const sidePanelScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "sidePanel.js"));

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
                 script-src 'nonce-${nonce}';">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link href="${styleResetUri}" rel="stylesheet">
              <link href="${styleVSCodeUri}" rel="stylesheet">
           </head>
           <body>
              <h1> Dataform </h1>
              <br>
              <h3 id="loadingMessage"></h3>
              <br>
              <script nonce="${nonce}" src="${sidePanelScriptUri}"></script>
              <script nonce="${nonce}" src="${scriptPanel}"></script>
           </body>
        </html>`;
    }
}
