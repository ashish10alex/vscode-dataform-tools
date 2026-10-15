import { useEffect, useState, useMemo, useRef } from 'react';
import { vscode } from './vscode';
import { DataTable, type ServerTable } from '../components/ui/data-table';
import { ColumnDef } from '@tanstack/react-table';
import { CodeBlock } from '../components/CodeBlock';
import { FindWidget } from '../components/FindWidget';
import { ResultsHeader, type ResultsTab } from './components/ResultsHeader';
import { JobStatusLine, hasJobStatus } from './components/JobStatusLine';
import { bigQueryJobUrl, type JobStats, type ResultPaging } from '../../src/shared/queryResultsView';

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
  const [activeTab, setActiveTab] = useState<ResultsTab>('results');
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  const [results, setResults] = useState<any[] | null>(null);
  const [columns, setColumns] = useState<any[] | null>(null);

  const [jobStats, setJobStats] = useState<JobStats | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noResults, setNoResults] = useState<boolean>(false);

  const [query, setQuery] = useState<string>('');
  const [type, setType] = useState<string>('');

  const [incrementalCheckBox, setIncrementalCheckBox] = useState<boolean>(false);

  // Set when the host holds the result and `results` is one page of it
  const [paging, setPaging] = useState<ResultPaging | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const viewRequestRef = useRef(0);

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
        // The stats and the job of the run before are not those of this one
        setJobStats(null);
        setBigQueryJobId('');
        // The message comes again once the job has an id: the clock keeps the time of the first one
        if (!timerRef.current) {
          startTimeRef.current = Date.now();
          setElapsedTime(0);
          timerRef.current = setInterval(() => {
            setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }, 1000);
        }
      }

      if ('incrementalCheckBox' in msg) { setIncrementalCheckBox(msg.incrementalCheckBox); }
      if ('type' in msg) { setType(msg.type || ''); }
      if (msg.bigQueryJobId) { setBigQueryJobId(msg.bigQueryJobId); }
      if ('viewingDetailMode' in msg) { setViewingDetailMode(!!msg.viewingDetailMode); }

      if (msg.multiResults && msg.summaryData) {
        setMultiResults(true);
        setSummaryData(msg.summaryData);
        setResults(null);
        setJobStats(null);
        setBigQueryJobId('');
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
        setPaging(msg.paging ?? null);
        setPageLoading(false);
        setPageError(null);
        // An answer still on its way is to a request for the result before this one
        viewRequestRef.current++;

        if (msg.type === 'assertion' && msg.errorMessage) {
          setErrorMessage('Assertion failed');
        } else {
          setErrorMessage(null);
        }

        setNoResults(false);
        setActiveTab('results');
        stopLoading();
      }

      // The page asked for, unless another was asked for since
      if (msg.resultPage && msg.resultPage.requestId === viewRequestRef.current) {
        setResults(msg.resultPage.rows);
        setPaging(msg.resultPage.paging);
        setPageLoading(false);
        setPageError(null);
      }

      if (msg.resultPageError && msg.resultPageError.requestId === viewRequestRef.current) {
        setPageError(msg.resultPageError.message);
        setPageLoading(false);
      }

      if (msg.bigQueryJobCancelled && msg.bigQueryJobId) {
        setMultiResults(false);
        setBigQueryJobCancelledMsg('BigQuery job was cancelled');
        setActiveTab('results');
        stopLoading();
      }

      if (msg.noResults) {
        setMultiResults(false);
        setNoResults(true);
        setResults(null);
        setJobStats(msg.jobStats ?? null);
        setErrorMessage(null);
        setActiveTab('results');
        stopLoading();
      }

      if (msg.query) {
        // The Query tab is shown only when it is chosen
        setQuery(msg.query);
      }

      if (msg.errorMessage && !msg.results) { // don't override assertion failure message
        setMultiResults(false);
        setErrorMessage(msg.errorMessage);
        setResults(null);
        setJobStats(null);
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
      // Of a result held by the host, only the columns BigQuery can order are sorted and filtered
      enableSorting: !paging || !!col.sortable,
      enableColumnFilter: !paging || !!col.sortable,
      header: () => highlightText(col.title, searchTerm),
      cell: ({ row }: any) => {
        const val = row.getValue(col.field);
        // A child row holds one element of an array: its other cells are empty, not NULL
        if ((val === null || val === undefined) && row.depth === 0) {
          return <span className="italic text-[var(--vscode-disabledForeground)]">NULL</span>;
        }
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
            {row.depth > 0 ? '' : (paging ? paging.pageIndex * paging.pageSize + row.index : Number(row.id)) + 1}
          </span>
        ),
      },
      ...baseColumns
    ];
  }, [columns, searchTerm, paging]);

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

  // Asks the host for a page of the result it holds, with what changed of the paging, the sorting or the filters
  const requestView: ServerTable['onChange'] = (change) => {
    if (!paging) { return; }
    const sorting = change.sorting?.map(sort => ({ id: sort.id, desc: sort.desc })) ?? paging.sorting;
    const filters = change.columnFilters?.map(filter => ({ id: filter.id, value: String(filter.value ?? '') })).filter(filter => filter.value !== '') ?? paging.filters;
    const viewChanged = change.sorting !== undefined || change.columnFilters !== undefined;
    const next: ResultPaging = {
      ...paging,
      sorting,
      filters,
      pageSize: change.pageSize ?? paging.pageSize,
      pageIndex: viewChanged ? 0 : change.pageIndex ?? paging.pageIndex,
    };
    // The controls show what was asked for at once; the rows follow
    setPaging(next);
    setPageLoading(true);
    setPageError(null);
    const requestId = ++viewRequestRef.current;
    vscode.postMessage({
      command: 'resultView',
      value: { requestId, pageIndex: next.pageIndex, pageSize: next.pageSize, sorting, filters },
    });
  };

  const serverTable: ServerTable | undefined = paging ? {
    rowCount: paging.rowCount,
    pageIndex: paging.pageIndex,
    pageSize: paging.pageSize,
    sorting: paging.sorting,
    columnFilters: paging.filters,
    onChange: requestView,
  } : undefined;

  const goToNextMatch = () => setCurrentMatchIndex(i => i + 1);
  const goToPrevMatch = () => setCurrentMatchIndex(i => i - 1);

  const singleResult = !multiResults || viewingDetailMode;
  const summaryShown = multiResults && !!summaryData && !viewingDetailMode;
  const tableShown = singleResult && activeTab === 'results' && !!results && convertedColumns.length > 0;

  const jobStatus = {
    running: loading,
    elapsedSeconds: elapsedTime,
    jobStats,
    jobId: bigQueryJobId,
    shownRows: !singleResult ? undefined : results ? (paging ? paging.rowCount : results.length) : noResults ? 0 : undefined,
    viewBilled: paging?.viewBilled,
  };
  const busy = loading || pageLoading;
  const runningJobUrl = bigQueryJobUrl(bigQueryJobId);
  const status = hasJobStatus(jobStatus) ? <JobStatusLine {...jobStatus} /> : undefined;

  return (
    <div className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] p-2 font-sans overflow-hidden">

      <ResultsHeader
        showTabs={singleResult}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onBackToSummary={viewingDetailMode ? handleBackToSummary : undefined}
        showIncremental={type === 'incremental'}
        incremental={incrementalCheckBox}
        onIncrementalChange={(checked) => {
          setIncrementalCheckBox(checked);
          vscode.postMessage({ command: 'incrementalCheckBox', value: checked });
        }}
        running={loading}
        onViewJob={runningJobUrl ? () => vscode.postMessage({ command: 'openExternal', value: runningJobUrl }) : undefined}
        canRun={!multiResults}
        onRun={handleRunQuery}
        onCancel={handleCancelQuery}
        canDownload={!!results}
        onDownloadCsv={handleDownloadCsv}
      />

      {/* The line under the header, along which a bar runs while the query does */}
      <div className="relative h-0.5 shrink-0 mt-1 mb-2 overflow-hidden bg-[var(--vscode-widget-border)]">
        {busy && <div className="query-progress" />}
      </div>

      {bigQueryJobCancelledMsg && (
        <div className="mb-2 p-2 bg-[var(--vscode-inputValidation-warningBackground)] border border-[var(--vscode-inputValidation-warningBorder)] text-[var(--vscode-inputValidation-warningForeground,var(--vscode-foreground))] rounded text-sm">
          {bigQueryJobCancelledMsg}
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

      {/* While a query runs or a page is read, the rows before stay in view, dimmed (see .query-running) */}
      <div className={`flex-1 min-h-0 overflow-hidden${busy ? ' query-running' : ''}`}>
        {/* Multi Results summary block */}
        {summaryShown && (
          <div className="h-full flex flex-col">
            <h3 className="text-lg font-medium mb-2">Assertion Checks</h3>
            <div className="flex-1 overflow-auto">
              <DataTable columns={summaryColumns} data={summaryData} />
            </div>
          </div>
        )}

        {/* Single result viewing mode (either single query, or drilling down into multi results) */}
        {singleResult && (
          <>
            <div className={`h-full flex-col ${activeTab === 'results' ? 'flex' : 'hidden'}`}>
              {errorMessage && (
                <div className="shrink-0 max-h-full overflow-auto mb-2 p-2 rounded border font-mono text-sm whitespace-pre-wrap bg-[var(--vscode-inputValidation-errorBackground)] border-[var(--vscode-inputValidation-errorBorder)] text-[var(--vscode-inputValidation-errorForeground,var(--vscode-foreground))]">
                  {errorMessage}
                </div>
              )}

              {pageError && (
                <div className="shrink-0 mb-2 p-2 rounded border font-mono text-sm whitespace-pre-wrap bg-[var(--vscode-inputValidation-errorBackground)] border-[var(--vscode-inputValidation-errorBorder)] text-[var(--vscode-inputValidation-errorForeground,var(--vscode-foreground))]">
                  {pageError}
                </div>
              )}

              {noResults && (
                <div className={`mb-2 font-medium ${type === 'assertion' ? 'text-[var(--vscode-testing-iconPassed)]' : 'text-[var(--vscode-descriptionForeground)]'}`}>
                  {type === 'assertion' ? 'Assertion passed' : 'There is no data to display'}
                </div>
              )}

              {loading && !results && (
                <div className="text-sm text-[var(--vscode-descriptionForeground)]">Running query…</div>
              )}

              {results && convertedColumns.length > 0 && (
                <div className="flex-1 min-h-0">
                  <DataTable columns={convertedColumns} data={results} status={status} server={serverTable} />
                </div>
              )}
            </div>

            <div className={`h-full overflow-auto ${activeTab === 'query' ? 'block' : 'hidden'}`}>
              <CodeBlock code={query} language="sql" className="h-full" />
            </div>
          </>
        )}
      </div>

      {/* Under a table the status is part of the table's own bar */}
      {status && !tableShown && (
        <div className="shrink-0 mt-2 px-2 py-2 border-t border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBarSectionHeader-background)]">
          {status}
        </div>
      )}

    </div>
  );
}
