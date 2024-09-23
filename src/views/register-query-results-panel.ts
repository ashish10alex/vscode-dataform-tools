import * as vscode from 'vscode';
import {  Uri } from "vscode";
import { getCurrentFileMetadata, getFileNameFromDocument, getMetadataForCurrentFile, getNonce, getWorkspaceFolder, runCompilation } from '../utils';
import { queryBigQuery } from '../bigqueryRunQuery';

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private _cachedResults?: { results: any[], columns: any[] };
    private _query?:string;

    constructor(private readonly _extensionUri: vscode.Uri) {}
  
    public async resolveWebviewView(
      webviewView: vscode.WebviewView,
      context: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ) {
      this._view = webviewView;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(this._extensionUri, "media")]
      };

      if (this._invokedByCommand){
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        //TODO: check this
        if(this._query){
          await this.updateContent(this._query);
        }
      }else {
        webviewView.webview.html = this._getHtmlForWebviewGeneric(webviewView.webview);
      }

      webviewView.onDidChangeVisibility(() => {
        // TODO: check if we can handle the query execution and hiding and unhiding of panel separately
        if (webviewView.visible && this._cachedResults) {
          this._view?.webview.postMessage(this._cachedResults);
        }
      });
    }

    public focusWebview(query:string) {
      this._query = query;
      this._invokedByCommand = true;
      vscode.commands.executeCommand('queryResultsView.focus');
    }

    public async updateContent(query:string) {
    if (!this._view) {
        vscode.window.showErrorMessage("Query panel does not exsist");
        return;
    }
      try {
          this._view.webview.html = this._getHtmlForWebview(this._view.webview);
          const { columns, results } = await queryBigQuery(query);
          if(columns && results){
            this._cachedResults = { results, columns };
            this._view.webview.postMessage({"results": results, "columns": columns});
            //TODO: This needs be before we run the query in backend
            this._view.show(true);
          }else{
            this._view.webview.html = this._getHtmlForWebviewNoResultsToDisplay(this._view.webview);
            this._view.show(true);
          }
      } catch (error) {
          console.error(error);
      }
  }

  private _getHtmlForWebviewGeneric(webview: vscode.Webview) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body>
        <p>Query results will be dispalyed here</p>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewNoResultsToDisplay(webview: vscode.Webview) {
    // TODO: Can we not use external url ?
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body>
        <span class="warning">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
            <path fill="yellow" d="M8 1.45l6.705 13.363H1.295L8 1.45z"/>
            <path fill="black" d="M8 4l4.593 9.186H3.407L8 4z"/>
            <path fill="yellow" d="M7.25 11h1.5v1.5h-1.5V11zm0-5h1.5v4h-1.5V6z"/>
          </svg>
          There is no data to display
        </span>
      </body>
      </html>
    `;
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

        <script nonce="${nonce}" type="text/javascript" src="${jqueryMinified}"></script>
        <link href="https://cdn.datatables.net/v/dt/dt-2.1.6/r-3.0.3/datatables.min.css" rel="stylesheet">
        <script src="https://cdn.datatables.net/v/dt/dt-2.1.6/r-3.0.3/datatables.min.js"></script>

      </head>
      <body>
        <p>Query results ran at: <span id="datetime"></span></p>
        <table id="example" class="display" width="100%"></table>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </body>
      </html>
    `;
  }
}
