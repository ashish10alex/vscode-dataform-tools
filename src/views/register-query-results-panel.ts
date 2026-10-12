import * as vscode from 'vscode';
import {  Uri } from "vscode";
import path from 'path';
import os from 'os';
import { getCurrentFileMetadata, getNonce, saveCsvFile } from '../utils';
import { cancelBigQueryJob, openQueryResult } from '../bigqueryRunQuery';
import type { QueryResult } from '../bigquery/queryResult';
import { RESULT_CHUNK_ROWS, type JobStats, type ResultPaging, type ResultViewRequest } from '../shared/queryResultsView';
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

/** The rows of a page of a result the view does not hold whole, until it asks for another size */
const DEFAULT_PAGE_ROWS = 50;
/** The most rows written to a CSV file */
const CSV_MAX_ROWS = 500_000;

/** What ran for one query: its result when it gave one, or why it did not */
interface QueryOutcome {
  result: QueryResult | undefined;
  jobStats: JobStats | undefined;
  errorMessage: string | undefined;
  query: string;
}

/** The result in the view */
interface ShownResult {
  /** The result of the query */
  base: QueryResult;
  /** `base` sorted and filtered, or `base` itself */
  view: QueryResult;
  paging: ResultPaging;
  jobStats: JobStats | undefined;
  query: string | undefined;
  type: string;
  /** Whether it is one check of an assertion, opened from the summary of them */
  detail: boolean;
}

/** One line of the summary of an assertion's checks: a check passes when its query finds no rows */
const checkSummary = (outcome: QueryOutcome, index: number) => ({
  index,
  status: outcome.errorMessage ? 'Failed' : (outcome.result && outcome.result.totalRows > 0) ? '❌' : '✅',
  query: outcome.query,
});

