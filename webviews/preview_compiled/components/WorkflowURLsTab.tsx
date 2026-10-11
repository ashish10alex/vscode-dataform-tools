import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { PanelState, CompilationErrorType, WorkflowUrlEntry } from '../types';
import { Cloud, ExternalLink, GitBranch, Trash2, Play, RefreshCw, ChevronRight, ChevronDown } from 'lucide-react';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { CancelWorkflowButton } from './CancelWorkflowButton';
import { IncludedTargetsList } from './IncludedTargetsList';
import { RunViaTag, WorkflowActionsTable, getStatusIcon, useTick, workflowDurationMs } from './WorkflowActionsTable';
import { RunStartSummary, clock } from './RunStages';
import { ROW_BUTTON, ROW_LABEL, ROW_PRIMARY_BUTTON } from './SummaryRow';
import { ApiRunGitChip } from './ApiRunGitChip';
import { API_COLOR } from './RunBackendSwitch';
import { formatAgo } from './LastRunCard';
import { useNow } from './CompilationInfoBadge';
import { panelProblem } from '../utils/panelProblem';
import { runProgress } from '../../../src/shared/cliRunJobs';
import { formatDuration } from '../../../src/shared/jobTiming';
import { ApiRunGitState, describeApiRunGitState } from '../../../src/shared/apiRunGitState';

interface WorkflowURLsTabProps {
    state: PanelState;
    isPolling?: boolean;
}

const isBlockingError = (errorType?: CompilationErrorType) => {
    return errorType === CompilationErrorType.COMPILATION_ERROR ||
           errorType === CompilationErrorType.MISSING_EXECUTABLE ||
           errorType === CompilationErrorType.NOT_A_DATAFORM_WORKSPACE;
};

const ICON_BUTTON = "grid place-items-center w-5 h-5 flex-shrink-0 rounded bg-transparent border-0 text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]";

type RunSource = "git" | "workspace";
const RUN_SOURCES = [
    { source: "git", label: "Git commit", Icon: GitBranch, title: "Run the committed code of your active git branch, as it is on the git remote" },
    { source: "workspace", label: "Workspace", Icon: Cloud, title: "Run your local files, by syncing them to the remote GCP Dataform workspace. Useful for testing without a commit" },
] as const;

/** What a run from the git remote would use, in a sentence. The chip beside it has what it would leave out */
export function gitRunLine(state: ApiRunGitState | undefined): string {
    if (!state || state.kind === "unavailable") {
        return "Runs the committed code of your active git branch, as it is on the git remote";
    }
    if (state.kind === "noUpstream") {
        return "Push the branch first: the Dataform API runs it as it is on the git remote";
    }
    const leftOut = state.uncommitted.length > 0 || state.unpushedFiles.length > 0;
    const behind = state.behind > 0 ? `, which has ${state.behind} commit${state.behind === 1 ? "" : "s"} you don't have locally` : "";
    return leftOut ? `Runs ${state.upstream}, not your local files${behind}` : `Runs ${state.upstream}${behind || ", which matches your local files"}`;
}

/** What a run was asked to run, in a few words: its tags, its one action, or the first of its actions and how many more */
function whatRan(entry: WorkflowUrlEntry): string {
    const targets = entry.includedTargets ?? [];
    if (entry.includedTags?.length) {
        return `tag${entry.includedTags.length === 1 ? "" : "s"} ${entry.includedTags.join(", ")}`;
    }
    return targets.length > 0 ? `${targets[0].name}${targets.length > 1 ? ` +${targets.length - 1}` : ""}` : "whole project";
}

