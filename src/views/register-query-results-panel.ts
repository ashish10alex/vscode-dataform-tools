import * as vscode from 'vscode';
import {  Uri } from "vscode";
import path from 'path';
import os from 'os';
import { getCurrentFileMetadata, getNonce, saveCsvFile } from '../utils';
import { cancelBigQueryJob, queryBigQuery } from '../bigqueryRunQuery';
import { getBigQueryTimeoutMs } from '../constants';
import { QueryWtType } from '../types';
import { Job } from '@google-cloud/bigquery';

function waitForBigQueryJob(timeout = getBigQueryTimeoutMs()): Promise<Job> { // default timeout from config
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const pollInterval = setInterval(() => {
      if (bigQueryJob) {
        globalThis.bigQueryJob = bigQueryJob;
        clearInterval(pollInterval);
        resolve(bigQueryJob);
      } else if (Date.now() - start > timeout) {
        clearInterval(pollInterval);
        reject(new Error('Timed out waiting for bigQueryJob'));
      }
    }, 100);
  });
}

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private queryType: string = "";
    private _cachedResults?: { results: any[] | undefined, columns:any | undefined, jobStats: any, query:string|undefined };
    private _cachedMultiResults?: { multiResultsMetadata: any[], query:string|undefined };
    private _query?:string;

    constructor(private readonly _extensionUri: vscode.Uri) {}
  
    public async resolveWebviewView(
      webviewView: vscode.WebviewView,
      //@ts-ignore
      context: vscode.WebviewViewResolveContext,
      _token: vscode.CancellationToken
    ) {
      this._view = webviewView;
      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [
          Uri.joinPath(this._extensionUri, "media"),
          Uri.joinPath(this._extensionUri, "dist")
        ]
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
        this._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit });
      }

      webviewView.onDidChangeVisibility(async() => {
        // TODO: check if we can handle the query execution and hiding and unhiding of panel separately
        if (webviewView.visible) {
          if (this._cachedResults) {
            this._view?.webview.postMessage({...this._cachedResults, "queryLimit":  queryLimit});
          } else if (this._cachedMultiResults) {
            this._view?.webview.postMessage({...this._cachedMultiResults, "queryLimit":  queryLimit});
          } else {
            let curFileMeta = await getCurrentFileMetadata(false);
            let type = curFileMeta?.fileMetadata?.queryMeta.type;
            this._view?.webview.postMessage({"type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit});
          }
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
                  this._view.webview.postMessage({"bigQueryJobId": resp.bigQueryJobId, "bigQueryJobCancelled": true, "queryLimit":  queryLimit});
                  this._view.show(true);
                }
                return;
              case 'runBigQueryJob':
                await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                return;
              case 'downloadDataAsCsv':
                  
                  if(this._cachedResults?.results){
                    const fileNameSuffix = _bigQueryJobId;
                    const fileName = `res_${fileNameSuffix}.csv`;
                    const tempDir = os.tmpdir();
                    const alternateFilePath = path.join(tempDir, fileName);
                    //TODO: we can have the folder to write the results in to be use configurable via settings
                    const filePath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || alternateFilePath, fileName);
                    vscode.window.showInformationMessage("Saving data as csv ...");
                    await saveCsvFile(filePath, this._cachedResults.results);
                }
                return;

              case 'viewResultDetail':
                if (this._cachedMultiResults && message.resultIndex !== undefined) {
                  const index = message.resultIndex;
                  const resultMetadata = this._cachedMultiResults.multiResultsMetadata[index];
                  if (resultMetadata) {
                    const { results, columns, jobStats, errorMessage, query } = resultMetadata;
                    
                    if (results && !errorMessage) {
                      this._view?.webview.postMessage({
                        "results": results, 
                        "columns": columns, 
                        "jobStats": jobStats, 
                        "query": query,
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox ,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": bigQueryJob?.id
                      });
                    } else if (!errorMessage) {
                      this._view?.webview.postMessage({
                        "noResults": true, 
                        "jobStats": jobStats, 
                        "query": query, 
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": bigQueryJob?.id
                      });
                    } else {
                      this._view?.webview.postMessage({
                        "errorMessage": errorMessage, 
                        "query": query, 
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": bigQueryJob?.id
                      });
                    }
                  }
                }
                return;
              //@ts-ignore
              case 'queryLimit':
                if (message.value){
                  queryLimit = message.value;
                }
                return;
              case 'incrementalCheckBox':
                incrementalCheckBox = message.value;
                return;
              case 'openExternal':
                if (message.value) {
                  vscode.env.openExternal(vscode.Uri.parse(message.value));
                }
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
          this._view.webview.postMessage({"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit });
          this._view.show(true);
          let allQueries = [];
          if(type === "assertion"){
            allQueries = query.trim().split(";").filter(q => q.trim());
          } else {
            allQueries = [query];
          }
          let resultsMetadata = [];
          
          for (let i = 0; i < allQueries.length; i++) {
            const singleQuery = allQueries[i];
            const queryOutput = queryBigQuery(singleQuery);
            // const { results, columns, jobStats, errorMessage } = queryBigQuery(singleQuery);
            const job = await waitForBigQueryJob();

            if (this?._view?.webview) {
              this._view.webview.postMessage({"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "bigQueryJobId": job.id });
          }

            const {results, columns, jobStats, errorMessage} = await queryOutput;
            resultsMetadata.push({results, columns, jobStats, errorMessage, query: singleQuery});
          }
          
          // If we have multiple queries, show a summary table
          if (resultsMetadata.length > 1) {
            this._cachedMultiResults = { multiResultsMetadata: resultsMetadata, query };
            this._cachedResults = undefined;
            
            // Prepare summary data for the multi-results table
            const summaryData = resultsMetadata.map((meta, index) => {
              const status = meta.errorMessage ? 'Failed' : (meta.results && meta.results.length > 0) ? '❌' : '✅';
              return { 
                index,
                status,
                query: meta.query,
              };
            });
            
            this._view.webview.postMessage({
              "multiResults": true,
              "summaryData": summaryData,
              "type": type,
              "incrementalCheckBox": incrementalCheckBox,
              "queryLimit":  queryLimit
            });
            
            this._view.show(true);
          } else if (resultsMetadata.length === 1) {
            // Single query result - use existing logic
            const resultMetadata = resultsMetadata[0];
            const { results, columns, jobStats, errorMessage } = resultMetadata;
            
            if(results && !errorMessage){
              this._cachedResults = { results, columns, jobStats, query };
              this._cachedMultiResults = undefined;
              this._view.webview.postMessage({"results": results, "columns": columns, "jobStats": jobStats, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit});
              this._view.show(true);
            } else if (!errorMessage){
              this._cachedResults = { results, columns, jobStats, query };
              this._cachedMultiResults = undefined;
              this._view.show(true);
              this._view.webview.postMessage({"noResults": true, "query": query, "type":type, "jobStats": jobStats, "incrementalCheckBox": incrementalCheckBox,  "queryLimit":  queryLimit});
            } else if(errorMessage){
              this._cachedResults = undefined;
              this._cachedMultiResults = undefined;
              this._view.webview.postMessage({"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox ,"queryLimit":  queryLimit});
              this._view.show(true);
            }
          }
      } catch (error:any) {
        let errorMessage = error?.message;
        if(errorMessage){
          this._view.webview.postMessage({"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit });
          this._view.show(true);
        }
      }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "query_results.js"));
    const styleUri = webview.asWebviewUri(Uri.joinPath(this._extensionUri, "dist", "query_results.css"));
    const nonce = getNonce();

    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
          <link href="${styleUri}" rel="stylesheet">
          <title>Query Results</title>
      </head>
      <body>
          <div id="root"></div>
          <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }

}
