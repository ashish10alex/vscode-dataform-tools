import * as vscode from 'vscode';
import {  Uri } from "vscode";
import path from 'path';
import os from 'os';
import { getCurrentFileMetadata, getNonce, saveCsvFile } from '../utils';
import { cancelBigQueryJob, queryBigQuery } from '../bigqueryRunQuery';
import { getQueryStringForPreview } from '../previewQueryResults';
import { getBigQueryTimeoutMs } from '../constants';
import { QueryWtType } from '../types';
import { Job } from '@google-cloud/bigquery';

function waitForBigQueryJob(queryOutputPromise?: Promise<any>, timeout = getBigQueryTimeoutMs()): Promise<Job | null> { // default timeout from config
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let isQueryDone = false;

    if (queryOutputPromise) {
        queryOutputPromise.then(() => isQueryDone = true).catch(() => isQueryDone = true);
    }

    const pollInterval = setInterval(() => {
      if (bigQueryJob) {
        globalThis.bigQueryJob = bigQueryJob;
        clearInterval(pollInterval);
        resolve(bigQueryJob);
      } else if (isQueryDone) {
        clearInterval(pollInterval);
        resolve(null);
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
    private _lastRenderPayload?: any;

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
        if (curFileMeta?.fileMetadata) {
            let type = curFileMeta.fileMetadata.queryMeta.type;
            let query = getQueryStringForPreview(curFileMeta.fileMetadata, incrementalCheckBox);
            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
            this._view.webview.postMessage({ "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "query": query });
        } else {
            webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
            this._view.webview.postMessage({ "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit });
        }
      }

      webviewView.onDidChangeVisibility(async() => {
        if (webviewView.visible) {
          if (this._lastRenderPayload) {
            this._view?.webview.postMessage({
              ...this._lastRenderPayload,
              "incrementalCheckBox": incrementalCheckBox,
              "queryLimit": queryLimit
            });
          } else {
            let curFileMeta = await getCurrentFileMetadata(false);
            if (curFileMeta?.fileMetadata) {
                let type = curFileMeta.fileMetadata.queryMeta.type;
                let query = getQueryStringForPreview(curFileMeta.fileMetadata, incrementalCheckBox);
                this._view?.webview.postMessage({"type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "query": query});
            }
          }
        }
      });

      webviewView.webview.onDidReceiveMessage(
          async message => {
            switch (message.command) {
              case 'appLoaded':
                if (this._lastRenderPayload) {
                    this._view?.webview.postMessage({
                        ...this._lastRenderPayload,
                        "incrementalCheckBox": incrementalCheckBox,
                        "queryLimit": queryLimit
                    });
                } else if (this._query) {
                    await this.updateContent({query: this._query, type: this.queryType});
                } else {
                    let curFileMeta = await getCurrentFileMetadata(false);
                    if (curFileMeta?.fileMetadata) {
                        let type = curFileMeta.fileMetadata.queryMeta.type;
                        let query = getQueryStringForPreview(curFileMeta.fileMetadata, incrementalCheckBox);
                        this._view?.webview.postMessage({"type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit": queryLimit, "query": query});
                    }
                }
                return;
              case 'cancelBigQueryJob':
                let resp = await cancelBigQueryJob();
                cancelBigQueryJobSignal = false;
                if (resp.cancelled && this._view){
                  this._view.webview.html = this._getHtmlForWebview(this._view.webview);
                  this._lastRenderPayload = {"bigQueryJobId": resp.bigQueryJobId, "bigQueryJobCancelled": true, "queryLimit":  queryLimit};
                  this._view.webview.postMessage(this._lastRenderPayload);
                  this._view.show(true);
                }
                return;
              case 'runBigQueryJob':
                await vscode.commands.executeCommand('vscode-dataform-tools.runQuery');
                return;
              case 'backToSummary':
                if (this._cachedMultiResults) {
                  const summaryData = this._cachedMultiResults.multiResultsMetadata.map((meta: any, index: number) => {
                    const status = meta.errorMessage ? 'Failed' : (meta.results && meta.results.length > 0) ? '❌' : '✅';
                    return { index, status, query: meta.query };
                  });
                  this._lastRenderPayload = {
                    "multiResults": true,
                    "summaryData": summaryData,
                    "type": this.queryType,
                    "incrementalCheckBox": incrementalCheckBox,
                    "queryLimit": queryLimit
                  };
                  this._view?.webview.postMessage(this._lastRenderPayload);
                }
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
                      this._lastRenderPayload = {
                        "results": results, 
                        "columns": columns, 
                        "jobStats": jobStats, 
                        "query": query,
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox ,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": jobStats.bigQueryJobId,
                        "viewingDetailMode": true
                      };
                      this._view?.webview.postMessage(this._lastRenderPayload);
                    } else if (!errorMessage) {
                      this._lastRenderPayload = {
                        "noResults": true, 
                        "jobStats": jobStats, 
                        "query": query, 
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": jobStats.bigQueryJobId,
                        "viewingDetailMode": true
                      };
                      this._view?.webview.postMessage(this._lastRenderPayload);
                    } else {
                      this._lastRenderPayload = {
                        "errorMessage": errorMessage, 
                        "query": query, 
                        "type": this.queryType, 
                        "incrementalCheckBox": incrementalCheckBox,
                        "queryLimit":  queryLimit,
                        "bigQueryJobId": jobStats.bigQueryJobId,
                        "viewingDetailMode": true
                      };
                      this._view?.webview.postMessage(this._lastRenderPayload);
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
                let curFileMetaForInc = await getCurrentFileMetadata(false);
                if (curFileMetaForInc?.fileMetadata) {
                    let type = curFileMetaForInc.fileMetadata.queryMeta.type;
                    let query = getQueryStringForPreview(curFileMetaForInc.fileMetadata, incrementalCheckBox);
                    this._view?.webview.postMessage({"type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit": queryLimit, "query": query});
                }
                return;
              case 'openExternal':
                if (message.value) {
                  const uri = vscode.Uri.parse(message.value);
                  if (uri.scheme === 'https' || uri.scheme === 'http') {
                    vscode.env.openExternal(uri);
                  }
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
          this._lastRenderPayload = {"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit };
          this._view.webview.postMessage(this._lastRenderPayload);
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
            const job = await waitForBigQueryJob(queryOutput);

            if (this?._view?.webview && job) {
              this._lastRenderPayload = {"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "bigQueryJobId": job.id };
              this._view.webview.postMessage(this._lastRenderPayload);
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
            
            this._lastRenderPayload = {
              "multiResults": true,
              "summaryData": summaryData,
              "type": type,
              "incrementalCheckBox": incrementalCheckBox,
              "queryLimit":  queryLimit
            };
            this._view.webview.postMessage(this._lastRenderPayload);
            
            this._view.show(true);
          } else if (resultsMetadata.length === 1) {
            // Single query result - use existing logic
            const resultMetadata = resultsMetadata[0];
            const { results, columns, jobStats, errorMessage } = resultMetadata;
            
            if(results && !errorMessage){
              this._cachedResults = { results, columns, jobStats, query };
              this._cachedMultiResults = undefined;
              this._lastRenderPayload = {"results": results, "columns": columns, "jobStats": jobStats, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "bigQueryJobId": jobStats?.bigQueryJobId};
              this._view.webview.postMessage(this._lastRenderPayload);
              this._view.show(true);
            } else if (!errorMessage){
              this._cachedResults = { results, columns, jobStats, query };
              this._cachedMultiResults = undefined;
              this._lastRenderPayload = {"noResults": true, "query": query, "type":type, "jobStats": jobStats, "incrementalCheckBox": incrementalCheckBox,  "queryLimit":  queryLimit, "bigQueryJobId": jobStats?.bigQueryJobId};
              this._view.show(true);
              this._view.webview.postMessage(this._lastRenderPayload);
            } else if(errorMessage){
              this._cachedResults = undefined;
              this._cachedMultiResults = undefined;
              this._lastRenderPayload = {"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox ,"queryLimit":  queryLimit, "bigQueryJobId": jobStats?.bigQueryJobId};
              this._view.webview.postMessage(this._lastRenderPayload);
              this._view.show(true);
            }
          }
      } catch (error:any) {
        let errorMessage = error?.message || "An unknown error occurred during query execution.";
        this._lastRenderPayload = {"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit };
        this._view.webview.postMessage(this._lastRenderPayload);
        this._view.show(true);
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
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
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
