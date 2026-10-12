import { useState } from 'react';
import clsx from 'clsx';
import { WorkflowUrlEntry } from '../types';
import { ExternalLink, Trash2, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { CancelWorkflowButton } from './CancelWorkflowButton';
import { IncludedTargetsList } from './IncludedTargetsList';
import { RunViaTag, WorkflowActionsTable, getStatusIcon, useTick, workflowDurationMs } from './WorkflowActionsTable';
import { RunStartSummary, clock } from './RunStages';
import { ROW_BUTTON, ROW_LABEL } from './SummaryRow';
import { formatAgo } from './LastRunCard';
import { useNow } from './CompilationInfoBadge';
import { isTerminalRun, runProgress } from '../../../src/shared/cliRunJobs';
import { formatDuration } from '../../../src/shared/jobTiming';

/*
 * The history of runs, newest first: a line for each, which opens to its actions or its BigQuery jobs. The Executions
 * tab of a Dataform Project's panel has it under the API run row; the Runs tab of a dbt Project's is this alone.
 */

const ICON_BUTTON = "grid place-items-center w-5 h-5 flex-shrink-0 rounded bg-transparent border-0 text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]";

/** What a run was asked to run, in a few words: its tags, its one action, or the first of its actions and how many more */
function whatRan(entry: WorkflowUrlEntry): string {
    const targets = entry.includedTargets ?? [];
    if (entry.includedTags?.length) {
        return `tag${entry.includedTags.length === 1 ? "" : "s"} ${entry.includedTags.join(", ")}`;
    }
    if (targets.length > 0) {
        return `${targets[0].name}${targets.length > 1 ? ` +${targets.length - 1}` : ""}`;
    }
    // dbt finds what changed itself, when the run starts
    return entry.dbt?.command.includes("state:modified") ? "what changed" : "whole project";
}

/** The second line of a run: where it ran, how far it reached, how it ended and what it came to */
export function runFacts(entry: WorkflowUrlEntry): string {
    const ended = !!entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state);
    const progress = runProgress(entry);
    const failed = ended && (entry.state === "FAILED" || progress.failed > 0);
    const duration = workflowDurationMs(entry);
    return [
        isTerminalRun(entry) ? null : `${entry.executionMode === "api_workspace" ? "workspace" : "git commit"} ${entry.workspace || "unknown"}`,
        entry.includeDependencies ? "+deps" : null,
        entry.includeDependents ? "+dependents" : null,
        entry.fullRefresh ? "full refresh" : null,
        !ended ? `${entry.state === "CANCELING" ? "stopping" : entry.state ? entry.state.toLowerCase() : "unknown"} · ${clock(Date.now() - (entry.stages?.invokedAt ?? entry.invocationStartTime ?? entry.timestamp))}` : null,
        !ended && progress.total > 0 ? `${progress.succeeded} of ${progress.total} done` : null,
        failed ? (progress.failed > 0 ? `${progress.failed} of ${progress.total} failed` : "failed") : null,
        ended && !failed && entry.state !== "SUCCEEDED" ? entry.state!.toLowerCase() : null,
        duration !== undefined ? formatDuration(duration) : null,
        entry.jobStatsSummary?.bytesBilledLabel ? `${entry.jobStatsSummary.bytesBilledLabel} billed` : null,
        entry.jobStatsSummary?.costLabel,
    ].filter(Boolean).join(" · ");
}
export function RunHistory({ urls, hint, isPolling = false, refreshable = true, empty = "No runs yet. Runs through the CLI and the Dataform API appear here" }: {
    urls: WorkflowUrlEntry[];
    /** Why the jobs of terminal runs are not listed, when they can't be */
    hint?: string;
    isPolling?: boolean;
    /** Whether a run's status can be asked for again: that of a run through the Dataform API can */
    refreshable?: boolean;
    empty?: string;
}) {
    const now = useNow(30_000);
    // The time a run has gone for is counted here, between what the host sends
    useTick(urls.some((entry) => !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state))));
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    const toggleRow = (timestamp: number) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(timestamp)) { next.delete(timestamp); } else { next.add(timestamp); }
            return next;
        });
    };

    const handleClearUrls = () => {
        vscode.postMessage({ command: 'dataform.clearWorkflowUrls' });
    };

    const handleRefreshStatuses = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'dataform.refreshWorkflowStatuses' });
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    return (
        <>
        <div className={clsx("flex items-center gap-2 min-h-[30px] px-3 border-b border-[var(--vscode-widget-border)] text-[12.5px]", urls.length === 0 && "opacity-50")}>
            <span className={ROW_LABEL}>History</span>
            <span className="flex-1 min-w-0 truncate text-[var(--vscode-foreground)]">
                {urls.length === 0 ? empty : `${urls.length} run${urls.length === 1 ? "" : "s"}, newest first`}
            </span>
            {urls.length > 0 && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                    {refreshable && (
                        <button onClick={handleRefreshStatuses} className={ROW_BUTTON} title="Refresh the status of every run">
                            <RefreshCw className={clsx("w-3 h-3", (isRefreshing || isPolling) && "animate-spin")} /> Refresh
                        </button>
                    )}
                    <button onClick={handleClearUrls} className={ROW_BUTTON} title="Clear the history of runs">
                        <Trash2 className="w-3 h-3" /> Clear
                    </button>
                </div>
            )}
        </div>

        {hint && (
            <p className="m-0 px-3 py-1.5 border-b border-[var(--vscode-widget-border)] text-xs text-[var(--vscode-descriptionForeground)]">{hint}</p>
        )}

        {urls.slice().reverse().map((item) => {
            const isExpanded = expandedRows.has(item.timestamp);
            const hasFailures = !!item.failedActions && item.failedActions.length > 0;
            // A run whose actions are known opens to all of them; one kept before they were, to those that failed
            const hasActions = !!item.actions && item.actions.length > 0;
            const manyTargets = !item.includedTags?.length && (item.includedTargets?.length ?? 0) > 1;
            const canOpen = hasFailures || hasActions || manyTargets;
            const details = hasActions ? 'run details' : hasFailures ? 'failed models' : 'actions';
            const line = (
                <>
                    <span className="flex items-center gap-1.5 min-w-0">
                        <span className="w-3 flex-shrink-0 text-[var(--vscode-descriptionForeground)]">
                            {canOpen && (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                        </span>
                        <span className="flex-shrink-0" title={`Status: ${item.state || 'UNKNOWN'}`}>
                            {getStatusIcon(item.state)}
                            <span className="sr-only">{item.state || 'UNKNOWN'}</span>
                        </span>
                        <span className="min-w-0 truncate font-mono text-[var(--vscode-foreground)]">{whatRan(item)}</span>
                        <RunViaTag entry={item} />
                    </span>
                    <span className="block pl-[42px] truncate text-[11px] text-[var(--vscode-descriptionForeground)]">{runFacts(item) || (item.state ?? 'unknown').toLowerCase()}</span>
                </>
            );
            return (
                <div key={item.timestamp} data-run={item.state || 'UNKNOWN'} className="border-b border-[color-mix(in_srgb,var(--vscode-widget-border)_60%,transparent)] text-[12.5px]">
                    <div className="flex items-center gap-2 px-3 hover:bg-[var(--vscode-list-hoverBackground)]">
                        {canOpen ? (
                            <button
                                type="button"
                                onClick={() => toggleRow(item.timestamp)}
                                aria-expanded={isExpanded}
                                title={isExpanded ? `Hide ${details}` : `Show ${details}`}
                                className="flex-1 min-w-0 py-1.5 text-left bg-transparent border-0 cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                            >
                                {line}
                            </button>
                        ) : <div className="flex-1 min-w-0 py-1.5">{line}</div>}
                        <CancelWorkflowButton entry={item} />
                        <span className="flex-shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)] whitespace-nowrap" title={new Date(item.timestamp).toLocaleString()}>{formatAgo(item.timestamp, now)}</span>
                        {item.url ? (
                            <button onClick={() => vscode.postMessage({ command: 'openExternal', url: item.url })} className={ICON_BUTTON} title="Open execution in GCP" aria-label="Open execution in GCP">
                                <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                        ) : <span className="w-5 flex-shrink-0" aria-hidden="true" />}
                    </div>
                    {isExpanded && canOpen && (
                        <div className="flex flex-col gap-1.5 pb-3 pt-0.5">
                            {manyTargets && (
                                <div className="pl-[54px] pr-3 text-xs text-[var(--vscode-descriptionForeground)]">
                                    <IncludedTargetsList targets={item.includedTargets!} typeCounts={item.includedTargetTypes} />
                                </div>
                            )}
                            {hasActions && (
                                <>
                                    {item.jobsNote && <div className="pl-[54px] pr-3 text-[11px] text-[var(--vscode-descriptionForeground)]">{item.jobsNote}</div>}
                                    <RunStartSummary entry={item} className="pl-[54px] pr-3" />
                                    <WorkflowActionsTable entry={item} className="max-h-[28rem] overflow-auto" />
                                </>
                            )}
                            {hasFailures && !hasActions && (
                                <ul className="m-0 py-0 pl-[54px] pr-3 list-none flex flex-col gap-1.5">
                                    {item.failedActions!.map((fa, i) => (
                                        <li key={i} className="text-xs">
                                            <div className="font-mono break-all text-[var(--vscode-foreground)]">{fa.target}</div>
                                            <div className="whitespace-pre-wrap break-words text-[var(--vscode-errorForeground)]">{fa.failureReason}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            );
        })}
        </>
    );
}
