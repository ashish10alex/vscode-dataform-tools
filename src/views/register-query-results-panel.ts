import * as vscode from 'vscode';
import {  Uri } from "vscode";
import { getNonce } from '../utils';
import { cancelBigQueryJob, queryBigQuery } from '../bigqueryRunQuery';

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private _cachedResults?: { results: any[], columns:any, jobStats: any };
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
                let resp = await cancelBigQueryJob();
                cancelBigQueryJobSignal = false;
                if (resp.cancelled && this._view){
                  this._view.webview.html = this._getHtmlForWebviewJobCancelled(this._view.webview);
                  this._view.webview.postMessage({"bigQueryJobId": resp.bigQueryJobId});
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
          const { results, columns, jobStats } = await queryBigQuery(query);
          if(results){
            this._cachedResults = { results, columns, jobStats };
            this._view.webview.postMessage({"results": results, "columns": columns, "jobStats": jobStats });
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
          this._view.webview.postMessage({"errorMessage": errorMessage, "query": query });
          this._view.show(true);
        }
      }
  }

  private _getHtmlForWebviewGeneric(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
    const nonce = getNonce();
    return /*html*/ `
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
        <select id="queryLimit">
          <option value="1000" selected>Limit: 1000</option>
          <option value="2000">Limit: 2000</option>
          <option value="5000">Limit: 5000</option>
        </select>
        <button id="runQueryButton" class="runQueryButton" title="Runs current file">RUN</button>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewJobCancelled(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
    const nonce = getNonce();
    return /*html*/ `
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
        <span class="bigquery-job-cancelled"></span>
        <select id="queryLimit">
          <option value="1000" selected>Limit: 1000</option>
          <option value="2000">Limit: 2000</option>
          <option value="5000">Limit: 5000</option>
        </select>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewNoResultsToDisplay(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const showBigQueryGenericScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryGeneric.js"));
    const nonce = getNonce();
    return /*html*/ `
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
        <span class="warning">❕ There is no data to display</span>
        <select id="queryLimit">
          <option value="1000" selected>Limit: 1000</option>
          <option value="2000">Limit: 2000</option>
          <option value="5000">Limit: 5000</option>
        </select>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <script nonce="${nonce}" type="text/javascript" src="${showBigQueryGenericScriptUri}"></script>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebviewError(webview: vscode.Webview) {
    const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
    const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
    const nonce = getNonce();
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/default.min.css">
          <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
          <script src="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.js"></script>
          <link rel="stylesheet" href="https://unpkg.com/highlightjs-copy/dist/highlightjs-copy.min.css" />
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
          <script src="https://cdn.jsdelivr.net/npm/highlightjs-line-numbers.js/dist/highlightjs-line-numbers.min.js"></script>
          <link href="${styleResetUri}" rel="stylesheet">
          <style>
      </style>
      </head>
      <body>
      <div class="topnav">
        <a class="active" href="#results">Results</a>
        <a href="#query">Query</a>
      </div>
      <script>
        // Get all navigation links
        const navLinks = document.querySelectorAll('.topnav a');

        // Add click event listener to each link
        navLinks.forEach(link => {
          link.addEventListener('click', function(e) {
            // Remove active class from all links
            navLinks.forEach(link => link.classList.remove('active'));
            
            // Add active class to clicked link
            this.classList.add('active');
            console.log(this);
            if (this.getAttribute('href') === '#results') {
            document.getElementById("resultBlock").style.display = "";
            document.getElementById("codeBlock").style.display = "none";
            } else {
            document.getElementById("codeBlock").style.display = "";
            document.getElementById("resultBlock").style.display = "none";
            }
          });
        });

        // Set initial active link (optional)
        document.querySelector('.topnav a').classList.add('active');
      </script>

          <div class="beta-button-container">
            <button class="beta-button" disabled>BETA</button>
          </div>
          <select id="queryLimit">
            <option value="1000" selected>Limit: 1000</option>
            <option value="2000">Limit: 2000</option>
            <option value="5000">Limit: 5000</option>
          </select>
          <button id="runQueryButton" class="runQueryButton">RUN</button>

          <div id="codeBlock">
            <pre><code  id="sqlCodeBlock" class="language-sql"></code></pre>
            <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
          </div>
          <div id="resultBlock">
            <p  style="color: red"><span id="bigqueryerror"></span></p>
          </div>
      </body>
      </html>
    `;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
      const showQueryResultsScriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "js", "showQueryResults.js"));
      const styleResetUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "media", "css", "query.css"));
      const nonce = getNonce();

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <link href="https://unpkg.com/tabulator-tables@6.2.5/dist/css/tabulator.min.css" rel="stylesheet">
        <script type="text/javascript" src="https://unpkg.com/tabulator-tables@6.2.5/dist/js/tabulator.min.js"></script>
        <link href="${styleResetUri}" rel="stylesheet">
      </head>
      <body>
        <div class="beta-button-container">
               <button class="beta-button" disabled>BETA</button>
        </div>
        <select id="queryLimit">
          <option value="1000" selected>Limit: 1000</option>
          <option value="2000">Limit: 2000</option>
          <option value="5000">Limit: 5000</option>
        </select>
        <button id="runQueryButton" class="runQueryButton">RUN</button>
        <button id="cancelBigQueryJobButton" class="cancelBigQueryJobButton">Cancel query</button>
        <p class="top-left">Query results ran at: <span id="datetime"></span></p>
        <table id="bigqueryResults" class="display" width="100%"></table>
        <script nonce="${nonce}" type="text/javascript" src="${showQueryResultsScriptUri}"></script>
      </body>
      </html>
    `;
  }
}
