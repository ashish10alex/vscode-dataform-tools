import * as vscode from 'vscode';
import { getNonce } from '../utils';
import { generateDependancyTreeMetadata } from '../dependancyTreeNodeMeta';

export function getWebViewHtmlContent(context: vscode.ExtensionContext, webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js'));
    const nonce = getNonce();
  
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-eval'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https:;">
        <title>My Extension</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }


export async function createDependencyGraphPanel(context: vscode.ExtensionContext, viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside) {
    const panel = vscode.window.createWebviewPanel(
        "Dependency Graph",
        "Dependency Graph",
        viewColumn,
        {
            enableFindWidget: true,
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(context.extensionUri, "dist")
            ],
        },
    );
    
    const output = await generateDependancyTreeMetadata();
    panel.webview.html = getWebViewHtmlContent(context, panel.webview);

    // Handle messages from webview
    // panel.webview.onDidReceiveMessage(
    //     message => {
    //         switch (message.type) {
    //             case 'fromWebview':
    //                 vscode.window.showInformationMessage(message.value);
    //                 return;
    //         }
    //     },
    //     undefined,
    //     context.subscriptions
    // );

    // TODO: We will be generating the node metadata from the dataform json file
    setTimeout(() => {
        panel.webview.postMessage({
            type: 'nodeMetadata',
            value: {
                initialNodesStatic: output.dependancyTreeMetadata,
                initialEdgesStatic: output.initialEdgesStatic,
                datasetColorMap: Object.fromEntries(output.datasetColorMap),
                currentActiveEditorIdx: output.currentActiveEditorIdx
            }
        });
    }, 500);

    return panel;
}
