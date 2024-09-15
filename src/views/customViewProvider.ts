import * as vscode from 'vscode';
import {  Uri } from "vscode";
import { getFileNameFromDocument, getMetadataForCurrentFile, getNonce, getWorkspaceFolder, runCompilation } from '../utils';
import { queryBigQuery } from '../bigqueryRunQuery';

export class CustomViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}
  
    public async resolveWebviewView(
      webviewView: vscode.WebviewView,
      context: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ) {
      this._view = webviewView;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [this._extensionUri]
      };
      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
      // await this.updateContent();
    }

    public async updateContent() {
      if (!this._view) {
          // TODO: If view does not exsist can we create it ?
          vscode.window.showWarningMessage("Open query editor once");
          return;
      }

    this._view.show(true);
    this._view.webview.html = this._getHtmlForWebview(this._view.webview);

    let document = vscode.window.activeTextEditor?.document;
    if (!document){ return; }
    var [filename, extension] = getFileNameFromDocument(document, false);
    if (!filename || !extension) { return; }

    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) { return; }

    let dataformCompiledJson = await runCompilation(workspaceFolder); // Takes ~1100ms (dataform wt 285 nodes)
    if (!dataformCompiledJson){
        return undefined;
    }
    CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
    let tableMetadata = await getMetadataForCurrentFile(filename, dataformCompiledJson);

    if (!document) {
        vscode.window.showErrorMessage("VS Code document object was undefined");
        return;
    }

    let query = tableMetadata.queryToDryRun;
      try {
          const { columns, results } = await queryBigQuery(query);
          this._view.webview.postMessage({"results": results, "columns": columns});
      } catch (error) {
          console.error(error);
      }
  }
  
    private _getHtmlForWebview(webview: vscode.Webview) {
        const jqueryMinified = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "jquery-3.7.1.slim.min.js"));
        const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
        const nonce = getNonce();

      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Custom View</title>

          <script nonce="${nonce}" type="text/javascript" src="${jqueryMinified}"></script>
          <link rel="stylesheet" href="https://cdn.datatables.net/2.1.4/css/dataTables.dataTables.css" />
          <script src="https://cdn.datatables.net/2.1.4/js/dataTables.js"></script>

        </head>
        <body>
          <h3>Query results</h3>
          <table id="example" class="display" width="100%"></table>
          <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
        </body>
        </html>
      `;
    }
  }