import { Download, Play, Square } from 'lucide-react';

export type ResultsTab = 'results' | 'query';

interface ResultsHeaderProps {
  /** Hidden on the summary of an assertion's checks, which has no query of its own */
  showTabs: boolean;
  activeTab: ResultsTab;
  onTabChange: (tab: ResultsTab) => void;
  /** Shown while one check of an assertion is open */
  onBackToSummary?: () => void;
  showIncremental: boolean;
  incremental: boolean;
  onIncrementalChange: (checked: boolean) => void;
  queryLimit: string;
  onQueryLimitChange: (limit: string) => void;
  running: boolean;
  /** Whether a query can be started from here. A running query can always be cancelled. */
  canRun: boolean;
  onRun: () => void;
  onCancel: () => void;
  canDownload: boolean;
  onDownloadCsv: () => void;
}

const QUERY_LIMITS = ['1000', '50000', '100000', '500000'];

const tabClass = (active: boolean) => `px-3 py-1.5 text-sm font-medium transition-colors border-b-2 ${
  active
    ? 'border-[var(--vscode-button-background)] text-[var(--vscode-foreground)]'
    : 'border-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]'
}`;

const secondaryButton = 'inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded text-sm font-medium disabled:opacity-50 transition-colors';
const primaryButton = 'inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm font-medium transition-colors';

/** The one row above the results: the tabs on the left, what can be done with the query on the right */
export function ResultsHeader(props: ResultsHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {props.onBackToSummary && (
        <button onClick={props.onBackToSummary} className={secondaryButton}>
          ← Summary
        </button>
      )}

      {props.showTabs && (
        <div className="flex">
          <button className={tabClass(props.activeTab === 'results')} onClick={() => props.onTabChange('results')}>
            Results
          </button>
          <button className={tabClass(props.activeTab === 'query')} onClick={() => props.onTabChange('query')}>
            Query
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 ml-auto">
        {props.showIncremental && (
          <label className="relative inline-flex items-center cursor-pointer group mr-1">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={props.incremental}
              onChange={(e) => props.onIncrementalChange(e.target.checked)}
            />
            <div className="w-9 h-5 bg-[var(--vscode-widget-border)] group-hover:bg-[var(--vscode-toolbar-hoverBackground)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--vscode-widget-border)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--vscode-button-background)]"></div>
            <span className="ml-2 font-medium">Incremental</span>
          </label>
        )}

        <select
          className="bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border)] text-[var(--vscode-input-foreground)] text-sm rounded focus:border-[var(--vscode-focusBorder)] block p-1 outline-none"
          value={props.queryLimit}
          onChange={(e) => props.onQueryLimitChange(e.target.value)}
          title="Most rows a query returns"
        >
          {QUERY_LIMITS.map(limit => (
            <option key={limit} value={limit}>Limit: {Number(limit).toLocaleString('en-US')}</option>
          ))}
        </select>

        {props.running ? (
          <button onClick={props.onCancel} className={`${secondaryButton} min-w-[5.5rem] justify-center`}>
            <Square className="h-3 w-3 fill-current" />
            Cancel
          </button>
        ) : props.canRun && (
          <button onClick={props.onRun} className={`${primaryButton} min-w-[5.5rem] justify-center`}>
            <Play className="h-3 w-3 fill-current" />
            Run
          </button>
        )}

        <button onClick={props.onDownloadCsv} disabled={!props.canDownload} className={secondaryButton} title="Download the results as CSV">
          <Download className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>
    </div>
  );
}
