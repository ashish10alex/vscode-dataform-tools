import type { ActionCounts, FailedAction, WorkflowAction, WorkflowActionJobStats } from '../types';

/*
 * The BigQuery jobs of a `dataform run` sent to the terminal, so that a CLI run has the table of jobs an API run has.
 * A port of xf's internal/runjobs, with one difference: the extension does not read what the CLI prints, so a job is
 * found and named from BigQuery alone. The CLI is told to start the IDs of the run's jobs with a prefix
 * (`--job-prefix`), the caller's jobs are listed for the ones that have it, and each is named after the table it
 * writes to. No `vscode` import: the host's part is src/cliRunJobs.ts.
 */

/** How often a run's jobs are listed */
export const POLL_MS = 2000;
/** With no word from the terminal, a run has ended once none of its jobs has been running for this long */
export const QUIET_MS = 30_000;
/** With no word from the terminal, a run none of whose jobs was ever found is given up on after this long */
export const NO_JOBS_MS = 5 * 60_000;
/** How long the jobs still running when a run ended are followed */
export const DRAIN_MS = 10 * 60_000;
/** A run left running by a closed window is not followed again once it is older than this */
export const RESUME_MAX_AGE_MS = 24 * 60 * 60_000;
/** How far BigQuery's clock may be behind this one */
export const CLOCK_SKEW_MS = 60_000;
/** How many runs, through the CLI and the API together, the history keeps */
export const MAX_RUN_HISTORY = 50;

/** The states of a run that has ended. UNKNOWN is a CLI run whose end nothing told of and whose jobs could not be read */
export const ENDED_RUN_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN']);

/** A BigQuery job as `jobs.list` gives it with the full projection; only what is read here */
export interface BigQueryJobMetadata {
    jobReference?: { projectId?: string; jobId?: string; location?: string };
    status?: { state?: string; errorResult?: { reason?: string; message?: string } };
    statistics?: {
        creationTime?: string | number;
        startTime?: string | number;
        query?: { ddlTargetTable?: TableReference };
        [key: string]: unknown;
    };
    configuration?: { query?: { query?: string; destinationTable?: TableReference } };
}

interface TableReference { projectId?: string; datasetId?: string; tableId?: string }

export interface TargetName { database?: string; schema?: string; name?: string }

/** An action as a job is matched to it. `queries` are those it runs as they are, as an operation does */
export interface MatchedAction { target: TargetName; queries?: string[] }

/** An ID for a run, of characters a BigQuery job ID may have */
export function newRunId(random: () => number = Math.random): string {
    let id = '';
    while (id.length < 8) {
        id += Math.floor(random() * 36).toString(36);
    }
    return id;
}

/** What `--job-prefix` is given for the run with this ID */
export function jobPrefixFlag(runId: string): string {
    return `vscode-${runId}`;
}

/** What the CLI starts the IDs of a run's jobs with when it is given `--job-prefix flag` */
export function jobIdPrefix(flag: string): string {
    return `dataform-${flag}-`;
}

/** The `dataform run` command line with the prefix for its jobs' IDs */
export function withJobPrefix(command: string, flag: string): string {
    return `${command} --job-prefix=${flag}`;
}

/** Whether what `dataform help run` printed lists the option that prefixes job IDs */
export function helpListsJobPrefix(help: string): boolean {
    return help.includes('--job-prefix');
}

/**
 * The project the CLI runs its jobs in: that of its credentials file, else as Google's client finds one with the
 * Application Default Credentials, else the Project's own. The order was found against a real project (xf#69).
 */
export function cliJobProject(from: { credentialsProject?: string; envProject?: string; quotaProject?: string; defaultProject?: string }): string | undefined {
    return [from.credentialsProject, from.envProject, from.quotaProject, from.defaultProject].find((project) => !!project?.trim())?.trim();
}

// A job's query tells its action when it opens by writing to the action's table: "create or replace table `p.d.t`
// as …", "insert into `p.d.t` …". An assertion's second job counts the rows of the view its first one made
const LEADING_COMMENTS = '(?:\\s+|--[^\\n]*\\n|/\\*[\\s\\S]*?\\*/)*';
const WRITES_TO = new RegExp(`^${LEADING_COMMENTS}(?:create|insert|merge|truncate|delete|update)\\b[a-z\\s]*\`([^\`]+)\``, 'i');
const COUNTS_ROWS_OF = new RegExp(`^${LEADING_COMMENTS}select\\s+sum\\(1\\)\\s+as\\s+row_count\\s+from\\s+\`([^\`]+)\``, 'i');

function tableName(table: TableReference | undefined): string | undefined {
    // The table of a query that names none is in a dataset BigQuery made for it, whose name starts with "_"
    if (!table?.projectId || !table.datasetId || !table.tableId || table.datasetId.startsWith('_')) {
        return undefined;
    }
    return `${table.projectId}.${table.datasetId}.${table.tableId}`;
}

/**
 * Names the action a job belongs to, of `actions`: the one whose table the job writes to, as BigQuery says, or as its
 * query opens; else the one that runs the job's query as it is. A table that is no action's is named as it is.
 * Undefined when the job tells of none.
 */
