import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { CircleDashed, CheckCircle2, XCircle, RefreshCw, Clock, FileCode, Download } from 'lucide-react';
import { WorkflowAction, WorkflowUrlEntry } from '../types';
import { vscode } from '../utils/vscode';
import { TERMINAL_WORKFLOW_STATES } from '../utils/workflowPolling';
import { formatDuration, needsJobStats } from '../../../src/shared/jobTiming';
import { isTerminalRun } from '../../../src/shared/cliRunJobs';

/*
 * The list of a run's actions with what their BigQuery jobs did. A run through the API has a line for each action; a
 * run through the CLI, or with dbt, has a line for each job, named after the action it could be told for.
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

const DURATION_HELP = 'How long the BigQuery job took, start to end, including time spent waiting for free slots.';
const SLOT_TIME_HELP = 'How much compute the query used: working time added up across all the BigQuery workers (slots) that ran it. '
    + 'High slot time means an expensive query, even when the time is short.';

/** Time since a running action, or a CLI run's job, started, until its BigQuery job time is known. */
function runningElapsedMs(action: WorkflowAction): number | undefined {
    return action.state === 'RUNNING' && action.startTime ? Date.now() - action.startTime : undefined;
}

/** Start to end of the whole invocation; runs saved before timing was recorded have none. */
export function workflowDurationMs(entry: WorkflowUrlEntry | undefined): number | undefined {
    return entry?.invocationStartTime && entry.invocationEndTime ? entry.invocationEndTime - entry.invocationStartTime : undefined;
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

/** A chip that says whether a run went through the CLI or the Dataform API, and whether it was cut short */
export function RunViaTag({ entry }: { entry: WorkflowUrlEntry }) {
    const chip = 'px-1.5 py-0.5 rounded text-[10px] font-medium border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]';
    return (
        <>
            <span className={chip} title={entry.executionMode === 'dbt' ? 'Run with dbt build in the terminal' : entry.executionMode === 'cli' ? 'Run with the Dataform CLI in the terminal' : 'Run through the Dataform API'}>
                {isTerminalRun(entry) ? entry.executionMode : 'api'}
            </span>
            {entry.interrupted && (
                <span className={chip} title="The window was closed or reloaded while the run was going, so how it ended is told by its BigQuery jobs alone">
                    interrupted
                </span>
            )}
        </>
    );
}

// What needs a look is first: what failed, then what is at work. What is done follows, the slowest first
const STATE_RANK: Record<string, number> = { FAILED: 0, CANCELLED: 0, RUNNING: 1, PENDING: 2, SUCCEEDED: 3 };
const rankOf = (action: WorkflowAction) => STATE_RANK[action.state] ?? 4;
const timeOf = (action: WorkflowAction) => action.jobStats?.durationMs ?? runningElapsedMs(action) ?? -1;
const problemsThenSlowest = (a: WorkflowAction, b: WorkflowAction) => rankOf(a) - rankOf(b) || timeOf(b) - timeOf(a);

/** The states a count of the list can narrow it to, in the order their counts are shown */
const NARROWING = [
    { key: 'failed', label: 'failed', color: 'var(--vscode-errorForeground, #f14c4c)', has: (action: WorkflowAction) => rankOf(action) === 0 },
    { key: 'running', label: 'running', color: 'var(--vscode-textLink-foreground, #3794ff)', has: (action: WorkflowAction) => action.state === 'RUNNING' },
    { key: 'pending', label: 'pending', color: undefined, has: (action: WorkflowAction) => action.state === 'PENDING' },
    { key: 'skipped', label: 'skipped', color: undefined, has: (action: WorkflowAction) => rankOf(action) === 4 },
] as const;
type Narrowing = typeof NARROWING[number]['key'];

// The columns at the end of each line, and of the line that names them. They go as the panel narrows: the slot time
// first, then the bytes, which the cost follows from
const TIME_COLUMN = 'w-[52px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap';
const SLOT_COLUMN = 'hidden min-[560px]:block w-[56px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap';
const BILLED_COLUMN = 'hidden min-[420px]:block w-[76px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap';
const COST_COLUMN = 'w-[60px] flex-shrink-0 text-right font-mono text-xs tabular-nums whitespace-nowrap';
const HEADING = 'font-mono !text-[10px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]';
const MUTED = 'text-[var(--vscode-descriptionForeground)]';
const ICON_BUTTON = 'grid place-items-center w-[22px] h-[22px] flex-shrink-0 rounded border-0 bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)]';

/** One action, or one job, of a run: how it ended, its name, which opens its BigQuery job, and what the job did */
function ActionLine({ action, workflowInvocationId, isCli }: { action: WorkflowAction; workflowInvocationId: string | undefined; isCli: boolean }) {
    const parts = action.target.split('.');
    // A job that no action could be told for goes by the end of its ID, which has no dataset
    const dataset = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const name = parts[parts.length - 1];
    const stats = action.jobStats;
    const canOpen = !!action.jobId && !!workflowInvocationId;
    const succeeded = action.state === 'SUCCEEDED';
    const elapsedMs = runningElapsedMs(action);
    return (
        <div className="border-b border-[color-mix(in_srgb,var(--vscode-widget-border)_45%,transparent)]">
            <div className="flex items-center gap-2 min-h-[26px] px-3 py-0.5 text-[12.5px] hover:bg-[var(--vscode-list-hoverBackground)]">
                <span className="flex-shrink-0" title={action.state}>
                    {getStatusIcon(action.state)}
                    <span className="sr-only">{action.state}</span>
                </span>
                <span className="flex-1 min-w-0 truncate" title={action.target}>
                    {canOpen ? (
                        <button
                            onClick={() => vscode.postMessage({ command: 'dataform.openBigQueryJob', workflowInvocationId: workflowInvocationId!, action: action.target, jobId: action.jobId })}
                            className="p-0 border-0 bg-transparent font-mono text-[12.5px] text-[var(--vscode-foreground)] cursor-pointer hover:text-[var(--vscode-textLink-foreground)] hover:underline"
                            title={`Open the BigQuery job of ${action.target} in the Cloud console\n${action.jobId}`}
                        >
                            {name}
                        </button>
                    ) : <span className="font-mono">{name}</span>}
                    {dataset && <span className={clsx('hidden min-[560px]:inline ml-1.5 font-mono text-[11px]', MUTED)}>{dataset}</span>}
                </span>
                {canOpen && !isCli && (
                    <button
                        onClick={() => vscode.postMessage({ command: 'dataform.openExecutedSql', workflowInvocationId: workflowInvocationId!, action: action.target })}
                        className={ICON_BUTTON}
                        title="View executed SQL"
                        aria-label="View executed SQL"
                    >
                        <FileCode className="w-3.5 h-3.5" />
                    </button>
                )}
                {stats?.durationMs !== undefined ? (
                    <span className={clsx(TIME_COLUMN, MUTED)} title={`BigQuery job started ${new Date(stats.startTime!).toLocaleString()}\nEnded ${new Date(stats.endTime!).toLocaleString()}`}>{formatDuration(stats.durationMs)}</span>
                ) : elapsedMs !== undefined ? (
                    <span className={clsx(TIME_COLUMN, 'text-[var(--vscode-textLink-foreground)]')} title="Time since the action started; replaced by the BigQuery job time when it finishes">{formatDuration(elapsedMs)}</span>
                ) : (
                    <span className={clsx(TIME_COLUMN, MUTED)} title={stats?.error}>{stats?.error ? 'n/a' : ''}</span>
                )}
                <span className={clsx(SLOT_COLUMN, MUTED)} title={stats?.totalSlotMs === undefined ? undefined : `${stats.totalSlotMs.toLocaleString()} slot-ms`}>
                    {stats?.totalSlotMs === undefined ? '' : formatDuration(stats.totalSlotMs)}
                </span>
                <span className={clsx(BILLED_COLUMN, MUTED)} title={stats?.error}>{stats?.error ? 'n/a' : stats?.bytesBilledLabel ?? ''}</span>
                {/* Where there is no cost to tell, the state is told in its place: the line says in words why it has none */}
                <span className={clsx(COST_COLUMN, !succeeded && !stats?.costLabel && MUTED)}>
                    {stats?.costLabel ?? (succeeded ? '' : action.state.toLowerCase())}
                </span>
            </div>
            {action.failureReason && (
                <div className="pl-[34px] pr-3 pb-1.5 text-[11.5px] whitespace-pre-wrap break-words text-[var(--vscode-errorForeground)]">{action.failureReason}</div>
            )}
        </div>
    );
}

/**
 * The list, under a line with its filter, its counts and the CSV export. `tools` are at the end of that line. A line
 * still running shows the time since it started, so the list is drawn again every second while there is one.
 */
export function WorkflowActionsTable({ entry, className, tools }: { entry: WorkflowUrlEntry; className: string; tools?: ReactNode }) {
    const isCli = isTerminalRun(entry);
    const rows = useMemo<WorkflowAction[]>(() => entry.actions ?? [], [entry.actions]);
    const [filter, setFilter] = useState('');
    const [only, setOnly] = useState<Narrowing | null>(null);

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

    const counts = NARROWING.map((narrowing) => ({ ...narrowing, count: rows.filter(narrowing.has).length })).filter((narrowing) => narrowing.count > 0);
    // A count that has gone to none narrows nothing: a run that goes on has its last running line end
    const narrowing = counts.find((candidate) => candidate.key === only);
    const wanted = filter.trim().toLowerCase();
    const shown = rows.filter((row) => (!wanted || row.target.toLowerCase().includes(wanted)) && (!narrowing || narrowing.has(row))).sort(problemsThenSlowest);
    const done = rows.filter((row) => row.state === 'SUCCEEDED').length;
    const what = isCli ? 'BigQuery job' : 'action';

    return (
        <div data-run-actions={entry.workflowInvocationId ?? ''}>
            <div className="flex items-center gap-1.5 px-3 py-1 border-y border-[var(--vscode-widget-border)]">
                <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter…"
                    aria-label={`Filter the ${what}s`}
                    className="flex-1 min-w-[50px] max-w-[180px] h-[22px] px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
                />
                {counts.map(({ key, label, color, count }) => (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={only === key}
                        onClick={() => setOnly(only === key ? null : key)}
                        title={only === key ? `Show every ${what}` : `Show only the ${label} ones`}
                        className={clsx('inline-flex items-center flex-shrink-0 px-1.5 h-[18px] rounded border font-mono text-[10.5px] whitespace-nowrap bg-transparent', !color && 'border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]', !color && only === key && '!border-[var(--vscode-foreground)] !text-[var(--vscode-foreground)]')}
                        style={color ? { color, borderColor: `color-mix(in srgb, ${color} ${only === key ? 100 : 50}%, transparent)`, background: `color-mix(in srgb, ${color} ${only === key ? 28 : 10}%, transparent)` } : undefined}
                    >
                        {count} {label}
                    </button>
                ))}
                <span className={clsx('min-w-0 truncate text-[11px]', MUTED)}>{done} of {rows.length} {what}{rows.length === 1 ? '' : 's'} done</span>
                <span className="flex-1" />
                {tools}
                <button
                    onClick={() => entry.workflowInvocationId && vscode.postMessage({ command: 'dataform.exportWorkflowActionsCsv', workflowInvocationId: entry.workflowInvocationId })}
                    className={ICON_BUTTON}
                    title={`Export every ${isCli ? 'job' : 'action'} with its timing, slot time, bytes billed and cost to a CSV file`}
                    aria-label="Export CSV"
                >
                    <Download className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className={className}>
                <div className="sticky top-0 z-[1] flex items-center gap-2 h-6 px-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
                    <span className={clsx(HEADING, 'flex-1 min-w-0 truncate')}>problems first, then slowest</span>
                    <span className={clsx(HEADING, TIME_COLUMN)} title={DURATION_HELP}>Time</span>
                    <span className={clsx(HEADING, SLOT_COLUMN)} title={SLOT_TIME_HELP}>Slot</span>
                    <span className={clsx(HEADING, BILLED_COLUMN)}>Billed</span>
                    <span className={clsx(HEADING, COST_COLUMN)}>Cost</span>
                </div>
                {shown.map((row) => <ActionLine key={`${row.target}\n${row.jobId ?? ''}`} action={row} workflowInvocationId={entry.workflowInvocationId} isCli={isCli} />)}
                {shown.length === 0 && <p className={clsx('m-0 px-3 py-2 text-xs', MUTED)}>Nothing matches.</p>}
            </div>
        </div>
    );
}
