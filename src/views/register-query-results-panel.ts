import * as vscode from 'vscode';
import {  Uri } from "vscode";
import { getNonce } from '../utils';
import { cancelBigQueryJob, queryBigQuery } from '../bigqueryRunQuery';

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private _cachedResults?: { results: any[], jobStats: any };
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

      webviewView.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'cancelBigQueryJob':
                await cancelBigQueryJob();
                cancelBigQueryJobSignal = false;
                return;
              case 'runBigQueryJob':
                await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                return;
            }
          },
          undefined,
          undefined,
      );
    }

    public focusWebview(query:string) {
      this._query = query;
      this._invokedByCommand = true;
      vscode.commands.executeCommand('queryResultsView.focus');
    }

    public async updateContent(query:string) {
    if (!this._view) {
        return;
    }
      try {
          this._view.webview.html = this._getHtmlForWebview(this._view.webview);
          const { results, jobStats } = await queryBigQuery(query);
          if(results){
            this._cachedResults = { results, jobStats };
            this._view.webview.postMessage({"results": results, "jobStats": jobStats });
            //TODO: This needs be before we run the query in backend
            this._view.show(true);
          }else{
            //TODO: even when there is no results we could shows billed bytes 
            this._view.webview.html = this._getHtmlForWebviewNoResultsToDisplay(this._view.webview);
            this._view.show(true);
          }
      } catch (error:any) {
        let errorMessage = error?.message;
        if(errorMessage){
          this._view.webview.html = this._getHtmlForWebviewError(this._view.webview);
          this._view.webview.postMessage({"errorMessage": errorMessage });
          this._view.show(true);
        }
      }
  }

  private _getHtmlForWebviewGeneric(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const showBigQueryGenericScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryGeneric.js"));
    const nonce = getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
      </head>
      <body>
        <div class="beta-button-container">
               <button class="beta-button" disabled>BETA</button>
        </div>
        <p class="top-left">Query results will be dispalyed here</p>
        <button id="runQueryButton" class="runQueryButton" title="Runs current file">RUN</button>
        <script nonce="${nonce}" type="text/javascript" src="${showBigQueryGenericScriptUri}"></script>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewNoResultsToDisplay(webview: vscode.Webview) {
    // TODO: Can we not use external url ?
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const showBigQueryGenericScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryGeneric.js"));
    const nonce = getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">
      </head>
      <body>
        <div class="beta-button-container">
               <button class="beta-button" disabled>BETA</button>
        </div>
        <span class="warning">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
            <path fill="yellow" d="M8 1.45l6.705 13.363H1.295L8 1.45z"/>
            <path fill="black" d="M8 4l4.593 9.186H3.407L8 4z"/>
            <path fill="yellow" d="M7.25 11h1.5v1.5h-1.5V11zm0-5h1.5v4h-1.5V6z"/>
          </svg>
          There is no data to display
        </span>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <script nonce="${nonce}" type="text/javascript" src="${showBigQueryGenericScriptUri}"></script>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewError(webview: vscode.Webview) {
    const showBigQueryErrorScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showBigQueryError.js"));
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const nonce = getNonce();
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetUri}" rel="stylesheet">

      </head>
      <body>
        <div class="beta-button-container">
               <button class="beta-button" disabled>BETA</button>
        </div>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <p class="top-left" style="color: red"><span id="bigqueryerror"></span></p>
        <script nonce="${nonce}" type="text/javascript" src="${showBigQueryErrorScriptUri}"></script>
      </body>
      </html>
    `;
  }



  private _getHtmlForWebview(webview: vscode.Webview) {
      const jqueryMinified = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "deps", "jquery-3.7.1.slim.min.js"));
      const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
      const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
      const nonce = getNonce();

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <script nonce="${nonce}" type="text/javascript" src="${jqueryMinified}"></script>
        <link href="https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator.min.css" rel="stylesheet">
        <script type="text/javascript" src="https://unpkg.com/tabulator-tables@6.2.5/dist/js/tabulator.min.js"></script>
        <link href="${styleResetUri}" rel="stylesheet">
      </head>
      <body>
        <div class="beta-button-container">
               <button class="beta-button" disabled>BETA</button>
        </div>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <button id="cancelBigQueryJobButton" class="cancelBigQueryJobButton">Cancel query</button>
        <p class="top-left">Query results ran at: <span id="datetime"></span></p>
        <table id="example" class="display" width="100%"></table>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </body>
      </html>
    `;
  }
}
