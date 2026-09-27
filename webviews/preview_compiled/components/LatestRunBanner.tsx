import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDashed, CheckCircle2, XCircle, RefreshCw, Clock, ChevronRight, ChevronDown, ExternalLink, Loader2, FileCode, Download } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { WebviewState, ActionCounts, WorkflowAction, WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { DataTable } from '../../components/ui/data-table';
import { formatDuration, needsJobStats } from '../../../src/shared/jobTiming';
import { CancelWorkflowButton } from './CancelWorkflowButton';

interface LatestRunBannerProps {
    state: WebviewState;
    submittingSince?: number | null;
}

function getStatusIcon(status?: string | null) {
    if (!status) { return <CircleDashed className="w-3.5 h-3.5 text-[var(--vscode-descriptionForeground)]" />; }
    switch (status) {
        case 'SUCCEEDED':
            return <CheckCircle2 className="w-3.5 h-3.5 text-[var(--vscode-extensionIcon-preReleaseForeground)]" />;
        case 'FAILED':
        case 'CANCELLED':
            return <XCircle className="w-3.5 h-3.5 text-[var(--vscode-errorForeground)]" />;
        case 'RUNNING':
            return <RefreshCw className="w-3.5 h-3.5 text-[var(--vscode-textLink-foreground)] animate-spin" />;
        default:
            return <Clock className="w-3.5 h-3.5 text-[var(--vscode-editorMarkerNavigationWarning-foreground)]" />;
    }
}

type BadgeTone = 'link' | 'success' | 'error' | 'muted';

function CountBadge({ tone, label, count }: { tone: BadgeTone; label: string; count: number }) {
    const toneClass =
        tone === 'success' ? 'text-[var(--vscode-extensionIcon-preReleaseForeground)] border-[var(--vscode-extensionIcon-preReleaseForeground)]' :
        tone === 'error' ? 'text-[var(--vscode-errorForeground)] border-[var(--vscode-errorForeground)]' :
        tone === 'link' ? 'text-[var(--vscode-textLink-foreground)] border-[var(--vscode-textLink-foreground)]' :
        'text-[var(--vscode-descriptionForeground)] border-[var(--vscode-widget-border)]';
    return (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${toneClass}`}>
            {label}: {count}
        </span>
    );
}

function CountBadgeText({ label, value }: { label: string; value?: string }) {
    if (!value) { return null; }
    return (
        <span className="px-1.5 py-0.5 rounded font-medium border border-[var(--vscode-widget-border)]">
            {label}: {value}
        </span>
    );
}

function renderCountBadges(counts: ActionCounts | undefined) {
    if (!counts || counts.total === 0) { return null; }
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">Actions ({counts.total}):</span>
            {counts.running > 0 && <CountBadge tone="link" label="Running" count={counts.running} />}
            {counts.succeeded > 0 && <CountBadge tone="success" label="Succeeded" count={counts.succeeded} />}
            {counts.failed > 0 && <CountBadge tone="error" label="Failed" count={counts.failed} />}
            {counts.pending > 0 && <CountBadge tone="muted" label="Pending" count={counts.pending} />}
            {counts.skipped > 0 && <CountBadge tone="muted" label="Skipped" count={counts.skipped} />}
        </div>
    );
}

const TOTAL_CELL_CLASS = 'font-mono text-[10px] font-semibold text-[var(--vscode-foreground)]';
const STAT_CELL_CLASS = 'font-mono text-[10px] text-[var(--vscode-descriptionForeground)]';

const DURATION_HELP = 'How long the BigQuery job took, start to end, including time spent waiting for free slots. '
    + 'The total is the whole workflow, start to end, since actions run in parallel.';
const SLOT_TIME_HELP = 'How much compute the query used: working time added up across all the BigQuery workers (slots) that ran it. '
    + 'High slot time means an expensive query, even when Duration is short. The total is the sum across jobs.';

/** Column header with a hover explanation; the dotted underline hints that there is one. */
function HelpHeader({ label, help }: { label: string; help: string }) {
    return <span title={help} className="cursor-help underline decoration-dotted underline-offset-2">{label}</span>;
}

/** Time since a running action started, from the Dataform API, until its BigQuery job time is known. */
function runningElapsedMs(action: WorkflowAction): number | undefined {
    return action.state === 'RUNNING' && action.startTime ? Date.now() - action.startTime : undefined;
}

/** Start to end of the whole invocation; runs saved before timing was recorded have none. */
function workflowDurationMs(entry: WorkflowUrlEntry | undefined): number | undefined {
    return entry?.invocationStartTime && entry.invocationEndTime ? entry.invocationEndTime - entry.invocationStartTime : undefined;
}

/**
 * Totals cover the whole workflow regardless of the table's filters: `jobStatsSummary` for BigQuery stats, and the
 * invocation's wall-clock time for Duration, since actions run in parallel.
 */
function buildActionColumns(workflowInvocationId: string | undefined, summary: WorkflowUrlEntry['jobStatsSummary'], totalDurationMs: number | undefined): ColumnDef<WorkflowAction>[] {
    const jobCount = (actions: WorkflowAction[]) => actions.filter(a => a.jobStats && !a.jobStats.error).length;
    return [
    {
        accessorKey: 'target',
        header: 'Target',
        size: 320,
        cell: ({ row }) => (
            <span className="font-mono text-xs text-[var(--vscode-foreground)] break-all">{row.original.target}</span>
        ),
        footer: summary ? ({ table }) => (
            <span className="text-xs font-semibold text-[var(--vscode-foreground)]">
                Total ({jobCount(table.getCoreRowModel().rows.map(r => r.original))} BigQuery jobs)
            </span>
        ) : undefined,
    },
    {
        accessorKey: 'state',
        header: 'State',
        size: 140,
        cell: ({ row }) => (
            <span className="inline-flex items-center gap-1">
                {getStatusIcon(row.original.state)}
                <span className="font-mono text-[10px] text-[var(--vscode-descriptionForeground)]">{row.original.state}</span>
            </span>
        ),
    },
    {
        id: 'duration',
        header: () => <HelpHeader label="Duration" help={DURATION_HELP} />,
        size: 110,
        accessorFn: (action) => action.jobStats?.durationMs ?? runningElapsedMs(action) ?? -1,
        cell: ({ row }) => {
            const stats = row.original.jobStats;
            if (stats?.durationMs !== undefined) {
                const title = `BigQuery job started ${new Date(stats.startTime!).toLocaleString()}\nEnded ${new Date(stats.endTime!).toLocaleString()}`;
                return <span className={STAT_CELL_CLASS} title={title}>{formatDuration(stats.durationMs)}</span>;
            }
            const elapsedMs = runningElapsedMs(row.original);
            if (elapsedMs !== undefined) {
                return (
                    <span className={`${STAT_CELL_CLASS} italic opacity-70 whitespace-nowrap`} title="Time since the action started; replaced by the BigQuery job time when it finishes">
                        running · {formatDuration(elapsedMs)}
                    </span>
                );
            }
            return <span className={STAT_CELL_CLASS} title={stats?.error}>{stats?.error ? 'n/a' : ''}</span>;
        },
        footer: totalDurationMs !== undefined
            ? () => <span className={TOTAL_CELL_CLASS} title="Start to end of the whole workflow; actions run in parallel">{formatDuration(totalDurationMs)}</span>
            : undefined,
    },
    {
        id: 'slotTime',
        header: () => <HelpHeader label="Slot Time" help={SLOT_TIME_HELP} />,
        size: 110,
        accessorFn: (action) => action.jobStats?.totalSlotMs ?? -1,
        cell: ({ row }) => {
            const slotMs = row.original.jobStats?.totalSlotMs;
            return slotMs === undefined ? null : (
                <span className={STAT_CELL_CLASS} title={`${slotMs.toLocaleString()} slot-ms`}>{formatDuration(slotMs)}</span>
            );
        },
        footer: summary?.totalSlotMs !== undefined
            ? () => <span className={TOTAL_CELL_CLASS} title={`${summary.totalSlotMs!.toLocaleString()} slot-ms`}>{formatDuration(summary.totalSlotMs!)}</span>
            : undefined,
    },
    {
        id: 'bytesBilled',
        header: 'Bytes Billed',
        size: 110,
        accessorFn: (action) => action.jobStats?.totalBytesBilled ?? -1,
        cell: ({ row }) => {
            const stats = row.original.jobStats;
            return (
                <span className="font-mono text-[10px] text-[var(--vscode-descriptionForeground)]" title={stats?.error}>
                    {stats?.error ? 'n/a' : stats?.bytesBilledLabel ?? ''}
                </span>
            );
        },
        footer: summary ? () => <span className={TOTAL_CELL_CLASS}>{summary.bytesBilledLabel}</span> : undefined,
    },
    {
        id: 'cost',
        header: 'Est. Cost',
        size: 100,
        accessorFn: (action) => action.jobStats?.cost ?? -1,
        cell: ({ row }) => (
            <span className="font-mono text-[10px] text-[var(--vscode-descriptionForeground)]">
                {row.original.jobStats?.costLabel ?? ''}
            </span>
        ),
        footer: summary ? () => <span className={TOTAL_CELL_CLASS}>{summary.costLabel}</span> : undefined,
    },
    {
        accessorKey: 'failureReason',
        header: 'Failure Reason',
        cell: ({ row }) => (
            <span className="text-[var(--vscode-errorForeground)] whitespace-pre-wrap break-words text-xs">
                {row.original.failureReason || ''}
            </span>
        ),
    },
    {
        id: 'job',
        header: 'Job',
        size: 70,
        enableSorting: false,
        cell: ({ row }) => row.original.jobId ? (
            <span className="inline-flex items-center gap-1">
                <button
                    onClick={() => vscode.postMessage({ command: 'openExecutedSql', value: { workflowInvocationId, target: row.original.target } })}
                    className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-textLink-foreground)]"
                    title="View executed SQL"
                    aria-label="View executed SQL"
                >
                    <FileCode className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={() => vscode.postMessage({ command: 'openBigQueryJob', value: { workflowInvocationId, target: row.original.target } })}
                    className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-textLink-foreground)]"
                    title={`Open BigQuery job ${row.original.jobId}`}
                    aria-label="Open BigQuery job in the Cloud Console"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </button>
            </span>
        ) : null,
    },
    ];
}

export function LatestRunBanner({ state, submittingSince }: LatestRunBannerProps) {
    const [expanded, setExpanded] = useState(false);
    const items = state.workflowUrls || [];
    const latest = items.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
    const actionRows = useMemo<WorkflowAction[]>(() => latest?.actions ?? [], [latest?.actions]);
    const totalDurationMs = workflowDurationMs(latest);
    const actionColumns = useMemo(
        () => buildActionColumns(latest?.workflowInvocationId, latest?.jobStatsSummary, totalDurationMs),
        [latest?.workflowInvocationId, latest?.jobStatsSummary, totalDurationMs]
    );

    // Job stats normally arrive with each status refresh while the run is in progress. This one-off request
    // covers history entries that finished without them, when the user opens the run details.
    const statsRequestedFor = useRef<Set<string>>(new Set());
    useEffect(() => {
        const invocationId = latest?.workflowInvocationId;
        if (!expanded || !invocationId || statsRequestedFor.current.has(invocationId)) { return; }
        const needsStats = actionRows.some(needsJobStats);
        const isFinished = !!latest?.state && TERMINAL_WORKFLOW_STATES.has(latest.state);
        if (needsStats && isFinished) {
            statsRequestedFor.current.add(invocationId);
            vscode.postMessage({ command: 'loadWorkflowJobStats', value: { workflowInvocationId: invocationId } });
        }
    }, [expanded, latest?.workflowInvocationId, latest?.state, actionRows]);

    const isSubmitting = submittingSince != null && (!latest || latest.timestamp <= submittingSince);

    if (isSubmitting) {
        return (
            <div className="mt-3 flex items-center gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--vscode-textLink-foreground)]" />
                <span className="text-[var(--vscode-foreground)]">Submitting workflow invocation…</span>
                <span className="text-[var(--vscode-descriptionForeground)]">Compiling and triggering on GCP. This usually takes 2-10 seconds.</span>
            </div>
        );
    }

    if (!latest) { return null; }

    const isTerminal = !!latest.state && TERMINAL_WORKFLOW_STATES.has(latest.state);
    const elapsedSec = Math.max(0, Math.floor((Date.now() - latest.timestamp) / 1000));

    return (
        <div className="mt-3 flex flex-col gap-2 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background)] p-2.5">
            <div className="flex items-center gap-2 text-xs">
                <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)]"
                    aria-expanded={expanded}
                    aria-label={expanded ? 'Hide run details' : 'Show run details'}
                    title={expanded ? 'Hide run details' : 'Show run details'}
                >
                    {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {getStatusIcon(latest.state)}
                <span className="font-mono text-[var(--vscode-foreground)]">
                    Latest API run: {latest.workspace || '(unknown workspace)'} · {latest.state || 'UNKNOWN'}
                </span>
                <span
                    className="text-[var(--vscode-descriptionForeground)]"
                    title={new Date(latest.timestamp).toISOString()}
                >
                    · started {new Date(latest.timestamp).toLocaleString()}
                </span>
                {!isTerminal && (
                    <span className="text-[var(--vscode-descriptionForeground)]">· {elapsedSec}s elapsed</span>
                )}
                <span className="ml-auto" />
                <CancelWorkflowButton entry={latest} />
                <button
                    onClick={() => vscode.postMessage({ command: 'openExternal', url: latest.url })}
                    className="text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] inline-flex items-center gap-1 p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title="Open in GCP"
                    aria-label="Open in GCP"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </button>
            </div>

            {renderCountBadges(latest.actionCounts)}

            {isTerminal && (latest.jobStatsSummary || totalDurationMs !== undefined) && (
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--vscode-descriptionForeground)]">
                    <CountBadgeText label="Duration" value={totalDurationMs === undefined ? undefined : formatDuration(totalDurationMs)} />
                    {latest.jobStatsSummary && (
                        <>
                            <span>BigQuery:</span>
                            <CountBadgeText label="Slot time" value={latest.jobStatsSummary.totalSlotMs === undefined ? undefined : formatDuration(latest.jobStatsSummary.totalSlotMs)} />
                            <CountBadgeText label="Billed" value={latest.jobStatsSummary.bytesBilledLabel} />
                            <CountBadgeText label="Est. cost" value={latest.jobStatsSummary.costLabel} />
                        </>
                    )}
                </div>
            )}

            {expanded && (
                <div className="flex flex-col gap-3 mt-1 pt-2 border-t border-[var(--vscode-widget-border)]">
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                        <span className="text-[var(--vscode-descriptionForeground)]">Time</span>
                        <span className="text-[var(--vscode-foreground)]">{new Date(latest.timestamp).toLocaleString()}</span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Target Workspace</span>
                        <span>
                            <span className="px-2 py-0.5 rounded-full bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] text-xs font-mono">
                                {latest.workspace || 'unknown'}
                            </span>
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Action</span>
                        <span className="text-[var(--vscode-foreground)]">
                            {latest.includedTags && latest.includedTags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {latest.includedTags.map((tag, i) => (
                                        <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--vscode-button-secondaryBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-widget-border)]">
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            ) : latest.includedTargets && latest.includedTargets.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                    {latest.includedTargets.map((t: any, i: number) => (
                                        <span key={i} className="break-all" title={`${t.database}.${t.schema}.${t.name}`}>
                                            {t.schema}.{t.name}
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[var(--vscode-descriptionForeground)] opacity-60 italic">Full workspace</span>
                            )}
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Execution Mode</span>
                        <span className="text-[var(--vscode-foreground)]">
                            {latest.executionMode === 'api_workspace' ? 'GCP Workspace' : 'gitCommitish'}
                        </span>

                        <span className="text-[var(--vscode-descriptionForeground)]">Execution Options</span>
                        <span>
                            <div className="flex flex-wrap gap-1.5">
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.fullRefresh
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    Full Refresh
                                </span>
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.includeDependencies
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    +Deps
                                </span>
                                <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                                        latest.includeDependents
                                            ? 'bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border-[var(--vscode-badge-background)]'
                                            : 'bg-[var(--vscode-sideBar-background)] border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]'
                                    }`}
                                >
                                    +Dependents
                                </span>
                            </div>
                        </span>
                    </div>

                    {actionRows.length > 0 && (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2 text-xs font-medium text-[var(--vscode-foreground)]">
                                Actions ({actionRows.length})
                                <button
                                    onClick={() => vscode.postMessage({ command: 'exportWorkflowActionsCsv', value: { workflowInvocationId: latest.workflowInvocationId } })}
                                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-normal text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                                    title="Export every action with its timing, slot time, bytes billed and cost to a CSV file"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    Export CSV
                                </button>
                            </div>
                            <div className="max-h-[28rem] overflow-auto">
                                <DataTable
                                    columns={actionColumns}
                                    data={actionRows}
                                    paginated={false}
                                    autoFocusColumnId="target"
                                    initialSorting={[{ id: 'state', desc: false }]}
                                    footerPosition="top"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