export function jobTargetMatcher(actions: MatchedAction[]): (job: BigQueryJobMetadata) => string | undefined {
    const byName = new Map<string, string>();
    const byQuery = new Map<string, string | undefined>();
    for (const { target, queries } of actions) {
        if (!target.schema || !target.name) {
            continue;
        }
        const full = [target.database, target.schema, target.name].filter(Boolean).join('.');
        byName.set(`${target.schema}.${target.name}`, full);
        byName.set(full, full);
        for (const query of queries ?? []) {
            const text = query.trim();
            // A query two actions run tells of neither
            byQuery.set(text, byQuery.has(text) ? undefined : full);
        }
    }
    return (job) => {
        const query = job.configuration?.query?.query ?? '';
        const written = [
            tableName(job.statistics?.query?.ddlTargetTable),
            tableName(job.configuration?.query?.destinationTable),
            WRITES_TO.exec(query)?.[1],
            COUNTS_ROWS_OF.exec(query)?.[1],
        ].filter((name): name is string => !!name);
        for (const name of written) {
            const target = byName.get(name);
            if (target) {
                return target;
            }
        }
        return written[0] ?? byQuery.get(query.trim());
    };
}

/** Whether a row's job has not ended */
export function isActiveJob(row: WorkflowAction): boolean {
    return row.state === 'RUNNING' || row.state === 'PENDING';
}

function jobState(status: BigQueryJobMetadata['status']): string {
    if (status?.state === 'DONE') {
        if (!status.errorResult) {
            return 'SUCCEEDED';
        }
        return status.errorResult.reason === 'stopped' ? 'CANCELLED' : 'FAILED';
    }
    return status?.state === 'PENDING' ? 'PENDING' : 'RUNNING';
}

/**
 * A row for each of `jobs` whose ID starts with `idPrefix`, oldest first. A job no action can be told for goes by
 * the end of its ID.
 */
export function runJobRows(
    jobs: BigQueryJobMetadata[],
    idPrefix: string,
    nameOf: (job: BigQueryJobMetadata) => string | undefined,
    toStats: (statistics: unknown, location: string | undefined) => WorkflowActionJobStats,
): WorkflowAction[] {
    const rows: WorkflowAction[] = [];
    for (const job of jobs) {
        const ref = job.jobReference;
        if (!ref?.jobId?.startsWith(idPrefix)) {
            continue;
        }
        const state = jobState(job.status);
        const started = Number(job.statistics?.startTime ?? job.statistics?.creationTime);
        const row: WorkflowAction = {
            target: nameOf(job) ?? `job …${ref.jobId.slice(idPrefix.length)}`,
            state,
            jobId: ref.projectId && ref.location ? `${ref.projectId}:${ref.location}.${ref.jobId}` : ref.jobId,
        };
        if (Number.isFinite(started)) {
            row.startTime = started;
        }
        if (job.status?.errorResult?.message) {
            row.failureReason = job.status.errorResult.message;
        }
        if (job.status?.state === 'DONE') {
            row.jobStats = toStats(job.statistics, ref.location);
        }
        rows.push(row);
    }
    return rows.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0) || (a.jobId ?? '').localeCompare(b.jobId ?? ''));
}

export function countJobRows(rows: WorkflowAction[]): ActionCounts {
    const counts: ActionCounts = { total: rows.length, pending: 0, running: 0, succeeded: 0, failed: 0, cancelled: 0, skipped: 0 };
    for (const row of rows) {
        switch (row.state) {
            case 'PENDING': counts.pending++; break;
            case 'RUNNING': counts.running++; break;
            case 'SUCCEEDED': counts.succeeded++; break;
            case 'FAILED': counts.failed++; break;
            case 'CANCELLED': counts.cancelled++; break;
        }
    }
    return counts;
}

export function failedJobRows(rows: WorkflowAction[]): FailedAction[] {
    return rows.filter((row) => row.state === 'FAILED' && row.failureReason).map((row) => ({ target: row.target, failureReason: row.failureReason! }));
}

/**
 * The state a run ended in. The CLI's exit code says when the terminal gave one; otherwise the jobs do. A run the
 * user cancelled is CANCELLED however it ended, unless it did all it had to.
 */
export function finalRunState(rows: WorkflowAction[], how: { exitCode?: number; cancelling?: boolean }): string {
    if (how.exitCode === 0) {
        return 'SUCCEEDED';
    }
    if (how.cancelling) {
        return 'CANCELLED';
    }
    if (how.exitCode !== undefined || rows.some((row) => row.state === 'FAILED')) {
        return 'FAILED';
    }
    return rows.some((row) => row.state === 'CANCELLED') ? 'CANCELLED' : 'SUCCEEDED';
}

/**
 * Whether a run the terminal tells nothing of has ended, by its jobs alone: 'ended' once some were found and none has
 * been running for a while, 'no jobs' when none was found in a longer while.
 */
export function quietVerdict(at: { now: number; startedAt: number; sawJobs: boolean; lastActiveAt?: number }): 'ended' | 'no jobs' | undefined {
    if (at.sawJobs) {
        return at.now - (at.lastActiveAt ?? at.startedAt) >= QUIET_MS ? 'ended' : undefined;
    }
    return at.now - at.startedAt >= NO_JOBS_MS ? 'no jobs' : undefined;
}

/** The history with `entry` added, trimmed to the newest runs */
export function withRunAdded<T>(history: T[], entry: T, max: number = MAX_RUN_HISTORY): T[] {
    return [...history, entry].slice(-max);
}
