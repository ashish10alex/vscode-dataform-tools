import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDashed, CheckCircle2, XCircle, RefreshCw, Clock, ExternalLink, FileCode, Download } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import { WorkflowAction, WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { DataTable } from '../../components/ui/data-table';
import { formatDuration, needsJobStats } from '../../../src/shared/jobTiming';

/*
 * The table of a run's actions with what their BigQuery jobs did. A run through the API has a row for each action; a
 * run through the CLI has a row for each job, named after the action it could be told for.
 */

export function getStatusIcon(status?: string | null) {
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

/** Time since a running action, or a CLI run's job, started, until its BigQuery job time is known. */
function runningElapsedMs(action: WorkflowAction): number | undefined {
    return action.state === 'RUNNING' && action.startTime ? Date.now() - action.startTime : undefined;
}

/** Start to end of the whole invocation; runs saved before timing was recorded have none. */
export function workflowDurationMs(entry: WorkflowUrlEntry | undefined): number | undefined {
    return entry?.invocationStartTime && entry.invocationEndTime ? entry.invocationEndTime - entry.invocationStartTime : undefined;
}

/**
 * The first cell of a row: the state as an icon, and the action's name, which opens its BigQuery job in the Cloud
 * console. The name is the link so that it is in view however narrow the panel is: a column of its own was the last
 * one, out of sight until the table was scrolled. The dataset is on a line above the table, so neither wraps mid-word.
 */
function TargetCell({ action, workflowInvocationId, isCli }: { action: WorkflowAction; workflowInvocationId: string | undefined; isCli: boolean }) {
    const parts = action.target.split('.');
    // A job that no action could be told for goes by the end of its ID, which has no dataset
    const dataset = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const name = (
        <>
            {dataset && <span className="block text-[10px] text-[var(--vscode-descriptionForeground)]">{dataset}</span>}
            <span className="font-medium">{parts[parts.length - 1]}</span>
        </>
    );
    const canOpen = !!action.jobId && !!workflowInvocationId;
    return (
        <div className="flex items-start gap-1.5 font-mono text-xs">
            <span className="mt-0.5 flex-shrink-0" title={action.state}>
                {getStatusIcon(action.state)}
                <span className="sr-only">{action.state}</span>
            </span>
            {canOpen ? (
                <button
                    onClick={() => vscode.postMessage({ command: 'dataform.openBigQueryJob', workflowInvocationId: workflowInvocationId!, action: action.target, jobId: action.jobId })}
                    className="group/link min-w-0 p-0 border-0 bg-transparent text-left break-all text-[var(--vscode-textLink-foreground)] hover:text-[var(--vscode-textLink-activeForeground)] hover:underline"
                    title={`Open the BigQuery job of ${action.target} in the Cloud console\n${action.jobId}`}
                >
                    {name}
                    <ExternalLink className="inline w-3 h-3 ml-1 align-[-1px] opacity-60 group-hover/link:opacity-100" />
                </button>
            ) : (
                <span className="min-w-0 break-all text-[var(--vscode-foreground)]" title={action.target}>{name}</span>
            )}
            {canOpen && !isCli && (
                <button
                    onClick={() => vscode.postMessage({ command: 'dataform.openExecutedSql', workflowInvocationId: workflowInvocationId!, action: action.target })}
                    className="ml-auto flex-shrink-0 p-0.5 rounded border-0 bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-textLink-foreground)]"
                    title="View executed SQL"
                    aria-label="View executed SQL"
                >
                    <FileCode className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
}

/**
 * Totals cover the whole workflow regardless of the table's filters: `jobStatsSummary` for BigQuery stats, and the
 * invocation's wall-clock time for Duration, since actions run in parallel.
 */
function buildActionColumns(workflowInvocationId: string | undefined, summary: WorkflowUrlEntry['jobStatsSummary'], totalDurationMs: number | undefined, isCli: boolean): ColumnDef<WorkflowAction>[] {
    const jobCount = (actions: WorkflowAction[]) => actions.filter(a => a.jobStats && !a.jobStats.error).length;
    return [
    {
        // The state is in this column, as an icon, so the column sorts by it first and its filter takes it too
        id: 'target',
        header: 'Target',
        size: 300,
        accessorFn: (action) => `${action.state} ${action.target}`,
        cell: ({ row }) => <TargetCell action={row.original} workflowInvocationId={workflowInvocationId} isCli={isCli} />,
        footer: summary ? ({ table }) => (
            <span className="text-xs font-semibold text-[var(--vscode-foreground)]">
                Total ({jobCount(table.getCoreRowModel().rows.map(r => r.original))} BigQuery jobs)
            </span>
        ) : undefined,
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
    ];
}

/** Draws the component again every second while `active`, for the times it shows that count up */
export function useTick(active: boolean) {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!active) { return; }
        const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
        return () => clearInterval(timer);
    }, [active]);
}

/** What a run was started through, in the words of the Execution Mode column */
export function executionModeLabel(entry: WorkflowUrlEntry): string {
    switch (entry.executionMode) {
        case 'cli': return 'CLI';
        case 'api_workspace': return 'GCP Workspace';
        default: return 'gitCommitish';
    }
}

/** A chip that says whether a run went through the CLI or the Dataform API, and whether it was cut short */
export function RunViaTag({ entry }: { entry: WorkflowUrlEntry }) {
    const chip = 'px-1.5 py-0.5 rounded text-[10px] font-medium border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]';
    return (
        <>
            <span className={chip} title={entry.executionMode === 'cli' ? 'Run with the Dataform CLI in the terminal' : 'Run through the Dataform API'}>
                {entry.executionMode === 'cli' ? 'cli' : 'api'}
            </span>
            {entry.interrupted && (
                <span className={chip} title="The window was closed or reloaded while the run was going, so how it ended is told by its BigQuery jobs alone">
                    interrupted
                </span>
            )}
        </>
    );
}

/**
 * The table, under a line with its count and the CSV export. A row still running shows the time since it started,
 * so the table is drawn again every second while there is one.
 */
export function WorkflowActionsTable({ entry, className }: { entry: WorkflowUrlEntry; className: string }) {
    const isCli = entry.executionMode === 'cli';
    const rows = useMemo<WorkflowAction[]>(() => entry.actions ?? [], [entry.actions]);
    const totalDurationMs = workflowDurationMs(entry);
    const columns = useMemo(
        () => buildActionColumns(entry.workflowInvocationId, entry.jobStatsSummary, totalDurationMs, isCli),
        [entry.workflowInvocationId, entry.jobStatsSummary, totalDurationMs, isCli]
    );

    useTick(rows.some((row) => row.state === 'RUNNING'));

    // Job stats normally arrive with each status refresh while the run is in progress. This one-off request
    // covers history entries that finished without them, when the user opens the run details.
    const statsRequestedFor = useRef<Set<string>>(new Set());
    useEffect(() => {
        const invocationId = entry.workflowInvocationId;
        if (!invocationId || statsRequestedFor.current.has(invocationId)) { return; }
        const isFinished = !!entry.state && TERMINAL_WORKFLOW_STATES.has(entry.state);
        if (isFinished && rows.some(needsJobStats)) {
            statsRequestedFor.current.add(invocationId);
            vscode.postMessage({ command: 'dataform.loadWorkflowJobStats', workflowInvocationId: invocationId });
        }
    }, [entry.workflowInvocationId, entry.state, rows]);

    if (rows.length === 0) { return null; }

    return (
        <>
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--vscode-foreground)]">
                {isCli ? 'BigQuery jobs' : 'Actions'} ({rows.length})
                <button
                    onClick={() => entry.workflowInvocationId && vscode.postMessage({ command: 'dataform.exportWorkflowActionsCsv', workflowInvocationId: entry.workflowInvocationId })}
                    className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-normal text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                    title={`Export every ${isCli ? 'job' : 'action'} with its timing, slot time, bytes billed and cost to a CSV file`}
                >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                </button>
            </div>
            <div className={className}>
                <DataTable
                    columns={columns}
                    data={rows}
                    paginated={false}
                    autoFocusColumnId="target"
                    initialSorting={[{ id: 'target', desc: false }]}
                    stickyFirstColumn
                    footerPosition="top"
                />
            </div>
        </>
    );
}
