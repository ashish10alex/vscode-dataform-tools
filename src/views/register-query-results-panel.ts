import * as vscode from 'vscode';
import {  Uri } from "vscode";
import { getCurrentFileMetadata, getHighlightJsThemeUri, getNonce } from '../utils';
import { cancelBigQueryJob, queryBigQuery } from '../bigqueryRunQuery';
import { QueryWtType } from '../types';

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private queryType: string = "";
    private _cachedResults?: { results: any[] | undefined, columns:any | undefined, jobStats: any, query:string|undefined };
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
        if(this._query){
          await this.updateContent({query: this._query, type:this.queryType});
        }
      }else {
        let curFileMeta = await getCurrentFileMetadata(false);
        let type = curFileMeta?.fileMetadata?.queryMeta.type;
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        this._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox });
      }

      webviewView.onDidChangeVisibility(async() => {
        // TODO: check if we can handle the query execution and hiding and unhiding of panel separately
        if (webviewView.visible && this._cachedResults) {
          this._view?.webview.postMessage(this._cachedResults);
        } else {
          let curFileMeta = await getCurrentFileMetadata(false);
          let type = curFileMeta?.fileMetadata?.queryMeta.type;
          this._view?.webview.postMessage({"type": type, "incrementalCheckBox": incrementalCheckBox});
        }
      });

      webviewView.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'cancelBigQueryJob':
                let resp = await cancelBigQueryJob();
                cancelBigQueryJobSignal = false;
                if (resp.cancelled && this._view){
                  this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                  this._view.webview.postMessage({"bigQueryJobId": resp.bigQueryJobId, "bigQueryJobCancelled": true});
                  this._view.show(true);
                }
                return;
              case 'runBigQueryJob':
                await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                return;
              case 'queryLimit':
                if (message.value){
                  queryLimit = message.value;
                }
              case 'incrementalCheckBox':
                incrementalCheckBox = message.value;
                return;
            }
          },
          undefined,
          undefined,
      );
    }

    public focusWebview(queryWtType:QueryWtType) {
      this._query = queryWtType.query;
      this._invokedByCommand = true;
      this.queryType = queryWtType.type;
      vscode.commands.executeCommand('queryResultsView.focus');
    }

    public async updateContent(queryWtType:QueryWtType) {
    let query = queryWtType.query;
    let type = queryWtType.type;
    if (!this._view) {
        return;
    }
      try {
          this._view.webview.html = this._getHtmlForWebview(this._view.webview);
          this._view.webview.postMessage({"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox });
          const { results, columns, jobStats, errorMessage } = await queryBigQuery(query);
          if(results && !errorMessage){
            this._cachedResults = { results, columns, jobStats, query };
            this._view.webview.postMessage({"results": results, "columns": columns, "jobStats": jobStats, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox });
            //TODO: This needs be before we run the query in backend
            this._view.show(true);
          } else if (!errorMessage){
            //TODO: even when there is no results we could shows billed bytes 
            this._cachedResults = { results, columns, jobStats, query };
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            this._view.webview.postMessage({"noResults": true, "query": query, "type":type, "jobStats": jobStats, "incrementalCheckBox": incrementalCheckBox });
            this._view.show(true);
          } else if(errorMessage){
            this._view.webview.html = this._getHtmlForWebview(this._view.webview);
            this._view.webview.postMessage({"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox });
            this._view.show(true);
          }
      } catch (error:any) {
        let errorMessage = error?.message;
        if(errorMessage){
          this._view.webview.html = this._getHtmlForWebview(this._view.webview);
          this._view.webview.postMessage({"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox });
          this._view.show(true);
        }
      }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const customTabulatorCss = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "tabulator_custom.css"));
    const nonce = getNonce();
    // TODO: light theme does not seem to get picked up
    let highlighJstThemeUri = getHighlightJsThemeUri();

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" href="${cdnLinks.highlightJsCssUri}">
          <script src="${cdnLinks.highlightJsUri}"></script>
          <script src="${cdnLinks.highlightJsCopyExtUri}"></script>
          <link rel="stylesheet" href="${cdnLinks.highlightJsCopyExtCssUri}" />
          <link rel="stylesheet" href="${highlighJstThemeUri}">

          <link href="${cdnLinks.tabulatorCssUri}" rel="stylesheet">
          <script type="text/javascript" src="${cdnLinks.tabulatorUri}"></script>

          <link href="${styleResetUri}" rel="stylesheet">
          <link href="${customTabulatorCss}" rel="stylesheet">
      </head>

      <body>

      <div class="topnav">
        <a class="active" href="#results">Results</a>
        <a href="#query">Query</a>
      </div>

      <div class="beta-button-container">
        <button class="beta-button" disabled>BETA</button>
      </div>

      <span class="bigquery-job-cancelled"></span>

      <div id="incrementalCheckBoxDiv" style="display: none;" >
        <label class="checkbox-container">
                <input type="checkbox" id="incrementalCheckbox" class="checkbox"> 
                <span class="custom-checkbox"></span>
                Incremental
        </label>
      </div>

      <select id="queryLimit">
        <option value="1000" selected>Limit: 1000</option>
        <option value="2000">Limit: 2000</option>
        <option value="5000">Limit: 5000</option>
      </select>

      <button id="runQueryButton" class="runQueryButton">RUN</button>
      <button id="cancelBigQueryJobButton" class="cancelBigQueryJobButton">Cancel query</button>

      <p>
      <span id="datetime"></span>
      <span id="bigQueryJobLinkDivider"></span>
      <a id="bigQueryJobLink" href="" target="_blank"></a>
      </p>

      <div class="error-message-container" id="errorsDiv" style="display: none;" >
          <p><span id="errorMessage"></span></p>
      </div>

      <div class="no-errors-container" id="noResultsDiv" style="display: none;" >
          <p><span id="noResults"></span></p>
      </div>

      <div id="codeBlock" style="display: none;">
        <pre><code  id="sqlCodeBlock" class="language-sql"></code></pre>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </div>

      <div id="resultBlock" style="height: 400px;">
        <p  style="color: red"><span id="bigqueryerror"></span></p>
        <table id="bigqueryResults" class="display" width="100%"></table>
      </div>

      </body>
      </html>
    `;
  }

}
