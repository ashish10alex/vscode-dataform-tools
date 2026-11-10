import { KeyboardEvent } from 'react';
import clsx from 'clsx';
import { WorkflowUrlEntry } from '../preview_compiled/types';
import { TERMINAL_WORKFLOW_STATES } from '../preview_compiled/utils/workflowPolling';
import { CancelWorkflowButton } from '../preview_compiled/components/CancelWorkflowButton';
import { RunViaTag, getStatusIcon, useTick, workflowDurationMs } from '../preview_compiled/components/WorkflowActionsTable';
import { clock } from '../preview_compiled/components/RunStages';
import { formatAgo } from '../preview_compiled/components/LastRunCard';
import { useNow } from '../preview_compiled/components/CompilationInfoBadge';
import { isExternalRun, isTerminalRun, runProgress } from '../../src/shared/cliRunJobs';
import { formatDuration } from '../../src/shared/jobTiming';
import { runKey } from '../../src/shared/runPolling';

/*
 * The runs of the workspace, newest first: a line for each, which shows its jobs beside the list when it is chosen.
 * The Last run row of a dbt Project's panel says a run in the words of `runFacts` too.
 */

/** What a run was asked to run, in a few words: its tags, its one action, or the first of its actions and how many more */
export function whatRan(entry: WorkflowUrlEntry): string {
    const targets = entry.includedTargets ?? [];
    if (entry.includedTags?.length) {
        return `tag${entry.includedTags.length === 1 ? "" : "s"} ${entry.includedTags.join(", ")}`;
    }
    if (targets.length > 0) {
        return `${targets[0].name}${targets.length > 1 ? ` +${targets.length - 1}` : ""}`;
    }
    if (isExternalRun(entry)) {
        return entry.workflowInvocationId ?? "workflow";
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
        isTerminalRun(entry) ? null : isExternalRun(entry) ? `repository ${entry.repositoryName || entry.workspace || "unknown"}` : `${entry.executionMode === "api_workspace" ? "workspace" : "git commit"} ${entry.workspace || "unknown"}`,
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

/** The runs, newest first; the one chosen is marked, and the arrow keys move the choice */
export function RunList({ runs, selected, onSelect, className }: {
    /** Newest first */
    runs: WorkflowUrlEntry[];
    selected?: string;
    onSelect: (key: string) => void;
    className?: string;
}) {
    const now = useNow(30_000);
    // The time a run has gone for is counted here, between what the host sends
    useTick(runs.some((entry) => !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state))));

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
        const index = runs.findIndex((entry) => runKey(entry) === selected);
        const next = runs[Math.min(runs.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
            event.preventDefault();
            onSelect(runKey(next));
            // The button of the run chosen takes the focus, so the keys go on moving from it
            (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-run-key="${CSS.escape(runKey(next))}"]`)?.focus();
        }
    };

    return (
        <div className={className} onKeyDown={onKeyDown} aria-label="Runs, newest first" role="group">
            {runs.map((item) => {
                const key = runKey(item);
                const isSelected = key === selected;
                return (
                    <div
                        key={key}
                        data-run={item.state || 'UNKNOWN'}
                        className={clsx(
                            "flex items-center gap-2 pr-2 border-b border-[color-mix(in_srgb,var(--vscode-widget-border)_60%,transparent)] text-[12.5px]",
                            isSelected
                                ? "bg-[var(--vscode-list-inactiveSelectionBackground)] text-[var(--vscode-list-inactiveSelectionForeground,var(--vscode-foreground))]"
                                : "hover:bg-[var(--vscode-list-hoverBackground)]",
                        )}
                    >
                        <button
                            type="button"
                            data-run-key={key}
                            onClick={() => onSelect(key)}
                            aria-current={isSelected ? 'true' : undefined}
                            title={isSelected ? undefined : 'Show its jobs'}
                            className="flex-1 min-w-0 pl-3 py-1.5 text-left bg-transparent border-0 cursor-pointer text-inherit focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
                        >
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="flex-shrink-0" title={`Status: ${item.state || 'UNKNOWN'}`}>
                                    {getStatusIcon(item.state)}
                                    <span className="sr-only">{item.state || 'UNKNOWN'}</span>
                                </span>
                                <span className="min-w-0 truncate font-mono">{whatRan(item)}</span>
                                <RunViaTag entry={item} />
                            </span>
                            <span className="block pl-5 truncate text-[11px] text-[var(--vscode-descriptionForeground)]">{runFacts(item) || (item.state ?? 'unknown').toLowerCase()}</span>
                        </button>
                        <CancelWorkflowButton entry={item} />
                        <span className="flex-shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)] whitespace-nowrap" title={new Date(item.timestamp).toLocaleString()}>{formatAgo(item.timestamp, now)}</span>
                    </div>
                );
            })}
        </div>
    );
}
