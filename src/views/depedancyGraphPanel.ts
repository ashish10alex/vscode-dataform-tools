import * as vscode from 'vscode';
import { logger } from '../logger';
import { getNonce, getPostionOfSourceDeclaration, getWorkspaceFolder } from '../utils';
import { generateDependancyTreeMetadata } from '../dependancyTreeNodeMeta';
import path from 'path';

export function getWebViewHtmlContent(context: vscode.ExtensionContext, webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'dependancy_graph.js'));
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
    logger.info('Creating dependency graph panel');
    const output = await generateDependancyTreeMetadata();
    logger.info(`output.currentActiveEditorIdx: ${output?.currentActiveEditorIdx}`);
    if(!output){
        logger.error('No dependency graph data found');
        //TODO: show error message maybe ?
        return;
    }
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
    
    panel.webview.html = getWebViewHtmlContent(context, panel.webview);

    panel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.type) {
                case 'goToBigQuery':
                    const url = message.value.url;
                    if (url) {
                        vscode.env.openExternal(vscode.Uri.parse(url));
                    }
                    break;
                case 'webviewReady':
                    // Send data only after the webview signals it's ready
                    panel.webview.postMessage({
                        type: 'nodeMetadata',
                        value: {
                            initialNodesStatic: output.dependancyTreeMetadata,
                            initialEdgesStatic: output.initialEdgesStatic,
                            datasetColorMap: Object.fromEntries(output.datasetColorMap),
                            currentActiveEditorIdx: output.currentActiveEditorIdx
                        }
                    });
                    break;
                case 'nodeFileName':
                    const filePath = message.value.filePath;
                    const type = message.value.type;
                    if (filePath) {
                        const workspaceFolder = await getWorkspaceFolder();
                        if (workspaceFolder) {
                            const fullFilePath = path.join(workspaceFolder, filePath);
                            const filePathUri = vscode.Uri.file(fullFilePath);
                            const document = await vscode.workspace.openTextDocument(filePathUri);
                            if (type === 'declarations') {
                                const position = await getPostionOfSourceDeclaration(filePathUri, message.value.modelName);
                                if (position) {
                                    vscode.window.showTextDocument(document, vscode.ViewColumn.One, false).then(editor => {
                                        const range = new vscode.Range(position.line, 0, position.line, 0);
                                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                                        editor.selection = new vscode.Selection(position.line, 0, position.line, 0);
                                    });
                                }
                            } else {
                                await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
                            }
                        } else {
                            vscode.window.showErrorMessage('Workspace folder not found');
                        }
                    }
                    return;
            }
        },
        undefined,
        context.subscriptions
    );

    return panel;
}
