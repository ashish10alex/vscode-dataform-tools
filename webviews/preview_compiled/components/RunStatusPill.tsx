import { useEffect, useRef, useState } from 'react';
import { ArrowDown, Check, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';
import { PanelState, WorkflowAction, WorkflowUrlEntry } from '../types';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { formatDuration } from '../../../src/shared/jobTiming';
import { runProgress } from '../../../src/shared/cliRunJobs';
import { CancelWorkflowButton } from './CancelWorkflowButton';
import { useTick } from './WorkflowActionsTable';
import { RunStageChecklist, RunStartSummary, clock, jobsLookedFor, runVia } from './RunStages';
import { runStage } from '../../../src/shared/runStages';

/** Asks the latest-run banner, which is under the compiled query, to open and come into view */
export const SHOW_RUN_DETAILS_EVENT = 'dataform:show-run-details';

const LINK = 'text-[var(--vscode-textLink-foreground)]';
const SUCCESS = 'text-[var(--vscode-extensionIcon-preReleaseForeground)]';
const ERROR = 'text-[var(--vscode-errorForeground)]';
const MUTED = 'text-[var(--vscode-descriptionForeground)]';

function hasEnded(entry: WorkflowUrlEntry): boolean {
    return !!entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state);
}

/** For how long the run has gone, from the moment it was invoked when that is known */
function runClock(entry: WorkflowUrlEntry): string {
    const started = entry.stages?.invokedAt ?? entry.invocationStartTime ?? entry.timestamp;
    return clock((hasEnded(entry) ? entry.invocationEndTime ?? started : Date.now()) - started);
}

function rowDot(state: string): string {
    switch (state) {
        case 'RUNNING': return 'bg-[var(--vscode-textLink-foreground)] animate-pulse';
        case 'SUCCEEDED': return 'bg-[var(--vscode-extensionIcon-preReleaseForeground)]';
        case 'FAILED':
        case 'CANCELLED': return 'bg-[var(--vscode-errorForeground)]';
        default: return 'bg-[var(--vscode-descriptionForeground)] opacity-50';
    }
}

function rowTime(row: WorkflowAction): string {
    if (row.jobStats?.durationMs !== undefined) {
        return formatDuration(row.jobStats.durationMs);
    }
    if (row.state === 'RUNNING') {
        return row.startTime ? formatDuration(Date.now() - row.startTime) : 'running';
    }
    return row.state === 'PENDING' ? 'queued' : row.state.toLowerCase();
}

/**
 * The newest run, in the panel's header: whether it went through the CLI or the Dataform API, how many of its jobs
 * (CLI) or actions (API) are running, have succeeded and have failed, and for how long it has run. It is there while
 * a run goes, and stays for a run that ended while the panel was open until it is dismissed or the next run starts:
 * a run that had ended before the panel opened is old news, and is in the Executions tab. A click lists the jobs.
 *
 * It is there from the moment a run is invoked, before the run is in the history: until its first job it says which
 * stage the run is in (see src/shared/runStages.ts), and a click lists the stages.
 */
