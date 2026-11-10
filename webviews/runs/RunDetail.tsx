import { ReactNode } from 'react';
import clsx from 'clsx';
import { ExternalLink, Loader2, Square } from 'lucide-react';
import { WorkflowUrlEntry } from '../preview_compiled/types';
import { vscode } from '../preview_compiled/utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../preview_compiled/utils/workflowPolling';
import { IncludedTargetsList } from '../preview_compiled/components/IncludedTargetsList';
import { RunStartSummary } from '../preview_compiled/components/RunStages';
import { RunViaTag, WorkflowActionsTable, getStatusIcon, useTick } from '../preview_compiled/components/WorkflowActionsTable';
import { isExternalRun, isTerminalRun } from '../../src/shared/cliRunJobs';
import { formatDuration } from '../../src/shared/jobTiming';
import { isApiRun, needsPolling } from '../../src/shared/runPolling';
import { whatRan } from './RunList';

/*
 * The run chosen in the Runs view: how it is doing and what it came to, then a line for each of its actions or
 * BigQuery jobs, with what each cost. A watched workflow's jobs are the costliest first; a run of yours has what failed
 * or is at work first.
 */

const MUTED = 'text-[var(--vscode-descriptionForeground)]';
const BUTTON = 'inline-flex items-center gap-1 h-[22px] px-2 rounded text-xs border-0 cursor-pointer';
const SECONDARY = 'bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]';

/** A line that says what is being waited for, with a spinner */
export function Waiting({ children }: { children: ReactNode }) {
    return (
        <p className={clsx('m-0 px-3 py-1 flex items-center gap-1.5', MUTED)} role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
            <span className="min-w-0 break-words">{children}</span>
        </p>
    );
}

/** How long the run took, or has taken so far while it goes */
function elapsedMs(entry: WorkflowUrlEntry, going: boolean): number | undefined {
    const start = entry.invocationStartTime;
    if (!start) { return undefined; }
    const end = entry.invocationEndTime ?? (going ? Date.now() : undefined);
    return end === undefined ? undefined : end - start;
}

export function RunDetail({ entry, jobsLeft = 0, problem, cliRunHint }: {
    entry: WorkflowUrlEntry;
    /** How many finished actions' BigQuery jobs are still being read for their cost */
    jobsLeft?: number;
    /** Why the run is no longer asked about */
    problem?: string;
    cliRunHint?: string;
}) {
    const going = !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state));
    useTick(going);
    const external = isExternalRun(entry);
    const watching = external && needsPolling(entry) && !problem;
    const elapsed = elapsedMs(entry, going);
    const summary = entry.jobStatsSummary;
    const hasActions = (entry.actions?.length ?? 0) > 0;
    const manyTargets = !entry.includedTags?.length && (entry.includedTargets?.length ?? 0) > 1;
    // An API run's actions are read by the host; until they are, it says so
    const readingActions = !entry.actions && isApiRun(entry) && !problem;

    return (
        <div className="flex flex-col min-h-0 h-full text-xs">
            <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 px-3 py-1.5">
                {getStatusIcon(entry.state)}
                <span>{entry.state || 'UNKNOWN'}</span>
                <span className={MUTED}>·</span>
                <span className="font-mono truncate max-w-[28rem]" title={entry.workflowInvocationId}>{external ? entry.workflowInvocationId : whatRan(entry)}</span>
                <RunViaTag entry={entry} />
                {!isTerminalRun(entry) && entry.repositoryName && (
                    <span className={MUTED} title="Repository, project and location">{entry.repositoryName} ({entry.projectId}, {entry.location})</span>
                )}
                {elapsed !== undefined && <><span className={MUTED}>·</span><span>{formatDuration(elapsed)}</span></>}
                {summary?.costLabel && <><span className={MUTED}>·</span><span title={summary.bytesBilledLabel ? `${summary.bytesBilledLabel} billed` : undefined}>{summary.costLabel}</span></>}
                {jobsLeft > 0 && (
                    <span className={clsx('inline-flex items-center gap-1', MUTED)} role="status">
                        <Loader2 className="w-3 h-3 animate-spin" />reading the cost of {jobsLeft} job{jobsLeft === 1 ? '' : 's'}
                    </span>
                )}
                {watching && <span className={MUTED}>watching, checks every 5s</span>}
                <span className="flex-1" />
                {watching && entry.workflowInvocationId && (
                    <button
                        type="button"
                        className={clsx(BUTTON, SECONDARY)}
                        onClick={() => vscode.postMessage({ command: 'watch.stop', workflowInvocationId: entry.workflowInvocationId! })}
                        title="Stop following it. The workflow is not cancelled: it carries on in GCP"
                    >
                        <Square className="w-3 h-3" />Stop watching
                    </button>
                )}
                {entry.url && (
                    <button
                        type="button"
                        className={clsx(BUTTON, 'bg-transparent text-[var(--vscode-textLink-foreground)] hover:underline px-0')}
                        onClick={() => vscode.postMessage({ command: 'openExternal', url: entry.url })}
                        title="Open the workflow in the Cloud console"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />Open in console
                    </button>
                )}
            </div>
            {(entry.stages || manyTargets || entry.jobsNote || problem) && (
                <div className={clsx('flex flex-col gap-0.5 px-3 pb-1.5', MUTED)}>
                    <RunStartSummary entry={entry} />
                    {manyTargets && <IncludedTargetsList targets={entry.includedTargets!} typeCounts={entry.includedTargetTypes} />}
                    {entry.jobsNote && <div>{entry.jobsNote}</div>}
                    {problem && <div className="text-[var(--vscode-errorForeground)] break-words">{problem}</div>}
                </div>
            )}
            <div className="flex-1 min-h-0 flex flex-col">
                {hasActions ? (
                    <WorkflowActionsTable entry={entry} className="flex-1 min-h-0 overflow-auto" costsLoading={jobsLeft > 0} order={external ? 'cost' : 'problems'} />
                ) : entry.failedActions?.length ? (
                    <ul className="m-0 py-0 px-3 list-none flex flex-col gap-1.5 overflow-auto">
                        {entry.failedActions.map((failed, i) => (
                            <li key={i}>
                                <div className="font-mono break-all">{failed.target}</div>
                                <div className="whitespace-pre-wrap break-words text-[var(--vscode-errorForeground)]">{failed.failureReason}</div>
                            </li>
                        ))}
                    </ul>
                ) : readingActions ? (
                    <Waiting>Reading the workflow's actions…</Waiting>
                ) : (
                    <p className={clsx('m-0 px-3', MUTED)}>
                        {isTerminalRun(entry) && cliRunHint ? cliRunHint : going ? 'No actions yet.' : 'No actions are known for this run.'}
                    </p>
                )}
            </div>
        </div>
    );
}