/** The second line of a run: where it ran, how far it reached, how it ended and what it came to */
function runFacts(entry: WorkflowUrlEntry): string {
    const ended = !!entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state);
    const progress = runProgress(entry);
    const failed = ended && (entry.state === "FAILED" || progress.failed > 0);
    const duration = workflowDurationMs(entry);
    return [
        entry.executionMode === "cli" ? null : `${entry.executionMode === "api_workspace" ? "workspace" : "git commit"} ${entry.workspace || "unknown"}`,
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

export function WorkflowURLsTab({ state, isPolling = false }: WorkflowURLsTabProps) {
    useEffect(() => {
        vscode.postMessage({ command: 'dataform.loadWorkflowUrls' });
    }, []);

    const urls = state.dataform.workflowUrls || [];
    const now = useNow(30_000);
    // The time a run has gone for is counted here, between what the host sends
    useTick(urls.some((entry) => !(entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state))));

    const handleClearUrls = () => {
        vscode.postMessage({ command: 'dataform.clearWorkflowUrls' });
    };

    const handleRunApi = () => {
        vscode.postMessage({ command: 'dataform.runWithOptions', workspace: false });
    };

    /** Where the next run through the API comes from: the switch chooses, and one line says what that one would use */
    const [source, setSource] = useState<RunSource>("git");
    const gitState = state.dataform.apiRunGitState;
    const gitSummary = describeApiRunGitState(gitState);
    // The workspace a run syncs to has the name of the branch
    const localBranch = gitState && gitState.kind !== "unavailable" ? gitState.branch : undefined;

    const handleRunWorkspace = () => {
        vscode.postMessage({ command: 'dataform.runWithOptions', workspace: true });
    };

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

    const toggleRow = (timestamp: number) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(timestamp)) { next.delete(timestamp); } else { next.add(timestamp); }
            return next;
        });
    };

    const handleRefreshStatuses = () => {
        setIsRefreshing(true);
        vscode.postMessage({ command: 'dataform.refreshWorkflowStatuses' });
        setTimeout(() => setIsRefreshing(false), 1000);
    };

    return (
        <div className="pb-10">
            {/* The panel's padding is taken back: the rows run from edge to edge, as those of the compiled query do */}
            <div className="-mx-4 -mt-4">
                {!isBlockingError(panelProblem(state).type ?? undefined) && (
                    <div className="border-b border-[var(--vscode-widget-border)] text-[12.5px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[30px] px-3 py-[3px]">
                            <span className={ROW_LABEL}>API run</span>
                            <div role="radiogroup" aria-label="Run from" className="inline-flex items-center h-6 p-[2px] rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex-shrink-0">
                                {RUN_SOURCES.map(({ source: option, label, Icon, title }) => (
                                    <button
                                        key={option}
                                        type="button"
                                        role="radio"
                                        aria-checked={option === source}
                                        onClick={() => setSource(option)}
                                        title={title}
                                        // In the colour the Dataform API has in the Run row of the compiled query
                                        style={option === source ? { background: `color-mix(in srgb, ${API_COLOR} 50%, transparent)` } : undefined}
                                        className={clsx(
                                            "flex items-center gap-1 h-full px-1.5 rounded-sm border-0 text-xs whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
                                            option === source
                                                ? "text-[var(--vscode-foreground)] font-medium"
                                                : "bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
                                        )}
                                    >
                                        <Icon className="w-3 h-3" /> {label}
                                    </button>
                                ))}
                            </div>
                            <span className="flex-1" />
                            <button
                                onClick={source === "git" ? handleRunApi : handleRunWorkspace}
                                className={ROW_PRIMARY_BUTTON}
                                title={source === "git" ? "Choose files or tags, and run them from the branch on the git remote" : "Choose files or tags, and run them from your local files, synced to the GCP workspace"}
                            >
                                <Play className="w-3 h-3" /> Run…
                            </button>
                        </div>
                        {/* What the chosen run would use: one line, of the one that is chosen */}
                        <div data-run-source={source} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-1.5 min-[520px]:pl-[82px] text-xs text-[var(--vscode-descriptionForeground)]">
                            {source === "git" ? (
                                <>
                                    {gitSummary && gitSummary.tone !== "muted" && <ApiRunGitChip state={gitState} />}
                                    <span title={gitSummary?.tooltip}>{gitRunLine(gitState)}</span>
                                </>
                            ) : (
                                <span>
                                    Runs your local files, uncommitted changes included, synced to the GCP workspace
                                    {localBranch ? <> <span className="font-mono text-[var(--vscode-foreground)]">{localBranch}</span></> : " named after your git branch"}
                                </span>
                            )}
                        </div>
                    </div>
                )}

                <div className={clsx("flex items-center gap-2 min-h-[30px] px-3 border-b border-[var(--vscode-widget-border)] text-[12.5px]", urls.length === 0 && "opacity-50")}>
                    <span className={ROW_LABEL}>History</span>
                    <span className="flex-1 min-w-0 truncate text-[var(--vscode-foreground)]">
                        {urls.length === 0 ? "No runs yet. Runs through the CLI and the Dataform API appear here" : `${urls.length} run${urls.length === 1 ? "" : "s"}, newest first`}
                    </span>
                    {urls.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={handleRefreshStatuses} className={ROW_BUTTON} title="Refresh the status of every run">
                                <RefreshCw className={clsx("w-3 h-3", (isRefreshing || isPolling) && "animate-spin")} /> Refresh
                            </button>
                            <button onClick={handleClearUrls} className={ROW_BUTTON} title="Clear the history of runs">
                                <Trash2 className="w-3 h-3" /> Clear
                            </button>
                        </div>
                    )}
                </div>

                {state.dataform.cliRunHint && (
                    <p className="m-0 px-3 py-1.5 border-b border-[var(--vscode-widget-border)] text-xs text-[var(--vscode-descriptionForeground)]">{state.dataform.cliRunHint}</p>
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
                                <div className="flex flex-col gap-1.5 px-3 pb-3 pt-0.5 min-[520px]:pl-[54px]">
                                    {manyTargets && (
                                        <div className="text-xs text-[var(--vscode-descriptionForeground)]">
                                            <IncludedTargetsList targets={item.includedTargets!} typeCounts={item.includedTargetTypes} />
                                        </div>
                                    )}
                                    {hasActions && (
                                        <>
                                            {item.jobsNote && <div className="text-[11px] text-[var(--vscode-descriptionForeground)]">{item.jobsNote}</div>}
                                            <RunStartSummary entry={item} />
                                            <WorkflowActionsTable entry={item} className="max-h-[28rem] overflow-auto" />
                                        </>
                                    )}
                                    {hasFailures && !hasActions && (
                                        <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
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
            </div>
        </div>
    );
}
