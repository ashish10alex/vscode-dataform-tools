import { CancellationToken, commands, ExtensionContext, OutputChannel, ProgressLocation, Uri, Webview, WebviewView, WebviewViewProvider, WebviewViewResolveContext, window, workspace } from "vscode";
import * as vscode from 'vscode';
import { getTableMetadata } from '../utils';
import { dataformTags } from "../extension";

function getNonce() {
    let text = "";
    const possible =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export async function registerWebViewProvider(context: ExtensionContext) {
    const provider = new SidebarWebViewProvider(context.extensionUri, context);
    context.subscriptions.push(window.registerWebviewViewProvider('dataform-sidebar', provider));

    context.subscriptions.push(commands.registerCommand('vscode-dataform-tools.getTableMetadataForSidePanel', async () => {
        let document = vscode.window.activeTextEditor?.document;
        document = vscode.window.activeTextEditor?.document;
        if (document) {
            let tableMetadata = await getTableMetadata(document);
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
        });

    }

    private _getHtmlForWebview(webview: Webview) {
        const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "reset.css"));
        const scriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "main.js"));
        const styleVSCodeUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "vscode.css"));

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
              <script nonce="${nonce}" src="${scriptUri}"></script>
           </body>
        </html>`;
    }
}
