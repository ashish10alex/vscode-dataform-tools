import React, { useEffect, useState, useMemo, useRef } from 'react';
import { vscode } from './vscode';
import { DataTable } from '../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { CodeBlock } from '../components/CodeBlock';

export default function App() {
  const [activeTab, setActiveTab] = useState<'results' | 'query'>('results');
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const [results, setResults] = useState<any[] | null>(null);
  const [columns, setColumns] = useState<any[] | null>(null);
  
  const [jobStats, setJobStats] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noResults, setNoResults] = useState<boolean>(false);
  
  const [query, setQuery] = useState<string>('');
  const [type, setType] = useState<string>('');
  
  const [incrementalCheckBox, setIncrementalCheckBox] = useState<boolean>(false);
  const [queryLimit, setQueryLimit] = useState<string>('1000');
  
  const [multiResults, setMultiResults] = useState<boolean>(false);
  const [summaryData, setSummaryData] = useState<any[] | null>(null);
  
  const [bigQueryJobId, setBigQueryJobId] = useState<string>('');
  const [bigQueryJobCancelledMsg, setBigQueryJobCancelledMsg] = useState<string | null>(null);
  
  const [viewingDetailMode, setViewingDetailMode] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
          if (isDark) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        }
      });
    });

    observer.observe(document.body, { attributes: true });
    
    // Initial check
    if (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')) {
      document.documentElement.classList.add('dark');
    }

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      
      if (msg.showLoadingMessage) {
        setLoading(true);
        setErrorMessage(null);
        setNoResults(false);
        setBigQueryJobCancelledMsg(null);
        startTimeRef.current = Date.now();
        setElapsedTime(0);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
          setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      }
      
      if (msg.queryLimit) setQueryLimit(msg.queryLimit);
      if (msg.incrementalCheckBox !== undefined) setIncrementalCheckBox(msg.incrementalCheckBox);
      if ('type' in msg) setType(msg.type || '');
      if (msg.bigQueryJobId) setBigQueryJobId(msg.bigQueryJobId);
      
      if (msg.multiResults && msg.summaryData) {
        setMultiResults(true);
        setSummaryData(msg.summaryData);
        setResults(null);
        setErrorMessage(null);
        setNoResults(false);
        setActiveTab('results');
        setViewingDetailMode(false);
        stopLoading();
      }

      if (msg.results && msg.columns) {
        setMultiResults(false);
        setResults(msg.results);
        setColumns(msg.columns);
        setJobStats(msg.jobStats ?? null);
        
        if (msg.type === 'assertion' && msg.errorMessage) {
          setErrorMessage('Assertion failed !');
        } else {
          setErrorMessage(null);
        }
        
        setNoResults(false);
        setActiveTab('results');
        stopLoading();
      }
      
      if (msg.bigQueryJobCancelled && msg.bigQueryJobId) {
        setMultiResults(false);
        setBigQueryJobCancelledMsg(`❕ BigQuery Job was cancelled, bigQueryJobId: ${msg.bigQueryJobId}`);
        setActiveTab('results');
        stopLoading();
      }
      
      if (msg.noResults) {
        setMultiResults(false);
        setNoResults(true);
        setResults(null);
        setJobStats(msg.jobStats);
        setErrorMessage(null);
        setActiveTab('results');
        stopLoading();
      }

      if (msg.query) {
        setQuery(msg.query);
        // If this is a preemptive query update without any results, show the query tab
        if (!msg.results && !msg.noResults && !msg.errorMessage && !msg.showLoadingMessage && !msg.multiResults) {
          setActiveTab('query');
        }
      }
      
      if (msg.errorMessage && !msg.results) { // don't override assertion failure message
        setMultiResults(false);
        setErrorMessage(msg.errorMessage);
        setResults(null);
        setActiveTab('results');
        stopLoading();
      }
    };
    
    window.addEventListener('message', handleMessage);
    vscode.postMessage({ command: 'appLoaded' });
    
    return () => {
      window.removeEventListener('message', handleMessage);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const stopLoading = () => {
    setLoading(false);
    if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }
  };

  const convertedColumns = useMemo<ColumnDef<any, any>[]>(() => {
    if (!columns) return [];
    const baseColumns = columns.map(col => ({
      accessorKey: col.field,
      header: col.title,
      cell: ({ row }: any) => {
        const val = row.getValue(col.field);
        return typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
      }
    }));

    return [
      {
        id: 'rowIndex',
        header: '',
        size: 80,
        cell: ({ row }: any) => (
          <span className="text-zinc-400 font-mono text-xs">
            {row.depth > 0 ? '' : Number(row.id) + 1}
          </span>
        ),
      },
      ...baseColumns
    ];
  }, [columns]);

  const summaryColumns = useMemo<ColumnDef<any, any>[]>(() => {
    return [
      { accessorKey: 'index', header: 'Id', size: 80 },
      { accessorKey: 'status', header: 'Status', size: 120 },
      { 
        id: 'action', 
        header: 'Action', 
        size: 160,
        cell: ({ row }) => (
          <button 
            className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
            onClick={() => handleViewResult(row.original.index)}
          >
            View Results
          </button>
        ) 
      },
      { accessorKey: 'query', header: 'Query', size: 800 }
    ];
  }, []);

  const handleRunQuery = () => {
    setLoading(true);
    vscode.postMessage({ command: 'runBigQueryJob' });
  };

  const handleCancelQuery = () => {
    vscode.postMessage({ command: 'cancelBigQueryJob' });
  };

  const handleDownloadCsv = () => {
    vscode.postMessage({ command: 'downloadDataAsCsv', value: true });
  };

  const handleViewResult = (index: number) => {
    setViewingDetailMode(true);
    setMultiResults(false);
    vscode.postMessage({ command: 'viewResultDetail', resultIndex: index });
  };

  const handleBackToSummary = () => {
    setViewingDetailMode(false);
    setMultiResults(true);
    setResults(null);
    setErrorMessage(null);
    setNoResults(false);
    vscode.postMessage({ command: 'backToSummary' });
  };

  const renderDateTimeText = () => {
    const jobIdToUse = jobStats?.bigQueryJobId || bigQueryJobId;
    if (!jobStats && !jobIdToUse) return null;
    const { bigQueryJobEndTime, jobCostMeta } = jobStats || {};
    const text = `Query results ran at: ${bigQueryJobEndTime || ''} | Took: (${elapsedTime} seconds) | billed: ${jobCostMeta || '0'} | jobId: ${jobIdToUse}`;
    return <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">{text}</span>;
  };
  
  const renderBigQueryLink = () => {
    const jobIdToUse = jobStats?.bigQueryJobId || bigQueryJobId;
    if (!jobIdToUse) return null;
    const parts = jobIdToUse.split(':');
    if (parts.length < 2) return null;
    const projectId = parts[0];
    const jobId = parts[1].replace('.', ':');
    const bqLink = `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${jobId}&page=queryresults`;
    
    return (
      <>
        <span className="mx-2 text-zinc-400">|</span>
        <button 
          onClick={() => vscode.postMessage({ command: 'openExternal', value: bqLink })}
          className="text-sm text-blue-500 hover:underline cursor-pointer bg-transparent border-none p-0"
        >
          View job in BigQuery
        </button>
      </>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e] text-zinc-900 dark:text-zinc-100 p-4 font-sans overflow-hidden">
      
      {/* Top Nav */}
      {(!multiResults || viewingDetailMode) && (
        <div className="flex border-b border-zinc-200 dark:border-zinc-700 mb-4">
          <button 
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'results' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            onClick={() => setActiveTab('results')}
          >
            Results
          </button>
          <button 
            className={`px-4 py-2 text-sm font-medium ${activeTab === 'query' ? 'border-b-2 border-blue-500 text-blue-500' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            onClick={() => setActiveTab('query')}
          >
            Query
          </button>
        </div>
      )}

      <div className="flex items-center space-x-4 mb-4 text-sm flex-wrap gap-y-2">
        {type === 'incremental' && (
          <label className="relative inline-flex items-center cursor-pointer group">
            <input 
              type="checkbox" 
              className="sr-only peer"
              checked={incrementalCheckBox}
              onChange={(e) => {
                setIncrementalCheckBox(e.target.checked);
                vscode.postMessage({ command: 'incrementalCheckBox', value: e.target.checked });
              }}
            />
            <div className="w-9 h-5 bg-zinc-200 group-hover:bg-zinc-300 peer-focus:outline-none rounded-full peer dark:bg-zinc-700 dark:group-hover:bg-zinc-600 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-zinc-600 peer-checked:bg-blue-600"></div>
            <span className="ml-2 font-medium">Incremental</span>
          </label>
        )}
        
        <select 
          className="bg-zinc-50 border border-zinc-300 text-zinc-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-1 dark:bg-zinc-800 dark:border-zinc-600 dark:placeholder-zinc-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
          value={queryLimit}
          onChange={(e) => {
            setQueryLimit(e.target.value);
            vscode.postMessage({ command: 'queryLimit', value: e.target.value });
          }}
        >
          <option value="1000">Limit: 1000</option>
          <option value="50000">Limit: 50000</option>
          <option value="100000">Limit: 100000</option>
          <option value="500000">Limit: 500000</option>
        </select>

        {!multiResults && (
           <button 
             onClick={handleRunQuery}
             disabled={loading}
             className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
           >
             RUN
           </button>
        )}
        
        <button 
          onClick={handleCancelQuery}
          disabled={!loading}
          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium disabled:opacity-50"
        >
          Cancel query
        </button>
        
        <button 
          onClick={handleDownloadCsv}
          disabled={!results}
          className="px-3 py-1 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-900 dark:text-zinc-100 rounded text-sm font-medium disabled:opacity-50"
        >
          Download CSV
        </button>
      </div>

      <div className="mb-4">
        {renderDateTimeText()}
        {renderBigQueryLink()}
      </div>

      {bigQueryJobCancelledMsg && (
        <div className="mb-4 p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 rounded text-sm">
          {bigQueryJobCancelledMsg}
        </div>
      )}

      {viewingDetailMode && (
        <div className="mb-4">
          <button 
            onClick={handleBackToSummary}
            className="px-3 py-1.5 bg-zinc-600 hover:bg-zinc-700 text-white border-none rounded cursor-pointer text-sm font-medium transition-colors"
          >
            ← Back to results summary
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 bg-white/50 dark:bg-[#1e1e1e]/50 z-50 flex items-center justify-center">
             <div className="text-sm font-mono bg-white dark:bg-zinc-800 p-4 rounded shadow-lg border border-zinc-200 dark:border-zinc-700">
                Loading data... ({elapsedTime} seconds.) {bigQueryJobId ? `JobId: ${bigQueryJobId}` : ''}
             </div>
          </div>
        )}

        {/* Multi Results summary block */}
        {multiResults && summaryData && !viewingDetailMode && (
          <div className="h-full flex flex-col">
            <h3 className="text-lg font-medium mb-2">Assertion Checks</h3>
            <div className="flex-1 overflow-auto">
              <DataTable columns={summaryColumns} data={summaryData} />
            </div>
          </div>
        )}

        {/* Single result viewing mode (either single query, or drilling down into multi results) */}
        {(!multiResults || viewingDetailMode) && (
          <>
            <div className={`h-full flex-col ${activeTab === 'results' ? 'flex' : 'hidden'}`}>
              {errorMessage && (
                <div className="text-red-500 dark:text-red-400 mb-4 font-mono text-sm whitespace-pre-wrap">
                  {errorMessage}
                </div>
              )}
              
              {noResults && (
                <div className="text-green-600 dark:text-green-400 mb-4 font-medium">
                  {type === 'assertion' ? 'Assertion passed !' : 'There is no data to display'}
                </div>
              )}

              {results && convertedColumns.length > 0 && (
                <DataTable columns={convertedColumns} data={results} />
              )}
            </div>

            <div className={`h-full overflow-auto ${activeTab === 'query' ? 'block' : 'hidden'}`}>
              <CodeBlock code={query} language="sql" className="h-full" />
            </div>
          </>
        )}
      </div>

    </div>
  );
}
