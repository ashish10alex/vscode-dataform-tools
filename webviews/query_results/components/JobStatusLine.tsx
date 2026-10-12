import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { formatDuration } from '../../../src/shared/jobTiming';
import { bigQueryJobUrl, jobStatsParts, shortJobId, type JobStats } from '../../../src/shared/queryResultsView';
import { vscode } from '../vscode';

interface JobStatusLineProps {
  running: boolean;
  /** Seconds since the run began, counted by the view while it waits */
  elapsedSeconds: number;
  jobStats?: JobStats | null;
  /** Known as soon as the job is created, before it has stats */
  jobId?: string;
  /** Rows in the table, when a finished query has a table or returned no rows */
  shownRows?: number;
}

/** Whether the status line has anything to say, so that its bar is not drawn empty */
export function hasJobStatus({ running, jobStats, jobId }: Pick<JobStatusLineProps, 'running' | 'jobStats' | 'jobId'>): boolean {
  return running || !!jobStats || !!jobId;
}

function JobLink({ jobId }: { jobId: string }) {
  const [copied, setCopied] = useState(false);
  const url = bigQueryJobUrl(jobId);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jobId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <span className="inline-flex items-center gap-1">
      {url ? (
        <button
          onClick={() => vscode.postMessage({ command: 'openExternal', value: url })}
          title={`View job in BigQuery: ${jobId}`}
          className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline cursor-pointer bg-transparent border-none p-0"
        >
          {shortJobId(jobId)}
        </button>
      ) : (
        <span title={jobId}>{shortJobId(jobId)}</span>
      )}
      <button
        onClick={copy}
        title="Copy job id"
        aria-label="Copy job id"
        className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] cursor-pointer bg-transparent border-none"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

/** One line on the query's job: how long it has been running, or the stats of the finished job */
export function JobStatusLine({ running, elapsedSeconds, jobStats, jobId, shownRows }: JobStatusLineProps) {
  const id = jobStats?.bigQueryJobId || jobId;
  const parts = running
    ? [`Running… ${elapsedSeconds < 60 ? `${elapsedSeconds}s` : formatDuration(elapsedSeconds * 1000)}`]
    : jobStatsParts(jobStats, shownRows);

  if (parts.length === 0 && !id) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 font-mono text-xs text-[var(--vscode-descriptionForeground)]">
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 && <span className="mr-2 opacity-50">·</span>}
          {part}
        </span>
      ))}
      {id && (
        <span className="whitespace-nowrap inline-flex items-center">
          {parts.length > 0 && <span className="mr-2 opacity-50">·</span>}
          <JobLink jobId={id} />
        </span>
      )}
    </div>
  );
}
