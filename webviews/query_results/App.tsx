import { useEffect, useState, useMemo, useRef } from 'react';
import { vscode } from './vscode';
import { DataTable } from '../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { CodeBlock } from '../components/CodeBlock';
import { FindWidget } from '../components/FindWidget';

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightText(text: string, search: string) {
  if (!search.trim()) { return text; }
  const parts = text.split(new RegExp(`(${escapeRegex(search)})`, 'gi'));
  if (parts.length === 1) { return text; }
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === search.toLowerCase()
          ? (
            <mark
              key={i}
              className="search-match"
              style={{ background: 'var(--vscode-editor-findMatchHighlightBackground)', color: 'inherit', borderRadius: '2px' }}
            >
              {part}
            </mark>
          )
          : part
      )}
    </>
  );
}

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

  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
        if (timerRef.current) { clearInterval(timerRef.current); }
        timerRef.current = setInterval(() => {
          setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
      }

      if ('queryLimit' in msg) { setQueryLimit(msg.queryLimit); }
      if ('incrementalCheckBox' in msg) { setIncrementalCheckBox(msg.incrementalCheckBox); }
      if ('type' in msg) { setType(msg.type || ''); }
      if ('bigQueryJobId' in msg) { setBigQueryJobId(msg.bigQueryJobId); }

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
      if (timerRef.current) { clearInterval(timerRef.current); }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        if (activeTab === 'results' && (results || multiResults)) {
          e.preventDefault();
          setShowSearch(true);
          setTimeout(() => searchInputRef.current?.focus(), 0);
        }
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchTerm('');
        setCurrentMatchIndex(0);
        setMatchCount(0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, results, multiResults, showSearch]);

  // Update match highlights and scroll to current match
  useEffect(() => {
    // Clear previous current-match styling
    document.querySelectorAll('.search-match-current').forEach(el => {
      (el as HTMLElement).style.background = 'var(--vscode-editor-findMatchHighlightBackground)';
      el.classList.remove('search-match-current');
    });

    if (!searchTerm.trim()) {
      setMatchCount(0);
      return;
    }

    const matches = document.querySelectorAll<HTMLElement>('.search-match');
    setMatchCount(matches.length);

    if (matches.length === 0) { return; }

    const idx = ((currentMatchIndex % matches.length) + matches.length) % matches.length;
    const current = matches[idx];
    current.classList.add('search-match-current');
    current.style.background = 'var(--vscode-editor-findMatchBackground, #f6931a)';
    current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [searchTerm, currentMatchIndex, results, summaryData]);

  // Reset match index when search term changes
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchTerm]);

  const stopLoading = () => {
    setLoading(false);
    if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }
  };

  const convertedColumns = useMemo<ColumnDef<any, any>[]>(() => {
    if (!columns) { return []; }
    const baseColumns = columns.map(col => ({
      accessorKey: col.field,
      header: () => highlightText(col.title, searchTerm),
      cell: ({ row }: any) => {
        const val = row.getValue(col.field);
        const text = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val ?? '');
        return highlightText(text, searchTerm);
      }
    }));

    return [
      {
        id: 'rowIndex',
        header: '',
        size: 80,
        cell: ({ row }: any) => (
          <span className="text-[var(--vscode-descriptionForeground)] font-mono text-xs">
            {row.depth > 0 ? '' : Number(row.id) + 1}
          </span>
        ),
      },
      ...baseColumns
    ];
  }, [columns, searchTerm]);

  const summaryColumns = useMemo<ColumnDef<any, any>[]>(() => {
    return [
      { accessorKey: 'index', header: () => highlightText('Id', searchTerm), size: 80 },
      { accessorKey: 'status', header: () => highlightText('Status', searchTerm), size: 120 },
      {
        id: 'action',
        header: () => highlightText('Action', searchTerm),
        size: 160,
        cell: ({ row }) => (
          <button
            className="px-2 py-1 bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] rounded text-xs hover:bg-[var(--vscode-button-hoverBackground)]"
            onClick={() => handleViewResult(row.original.index)}
          >
            View Results
          </button>
        )
      },
      {
        accessorKey: 'query',
        header: () => highlightText('Query', searchTerm),
        size: 800,
        cell: ({ row }: any) => highlightText(String(row.getValue('query') ?? ''), searchTerm),
      }
    ];
  }, [searchTerm]);

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

  const goToNextMatch = () => setCurrentMatchIndex(i => i + 1);
  const goToPrevMatch = () => setCurrentMatchIndex(i => i - 1);

  const renderDateTimeText = () => {
    const jobIdToUse = jobStats?.bigQueryJobId || bigQueryJobId;
    if (!jobStats && !jobIdToUse) { return null; }
    const { bigQueryJobEndTime, jobCostMeta } = jobStats || {};
    const text = `Query results ran at: ${bigQueryJobEndTime || ''} | Took: (${elapsedTime} seconds) | billed: ${jobCostMeta || '0'} | jobId: ${jobIdToUse}`;
    return <span className="text-sm font-mono text-[var(--vscode-descriptionForeground)]">{text}</span>;
  };

  const renderBigQueryLink = () => {
    const jobIdToUse = jobStats?.bigQueryJobId || bigQueryJobId;
    if (!jobIdToUse) { return null; }
    const parts = jobIdToUse.split(':');
    if (parts.length < 2) { return null; }
    const projectId = parts[0];
    const jobId = parts[1].replace('.', ':');
    const bqLink = `https://console.cloud.google.com/bigquery?project=${projectId}&j=bq:${jobId}&page=queryresults`;

    return (
      <>
        <span className="mx-2 text-[var(--vscode-widget-border)]">|</span>
        <button
          onClick={() => vscode.postMessage({ command: 'openExternal', value: bqLink })}
          className="text-sm text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline cursor-pointer bg-transparent border-none p-0"
        >
          View job in BigQuery
        </button>
      </>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] p-4 font-sans overflow-hidden">

      {/* Top Nav */}
      {(!multiResults || viewingDetailMode) && (
        <div className="flex border-b border-[var(--vscode-widget-border)] mb-4">
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'results' ? 'border-b-2 border-[var(--vscode-button-background)] text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'}`}
            onClick={() => setActiveTab('results')}
          >
            Results
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === 'query' ? 'border-b-2 border-[var(--vscode-button-background)] text-[var(--vscode-foreground)]' : 'text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'}`}
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
            <div className="w-9 h-5 bg-[var(--vscode-widget-border)] group-hover:bg-[var(--vscode-toolbar-hoverBackground)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--vscode-widget-border)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--vscode-button-background)]"></div>
            <span className="ml-2 font-medium">Incremental</span>
          </label>
        )}

        <select
          className="bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] text-sm rounded-lg focus:ring-[var(--vscode-focusBorder)] focus:border-[var(--vscode-focusBorder)] block p-1 outline-none"
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
             className="px-3 py-1 bg-[var(--vscode-extensionIcon-preReleaseForeground)] hover:opacity-90 text-[var(--vscode-editor-background)] rounded text-sm font-medium disabled:opacity-50 transition-opacity"
           >
             RUN
           </button>
        )}

        <button
          onClick={handleCancelQuery}
          disabled={!loading}
          className="px-3 py-1 bg-[var(--vscode-errorForeground)] hover:opacity-90 text-[var(--vscode-editor-background)] rounded text-sm font-medium disabled:opacity-50 transition-opacity"
        >
          Cancel query
        </button>

        <button
          onClick={handleDownloadCsv}
          disabled={!results}
          className="px-3 py-1 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded text-sm font-medium disabled:opacity-50 transition-colors"
        >
          Download CSV
        </button>
      </div>

      <div className="mb-4">
        {renderDateTimeText()}
        {renderBigQueryLink()}
      </div>

      {bigQueryJobCancelledMsg && (
        <div className="mb-4 p-2 bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)] text-[var(--vscode-inputValidation-warningForeground)] rounded text-sm">
          {bigQueryJobCancelledMsg}
        </div>
      )}

      {viewingDetailMode && (
        <div className="mb-4">
          <button
            onClick={handleBackToSummary}
            className="px-3 py-1.5 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded text-sm font-medium transition-colors"
          >
            ← Back to results summary
          </button>
        </div>
      )}

      {/* Find widget */}
      {showSearch && activeTab === 'results' && (
        <FindWidget
          searchInputRef={searchInputRef}
          searchTerm={searchTerm}
          matchCount={matchCount}
          currentMatchIndex={currentMatchIndex}
          onSearchTermChange={setSearchTerm}
          onClose={() => {
            setShowSearch(false);
            setSearchTerm('');
            setCurrentMatchIndex(0);
            setMatchCount(0);
          }}
          onNextMatch={goToNextMatch}
          onPrevMatch={goToPrevMatch}
        />
      )}

      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 bg-[var(--vscode-editor-background)] opacity-70 z-50 flex items-center justify-center">
             <div className="text-sm font-mono bg-[var(--vscode-sideBar-background)] text-[var(--vscode-foreground)] p-4 rounded shadow-lg border border-[var(--vscode-widget-border)]">
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
                <div className="text-[var(--vscode-errorForeground)] mb-4 font-mono text-sm whitespace-pre-wrap">
                  {errorMessage}
                </div>
              )}

              {noResults && (
                <div className="text-[var(--vscode-extensionIcon-preReleaseForeground)] mb-4 font-medium">
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