export function RunStatusPill({ state, onDetails }: { state: PanelState; onDetails: () => void }) {
    const latest = (state.dataform.workflowUrls || []).slice().sort((a, b) => b.timestamp - a.timestamp)[0];
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState<number | null>(null);
    const seenGoing = useRef<Set<number>>(new Set());
    const root = useRef<HTMLDivElement>(null);

    // A run that was invoked and is not in the history yet is newer than any that is
    const invoked = state.dataform.pendingRun ?? undefined;
    const pending = invoked && (!latest || invoked.stages.invokedAt >= (latest.stages?.invokedAt ?? latest.timestamp)) ? invoked : undefined;

    const ended = latest ? hasEnded(latest) : true;
    if (latest && !ended) {
        seenGoing.current.add(latest.timestamp);
    }
    const shown = !!latest && (!ended || (seenGoing.current.has(latest.timestamp) && dismissed !== latest.timestamp));
    useTick(!!pending || (shown && !ended));

    useEffect(() => {
        if (!open) { return; }
        const onMouseDown = (event: MouseEvent) => {
            if (!root.current?.contains(event.target as Node)) { setOpen(false); }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { setOpen(false); }
        };
        document.addEventListener('mousedown', onMouseDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const pillClass = "flex items-center gap-1.5 h-6 pl-1 pr-2 rounded-full border border-current bg-transparent font-mono text-[11px] tabular-nums whitespace-nowrap hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors";
    const pillStyle = { borderColor: 'color-mix(in srgb, currentColor 45%, transparent)' };
    const viaChip = (via: string) => (
        <span className="px-1.5 rounded-full bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] text-[9px] font-semibold uppercase tracking-wider leading-4">{via}</span>
    );
    const popoverClass = "absolute right-0 top-full mt-1 w-[22rem] max-w-[calc(100vw-1.5rem)] p-1.5 rounded-md border border-[var(--vscode-menu-border,var(--vscode-widget-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] shadow-lg z-20 text-xs";

    if (pending) {
        const stage = runStage(pending.stages, pending.via) ?? 'starting';
        const label = `${pending.via === 'cli' ? 'CLI' : 'API'} run ${stage}`;
        return (
            <div ref={root} className="relative mr-1">
                <button onClick={() => setOpen(!open)} title={`${label}. Click for its stages`} aria-label={label} aria-haspopup="dialog" aria-expanded={open} className={pillClass} style={pillStyle}>
                    {viaChip(pending.via)}
                    <span className={clsx('flex items-center gap-1', LINK)}><RefreshCw className="w-3 h-3 animate-spin" />{stage}</span>
                    <span className={MUTED}>{clock(Date.now() - pending.stages.invokedAt)}</span>
                </button>
                {open && (
                    <div role="dialog" aria-label="Run being started" className={popoverClass}>
                        <RunStageChecklist stages={pending.stages} via={pending.via} />
                    </div>
                )}
            </div>
        );
    }

    if (!shown || !latest) { return null; }

    const isCli = latest.executionMode === 'cli';
    const progress = runProgress(latest);
    const failed = latest.state === 'FAILED' || latest.state === 'CANCELLED' || progress.failed > 0;
    const tone = failed ? ERROR : ended ? SUCCESS : LINK;
    const rows = latest.actions ?? [];
    // Until a CLI run's first job, the stage it is in says more than "running"
    const stage = latest.stages && rows.length === 0 ? runStage(latest.stages, runVia(latest)) : undefined;
    const waiting = !ended ? stage : undefined;
    const unit = isCli ? 'job' : 'action';
    const summary = [
        `${isCli ? 'CLI' : 'API'} run ${waiting ?? (latest.state ?? 'unknown').toLowerCase()}`,
        progress.running > 0 && `${progress.running} running`,
        progress.succeeded > 0 && `${progress.succeeded} succeeded`,
        progress.failed > 0 && `${progress.failed} failed`,
    ].filter(Boolean).join(', ');

    return (
        <div ref={root} className="relative mr-1">
            <button
                onClick={() => setOpen(!open)}
                title={`${summary}. Click for its ${unit}s`}
                aria-label={summary}
                aria-haspopup="dialog"
                aria-expanded={open}
                className={pillClass}
                style={pillStyle}
            >
                {viaChip(isCli ? 'cli' : 'api')}
                {!ended && (
                    <span className={clsx('flex items-center gap-1', LINK)}>
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        {progress.running > 0 && progress.running}
                        {/* The stage is the news while there is no count; "running" is not, once there is */}
                        {waiting && latest.state !== 'CANCELING'
                            ? <span>{waiting}</span>
                            : <span className="hidden sm:inline">{latest.state === 'CANCELING' ? 'stopping' : 'running'}</span>}
                    </span>
                )}
                {progress.succeeded > 0 && <span className={clsx('flex items-center', SUCCESS)}><Check className="w-3 h-3" />{progress.succeeded}</span>}
                {progress.failed > 0 && <span className={clsx('flex items-center', ERROR)}><X className="w-3 h-3" />{progress.failed}</span>}
                {ended && progress.total === 0 && <span className={tone}>{(latest.state ?? '').toLowerCase()}</span>}
                <span className={MUTED}>{runClock(latest)}</span>
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label="Latest run"
                    className={popoverClass}
                >
                    <div className="flex items-center gap-2 px-1.5 py-1">
                        <span className={clsx('font-mono', tone)}>{latest.state || 'UNKNOWN'}</span>
                        <span className={clsx('truncate', MUTED)}>
                            {latest.includedTags?.length ? `tags: ${latest.includedTags.join(', ')}` : isCli ? 'dataform run' : latest.workspace}
                        </span>
                        <span className={clsx('ml-auto font-mono whitespace-nowrap', MUTED)}>
                            {progress.total} {unit}{progress.total === 1 ? '' : 's'}
                        </span>
                    </div>
                    {rows.length > 0 && <RunStartSummary entry={latest} className="px-1.5 pb-1" />}
                    {stage && latest.stages ? (
                        <>
                            <RunStageChecklist stages={latest.stages} via={runVia(latest)} ended={ended} lookingFor={jobsLookedFor(latest)} />
                            {latest.jobsNote && <div className={clsx('px-1.5 py-1', MUTED)}>{latest.jobsNote}</div>}
                        </>
                    ) : rows.length > 0 ? (
                        <div className="max-h-56 overflow-auto">
                            {rows.map((row, index) => (
                                <div key={row.jobId ?? `${row.target}-${index}`} className="flex items-center gap-2 px-1.5 py-1 rounded-sm hover:bg-[var(--vscode-toolbar-hoverBackground)]" title={row.failureReason ? `${row.target}\n${row.failureReason}` : row.target}>
                                    <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', rowDot(row.state))} />
                                    <span className="font-mono truncate">{row.target.split('.').pop()}</span>
                                    <span className={clsx('ml-auto font-mono text-[10px] flex-shrink-0', row.state === 'FAILED' ? ERROR : MUTED)}>{rowTime(row)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={clsx('px-1.5 py-1', MUTED)}>{latest.jobsNote ?? (ended ? `No ${unit}s.` : `Waiting for the first ${unit}…`)}</div>
                    )}
                    <div className="flex items-center gap-2 mt-1 pt-1.5 px-1.5 border-t border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border))]">
                        <button
                            onClick={() => { setOpen(false); onDetails(); }}
                            className={clsx('inline-flex items-center gap-1 bg-transparent border-0 p-0 hover:underline', LINK)}
                            title="Show the run under the compiled query, with what each job cost"
                        >
                            Details <ArrowDown className="w-3 h-3" />
                        </button>
                        <span className="ml-auto" />
                        <CancelWorkflowButton entry={latest} />
                        {ended && (
                            <button
                                onClick={() => { setOpen(false); setDismissed(latest.timestamp); }}
                                className={clsx('bg-transparent border-0 p-0 hover:underline', MUTED)}
                                title="Hide this until the next run. The run stays in the Executions tab"
                            >
                                Dismiss
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