export class CustomViewProvider implements vscode.WebviewViewProvider {
    public _view?: vscode.WebviewView;
    private _invokedByCommand: boolean = false; 
    private queryType: string = "";
    private _shown?: ShownResult;
    /** The newest request of the view for a page: the answer to an older one is not sent */
    private _latestViewRequest = 0;
    private _cachedMultiResults?: { multiResultsMetadata: QueryOutcome[], query:string|undefined };
    private _query?:string;
    /** Where the query's job runs, see `QueryWtType.place` */
    private _place?: QueryWtType['place'];
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
          await this.updateContent({query: this._query, type:this.queryType, place: this._place});
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
                    await this.updateContent({query: this._query, type: this.queryType, place: this._place});
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
                  const summaryData = this._cachedMultiResults.multiResultsMetadata.map(checkSummary);
                  this._shown = undefined;
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
              case 'downloadDataAsCsv': {
                  const shown = this._shown;
                  if (shown) {
                    const fileNameSuffix = _bigQueryJobId;
                    const fileName = `res_${fileNameSuffix}.csv`;
                    const tempDir = os.tmpdir();
                    const alternateFilePath = path.join(tempDir, fileName);
                    //TODO: we can have the folder to write the results in to be use configurable via settings
                    const filePath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || alternateFilePath, fileName);
                    try {
                      let cancelled = false;
                      // The rows not yet looked at are read from BigQuery first
                      const rows = await vscode.window.withProgress(
                        { location: vscode.ProgressLocation.Notification, title: "Reading rows for the csv", cancellable: true },
                        (progress, token) => shown.view.rows(CSV_MAX_ROWS, (read, of) => {
                          progress.report({ message: `${read.toLocaleString('en-US')} of ${of.toLocaleString('en-US')}` });
                          cancelled = token.isCancellationRequested;
                          return !cancelled;
                        })
                      );
                      if (cancelled) {
                        return;
                      }
                      if (shown.view.totalRows > CSV_MAX_ROWS) {
                        vscode.window.showWarningMessage(`The result has ${shown.view.totalRows.toLocaleString('en-US')} rows. The csv has the first ${CSV_MAX_ROWS.toLocaleString('en-US')}.`);
                      }
                      await saveCsvFile(filePath, rows);
                    } catch (error: any) {
                      vscode.window.showErrorMessage(`Could not save the csv: ${error?.message ?? error}`);
                    }
                }
                return;
              }

              case 'viewResultDetail':
                if (this._cachedMultiResults && message.resultIndex !== undefined) {
                  const outcome = this._cachedMultiResults.multiResultsMetadata[message.resultIndex];
                  if (outcome) {
                    await this.showOutcome(outcome, this.queryType, outcome.query, true);
                  }
                }
                return;
              case 'resultView':
                await this.sendResultPage(message.value);
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
      this._place = queryWtType.place;
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
          let resultsMetadata: QueryOutcome[] = [];
          
          for (let i = 0; i < allQueries.length; i++) {
            const singleQuery = allQueries[i];
            const queryOutput = openQueryResult(singleQuery, queryWtType.place);
            const job = await waitForBigQueryJob(queryOutput);

            if (this?._view?.webview && job) {
              this._lastRenderPayload = {"showLoadingMessage": true, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit, "bigQueryJobId": job.id };
              this._view.webview.postMessage(this._lastRenderPayload);
            }

            resultsMetadata.push({...await queryOutput, query: singleQuery});
          }
          
          // If we have multiple queries, show a summary table
          if (resultsMetadata.length > 1) {
            this._cachedMultiResults = { multiResultsMetadata: resultsMetadata, query };
            this._shown = undefined;
            
            this._lastRenderPayload = {
              "multiResults": true,
              "summaryData": resultsMetadata.map(checkSummary),
              "type": type,
              "incrementalCheckBox": incrementalCheckBox,
              "queryLimit":  queryLimit
            };
            this._view.webview.postMessage(this._lastRenderPayload);
            
            this._view.show(true);
          } else if (resultsMetadata.length === 1) {
            this._cachedMultiResults = undefined;
            await this.showOutcome(resultsMetadata[0], type, query, false);
            this._view.show(true);
          }
      } catch (error:any) {
        let errorMessage = error?.message || "An unknown error occurred during query execution.";
        this._lastRenderPayload = {"errorMessage": errorMessage, "query": query, "type": type, "incrementalCheckBox": incrementalCheckBox, "queryLimit":  queryLimit };
        this._view.webview.postMessage(this._lastRenderPayload);
        this._view.show(true);
      }
  }

  /** Shows what ran for a query: the rows of its result, that it has none, or its error */
  private async showOutcome(outcome: QueryOutcome, type: string, query: string | undefined, detail: boolean) {
    const { result, jobStats, errorMessage } = outcome;
    const common = {
      "query": query,
      "type": type,
      "incrementalCheckBox": incrementalCheckBox,
      "queryLimit": queryLimit,
      "bigQueryJobId": jobStats?.bigQueryJobId,
      ...(detail ? { "viewingDetailMode": true } : {}),
    };
    this._shown = undefined;
    if (errorMessage) {
      this._lastRenderPayload = { "errorMessage": errorMessage, ...common };
    } else if (!result || result.totalRows === 0) {
      this._lastRenderPayload = { "noResults": true, "jobStats": jobStats, ...common };
    } else {
      // A result the view can hold is sent whole, and the view sorts and filters it by itself
      const rows = await result.page(0, result.fitsInView ? RESULT_CHUNK_ROWS : DEFAULT_PAGE_ROWS);
      const paging: ResultPaging = { pageIndex: 0, pageSize: DEFAULT_PAGE_ROWS, rowCount: result.totalRows, sorting: [], filters: [] };
      this._shown = { base: result, view: result, paging, jobStats, query, type, detail };
      this._lastRenderPayload = {
        "results": rows,
        "columns": result.columns,
        "jobStats": jobStats,
        ...common,
        ...(result.fitsInView ? {} : { "paging": paging }),
      };
    }
    this._view?.webview.postMessage(this._lastRenderPayload);
  }

  /** Answers the view's request for a page of the result it shows, sorted and filtered as it asks */
  private async sendResultPage(request: ResultViewRequest | undefined) {
    const shown = this._shown;
    if (!shown || !request) {
      return;
    }
    this._latestViewRequest = Math.max(this._latestViewRequest, request.requestId);
    try {
      const sameView = JSON.stringify([request.sorting, request.filters]) === JSON.stringify([shown.paging.sorting, shown.paging.filters]);
      let view = shown.view;
      let viewBilled = shown.paging.viewBilled;
      if (!sameView) {
        const opened = shown.base.openView ? await shown.base.openView(request.sorting, request.filters) : { result: shown.base, billed: undefined };
        view = opened.result;
        viewBilled = opened.billed;
      }
      // The rows are other rows once sorted or filtered: the view starts again at the first page
      const pageIndex = sameView ? request.pageIndex : 0;
      const rows = await view.page(pageIndex, request.pageSize);
      if (this._shown !== shown || request.requestId < this._latestViewRequest) {
        return;
      }
      shown.view = view;
      shown.paging = { pageIndex, pageSize: request.pageSize, rowCount: view.totalRows, sorting: request.sorting, filters: request.filters, viewBilled };
      // What the view is sent when it is shown again: the page it was on
      this._lastRenderPayload = { ...this._lastRenderPayload, "results": rows, "paging": shown.paging };
      this._view?.webview.postMessage({ "resultPage": { requestId: request.requestId, rows, paging: shown.paging } });
    } catch (error: any) {
      if (this._shown === shown) {
        this._view?.webview.postMessage({ "resultPageError": { requestId: request.requestId, message: error?.message ?? String(error) } });
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
