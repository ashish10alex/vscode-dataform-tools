import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { quotedCli } from './backend/dataform/run';
import { checkAuthentication, getBigQueryClientFor } from './bigqueryClient';
import { logger } from './logger';
import { compiledJson, projects } from './project';
import { resolveDataformOptions } from './project/dataformOptions';
import { extensionConfiguration } from './project/settings';
import { countActionTypes } from './shared/actionTypes';
import {
    BigQueryJobMetadata, CLOCK_SKEW_MS, DRAIN_MS, ENDED_RUN_STATES, MatchedAction, NO_JOBS_MS, POLL_MS, QUIET_MS, RESUME_MAX_AGE_MS,
    cliJobProject, countJobRows, failedJobRows, finalRunState, helpListsJobPrefix, isActiveJob, jobIdPrefix, jobPrefixFlag,
    isTerminalRun, jobTargetMatcher, newRunId, quietVerdict, runJobRows, withJobPrefix, withRunAdded,
} from './shared/cliRunJobs';
import {
    DbtRunResults, HEADER_WAIT_MS, NamedNode, NodeProgress, dbtJobNamer, dbtRunFiles, firstInvocation, nodeEvents, nodeNamer, ofInvocation, readRunResults,
    withNodeProgress, withNodeResults,
} from './shared/dbtRunJobs';
import { RunStages, SILENT_SHELL_MS } from './shared/runStages';
import { runSentUntracked, takeRunStages, whenCliSaysRunning } from './runFeedback';
import { SupportedCurrency, Target, WorkflowAction, WorkflowUrlEntry } from './types';
import { defaultCredentialFile } from './utils/googleAccounts';
import { runCommandInTerminal } from './utils/vscodeUi';
import { parseBigQueryJobId, summariseJobStats, toJobStats } from './workflowJobTelemetry';

/*
 * Follows the BigQuery jobs of the `dataform run` and `dbt build` commands the extension sends to the terminal, and
 * keeps each run in the history the API runs are in. See src/shared/cliRunJobs.ts for how the jobs of a Dataform run
 * are found, and src/shared/dbtRunJobs.ts for those of a dbt run.
 */

const HISTORY_KEY = 'dataform_workflow_urls';
/** How long one listing of the jobs, or the CLI's help, may take */
const LIST_TIMEOUT_MS = 15_000;
const HELP_TIMEOUT_MS = 30_000;

/** What a run was asked to run, for its row in the history */
export interface CliRunSelection {
    tags?: string[];
    targets?: Target[];
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
}

/** What is known of a dbt run beside its jobs */
interface DbtFollowed {
    root: string;
    /** The command line, as it was sent to the terminal */
    command: string;
    files: { log: string; results: string };
    /** How long dbt's log was when the run was sent: the run's own lines come after */
    logOffset: number;
    logSize?: number;
    /** How far dbt's log has been read, and the start of a line that was not whole yet */
    logRead?: { at: number; rest: string };
    /** The nodes the log has told of, by the name a row for the node has */
    nodes?: Map<string, NodeProgress>;
    /** The run's BigQuery jobs as last listed: `rows` has the nodes without one beside them */
    jobRows?: WorkflowAction[];
    /** The invocation's ID, once dbt's log, or `run_results.json`, has told it */
    invocationId?: string;
    /** How the run's nodes ended, once dbt has written it */
    results?: DbtRunResults;
    /** Ctrl+C was sent to the terminal */
    interruptSent?: boolean;
}

interface TrackedRun {
    /** The run's `workflowInvocationId` in the history */
    id: string;
    /** Dataform: what `--job-prefix` was given, which the run's command line in the terminal has */
    flag?: string;
    /** Dataform: what the IDs of the run's jobs start with */
    idPrefix?: string;
    /** Where the jobs are listed. A dbt run's may not be known before `run_results.json` says */
    projectId?: string;
    /** A dbt run. Its jobs are those dbt labelled with the invocation's ID */
    dbt?: DbtFollowed;
    startedAt: number;
    /** When each stage on the way to the run's first job was reached */
    stages: RunStages;
    terminal?: vscode.Terminal;
    nameOf: (job: BigQueryJobMetadata) => string | undefined;
    /** The terminal told of the command's start, so it will tell of its end */
    sawStart: boolean;
    ended?: { at: number; exitCode?: number; noJobs?: boolean };
    cancelling: boolean;
    cancelled: Set<string>;
    sawJobs: boolean;
    lastActiveAt?: number;
    /** A run found running when the window opened, whose jobs have not been listed yet */
    resumed: boolean;
    interrupted: boolean;
    listError?: string;
    rows: WorkflowAction[];
    written?: string;
    timer?: ReturnType<typeof setTimeout>;
    polling: boolean;
    pollAgain: boolean;
    stopped: boolean;
}

let extensionContext: vscode.ExtensionContext | undefined;
const runs = new Map<string, TrackedRun>();
/** Whether each Dataform CLI can prefix the IDs of a run's jobs, by its path. Asked once in a session */
const prefixes = new Map<string, Promise<boolean>>();
let hint: string | undefined;

/** Why the jobs of CLI runs are not listed, when the CLI can't prefix their IDs. Shown with the history */
export function cliRunHint(): string | undefined {
    return hint;
}

function history(context: vscode.ExtensionContext): WorkflowUrlEntry[] {
    return context.workspaceState.get<WorkflowUrlEntry[]>(HISTORY_KEY) || [];
}

function showHistory() {
    // The command is the panel's, and is not there before the extension has registered it
    vscode.commands.executeCommand('vscode-dataform-tools.refreshWorkflowUrls').then(undefined, () => undefined);
}

function trackingEnabled(workspaceFolder: string): boolean {
    return extensionConfiguration(vscode.Uri.file(workspaceFolder)).get<boolean>('trackCliRunJobs', true);
}

function cliPrefixesJobs(cliPath: string): Promise<boolean> {
    let asked = prefixes.get(cliPath);
    if (!asked) {
        asked = new Promise((resolve) => {
            exec(`${quotedCli(cliPath)} help run`, { timeout: HELP_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
                if (error) {
                    logger.debug(`Could not ask ${cliPath} whether it has --job-prefix: ${error.message}`);
                }
                resolve(helpListsJobPrefix(`${stdout}${stderr}`));
            });
        });
        prefixes.set(cliPath, asked);
    }
    return asked;
}

function readJson(file: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
        return {};
    }
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Where the CLI runs the jobs of a run of the Project at `root` */
function cliJobPlace(root: string): { projectId?: string; location?: string } {
    const credentials = readJson(path.join(root, '.df-credentials.json'));
    const config = compiledJson(root)?.projectConfig;
    return {
        projectId: cliJobProject({
            credentialsProject: text(credentials.projectId),
            envProject: process.env.GOOGLE_CLOUD_PROJECT,
            quotaProject: text(readJson(defaultCredentialFile().path).quota_project_id),
            defaultProject: config?.defaultDatabase,
        }),
        location: text(credentials.location) ?? text(config?.defaultLocation),
    };
}

function matchedActions(root?: string): MatchedAction[] {
    const compiled = compiledJson(root);
    return [
        ...[...(compiled?.tables ?? []), ...(compiled?.assertions ?? [])].map(({ target }) => ({ target })),
        ...(compiled?.operations ?? []).map(({ target, queries }) => ({ target, queries })),
    ];
}

function currency(): SupportedCurrency {
    return extensionConfiguration().get<SupportedCurrency>('currencyFoDryRunCost') || 'USD';
}

function withTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} took too long`)), LIST_TIMEOUT_MS);
        promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });
}

async function jobsClient(projectId: string) {
    const failure = await checkAuthentication();
    const client = failure ? undefined : await getBigQueryClientFor({ projectId });
    if (!client) {
        throw new Error(failure ?? 'there is no BigQuery client');
    }
    return client;
}

/** A row for each of the run's jobs, as BigQuery has them now */
async function listRows(run: TrackedRun): Promise<WorkflowAction[]> {
    const ofRun = run.dbt ? run.dbt.invocationId && ofInvocation(run.dbt.invocationId) : run.idPrefix;
    if (!ofRun || !run.projectId) {
        // dbt has not said yet which invocation the run is, or where it runs its jobs
        return run.dbt?.jobRows ?? run.rows;
    }
    const client = await jobsClient(run.projectId);
    const [jobs] = await withTimeout(client.getJobs({
        projection: 'full',
        allUsers: false,
        minCreationTime: String(run.startedAt - CLOCK_SKEW_MS),
        maxResults: 500,
    }), 'listing the BigQuery jobs');
    const unit = currency();
    const nameOf = run.dbt ? dbtNaming(run.dbt.root).nameOf : run.nameOf;
    return runJobRows(jobs.map((job) => job.metadata as BigQueryJobMetadata), ofRun, nameOf, (statistics, location) => toJobStats(statistics, location, unit));
}

interface DbtNaming {
    of: unknown;
    nameOfNode: (nodeId: string) => string;
    /** By what dbt v2's log calls a node: its dataset and name */
    nameOfRelation: (relation: string) => string;
    nameOf: (job: BigQueryJobMetadata) => string | undefined;
}
/** By Project root: how the nodes and jobs of its runs are named, from its last compile */
const namings = new Map<string, DbtNaming>();

/**
 * Names the nodes and the jobs of a dbt Project's runs after its actions, as its last compile has them. Before one,
 * as when a window opens on a run left running, a node goes by its own name.
 */
function dbtNaming(root: string): DbtNaming {
    const last = projects.find(root, 'dbt')?.dbtBackend?.lastResult;
    const known = namings.get(root);
    if (known && known.of === last) {
        return known;
    }
    const actions = Object.values(last?.graph.actions ?? {});
    const nodes: NamedNode[] = actions.flatMap((action) => {
        const name = last?.dbt?.names[action.id];
        return name ? [{ package: name.package, name: name.name, version: name.version, target: action.id }] : [];
    });
    const nameOfNode = nodeNamer(nodes);
    // A job without dbt's comment is named after the table it writes to, as a Dataform job is
    const byRelation = new Map(actions.map((action) => [`${action.target.schema}.${action.target.name}`, action.id]));
    // By name alone, where one action has the name
    const byName = new Map<string, string | undefined>();
    for (const action of actions) {
        byName.set(action.target.name, byName.has(action.target.name) ? undefined : action.id);
    }
    const naming = {
        of: last, nameOfNode,
        // A test's dataset in the log is the one its failures are stored in, which its action may not have
        nameOfRelation: (relation: string) => byRelation.get(relation) ?? byName.get(relation.slice(relation.lastIndexOf('.') + 1)) ?? relation,
        nameOf: dbtJobNamer(nameOfNode, jobTargetMatcher(actions.map(({ target }) => ({ target })))),
    };
    namings.set(root, naming);
    return naming;
}

function sizeOf(file: string): number | undefined {
    try {
        return fs.statSync(file).size;
    } catch {
        return undefined;
    }
}

function readFrom(file: string, offset: number): { text: string; size: number; end: number } | undefined {
    try {
        const size = fs.statSync(file).size;
        // A log shorter than it was has been rotated: the run's lines are from its start
        const from = size < offset ? 0 : offset;
        const buffer = Buffer.alloc(Math.min(size - from, 4 * 1024 * 1024));
        const handle = fs.openSync(file, 'r');
        try {
            fs.readSync(handle, buffer, 0, buffer.length, from);
        } finally {
            fs.closeSync(handle);
        }
        return { text: buffer.toString('utf8'), size, end: from + buffer.length };
    } catch {
        return undefined;
    }
}

/** `run_results.json`, when dbt wrote it after the run was sent */
function resultsSince(file: string, startedAt: number): DbtRunResults | undefined {
    try {
        if (fs.statSync(file).mtimeMs < startedAt - CLOCK_SKEW_MS) {
            return undefined;
        }
        return readRunResults(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined;
    }
}

/**
 * Reads what dbt has written of the run: the invocation's ID from the first start its log has after the run was
 * sent, which nodes dbt is on from the lines after that, and how the run ended from `run_results.json` once that is
 * the invocation's. With no start in the log, as when dbt writes it somewhere else, the results written since the
 * run was sent are taken for the run's.
 */
function readDbtFiles(run: TrackedRun, dbt: DbtFollowed, now: number) {
    const log = dbt.results ? undefined : readFrom(dbt.files.log, dbt.logRead?.at ?? dbt.logOffset);
    if (log) {
        const text = (dbt.logRead?.rest ?? '') + log.text;
        const whole = text.lastIndexOf('\n') + 1;
        dbt.logRead = { at: log.end, rest: text.slice(whole) };
        let lines = text.slice(0, whole);
        const started = dbt.nodes ? undefined : firstInvocation(lines);
        if (started) {
            dbt.invocationId ??= started.id;
            dbt.nodes = new Map();
            lines = lines.slice(started.after);
        }
        if (dbt.nodes) {
            const naming = dbtNaming(dbt.root);
            for (const event of nodeEvents(lines)) {
                const target = event.nodeId ? naming.nameOfNode(event.nodeId) : naming.nameOfRelation(event.relation!);
                dbt.nodes.set(target, { state: event.state, since: dbt.nodes.get(target)?.since ?? now });
            }
        }
    }
    if (!dbt.results) {
        const size = sizeOf(dbt.files.log);
        if (size !== undefined && size !== dbt.logSize) {
            // dbt is at work while it writes its log, whether or not a job is running
            dbt.logSize = size;
            run.lastActiveAt = now;
        }
    }
    if (!dbt.results && (dbt.invocationId || run.ended || now - run.startedAt >= HEADER_WAIT_MS)) {
        const results = resultsSince(dbt.files.results, run.startedAt);
        if (results && (dbt.invocationId ? results.invocationId === dbt.invocationId : results.generatedAt >= run.startedAt - CLOCK_SKEW_MS)) {
            dbt.results = results;
            dbt.invocationId = results.invocationId;
            // Where dbt says it ran the jobs is surer than what was read from the profile
            run.projectId = results.nodes.find((node) => node.projectId)?.projectId ?? run.projectId;
            run.listError = undefined;
            run.interrupted = false;
            run.ended ??= { at: now };
        }
    }
}

/** Why the jobs of a dbt run are not listed yet, or at all */
function dbtJobsNote(run: TrackedRun, dbt: DbtFollowed, now: number): string | undefined {
    if (!dbt.invocationId && (run.ended || now - run.startedAt >= HEADER_WAIT_MS)) {
        return `The run's BigQuery jobs are not listed: dbt wrote no start of a run to ${dbt.files.log}. Its jobs are found by the invocation ID dbt writes there, or to ${dbt.files.results} when the run ends.`;
    }
    if (dbt.invocationId && !run.projectId) {
        return "The run's BigQuery jobs are not listed: the project dbt runs them in could not be read from the profile.";
    }
    return undefined;
}

async function cancelJobs(run: TrackedRun, rows: WorkflowAction[]) {
    const { projectId } = run;
    if (!projectId) {
        return;
    }
    const client = await jobsClient(projectId);
    await Promise.all(rows.filter((row) => row.jobId && !run.cancelled.has(row.jobId)).map(async (row) => {
        run.cancelled.add(row.jobId!);
        const ref = parseBigQueryJobId(row.jobId!, projectId);
        try {
            await client.job(ref.jobId, { location: ref.location, projectId: ref.projectId }).cancel();
        } catch (error: any) {
            logger.error(`Unable to cancel BigQuery job ${row.jobId}: ${error.message}`);
        }
    }));
}

/** Writes what is known of the run to its entry in the history. False when the entry is no longer there */
async function writeEntry(context: vscode.ExtensionContext, run: TrackedRun): Promise<boolean> {
    const entries = history(context);
    const entry = entries.find((item) => item.workflowInvocationId === run.id);
    if (!entry) {
        return false;
    }
    entry.actions = run.rows;
    entry.actionCounts = countJobRows(run.rows);
    entry.jobStatsSummary = summariseJobStats(run.rows, currency());
    const failed = failedJobRows(run.rows);
    entry.failedActions = failed.length > 0 ? failed : undefined;
    entry.stages = run.stages;
    entry.jobsNote = run.listError ? `The run's BigQuery jobs can't be listed in ${run.projectId}: ${run.listError}` : run.dbt && dbtJobsNote(run, run.dbt, Date.now());
    if (run.dbt) {
        entry.dbt = { root: run.dbt.root, command: run.dbt.command, logOffset: run.dbt.logOffset, invocationId: run.dbt.invocationId };
        entry.projectId = run.projectId;
    }
    if (run.ended) {
        // dbt's own account of its nodes tells how a run ended as well as an exit code does
        const toldHow = run.ended.exitCode !== undefined || !!run.dbt?.results;
        entry.state = !toldHow && (run.listError || run.ended.noJobs) ? 'UNKNOWN' : finalRunState(run.rows, { exitCode: run.ended.exitCode, cancelling: run.cancelling });
        entry.invocationEndTime = run.ended.at;
        entry.interrupted = run.interrupted || undefined;
        if (run.ended.noJobs && !run.dbt?.results) {
            entry.jobsNote = run.dbt && !run.dbt.invocationId ? entry.jobsNote : `No BigQuery job of this run was found in ${run.projectId}. Its jobs are looked for among those of the account the extension signs in with.`;
        }
    } else {
        entry.state = run.cancelling ? 'CANCELING' : 'RUNNING';
    }
    const written = JSON.stringify(entry);
    if (written !== run.written) {
        run.written = written;
        await context.workspaceState.update(HISTORY_KEY, entries);
        showHistory();
    }
    return true;
}

function stop(run: TrackedRun) {
    run.stopped = true;
    clearTimeout(run.timer);
    runs.delete(run.id);
}

async function poll(context: vscode.ExtensionContext, run: TrackedRun): Promise<void> {
    if (run.stopped) {
        return;
    }
    if (run.polling) {
        run.pollAgain = true;
        return;
    }
    run.polling = true;
    clearTimeout(run.timer);
    try {
        if (run.dbt) {
            readDbtFiles(run, run.dbt, Date.now());
        }
        if (!run.listError) {
            try {
                run.rows = await listRows(run);
            } catch (error: any) {
                run.listError = error?.message ?? String(error);
                logger.error(`Unable to list the BigQuery jobs of the CLI run ${run.id}: ${run.listError}`);
            }
        }
        if (run.dbt) {
            // Beside its jobs a dbt run has the nodes dbt's log tells of, until dbt's own account of them is in
            const jobRows = run.listError ? run.dbt.jobRows ?? [] : run.rows;
            run.dbt.jobRows = jobRows;
            run.rows = run.dbt.results
                ? withNodeResults(jobRows, run.dbt.results, dbtNaming(run.dbt.root).nameOfNode)
                : run.ended ? jobRows : withNodeProgress(jobRows, run.dbt.nodes ?? new Map());
        }
        const now = Date.now();
        // A node dbt is on without a job is not waited on: if dbt went, nothing would tell that the node ended
        const active = run.rows.filter((row) => row.jobId && isActiveJob(row));
        const firstJob = run.rows.find((row) => row.jobId);
        if (!run.listError) {
            if (firstJob && !run.sawJobs) {
                run.sawJobs = true;
                run.lastActiveAt = now;
            }
            if (firstJob && !run.stages.firstJobAt) {
                // The job was started before it was listed, and after the stage the run was last known to be in
                const { compiledAt, startedAt, sentAt, invokedAt } = run.stages;
                run.stages.firstJobAt = Math.min(now, Math.max(compiledAt ?? startedAt ?? sentAt ?? invokedAt, firstJob.startTime ?? now));
            }
            if (active.length > 0) {
                run.lastActiveAt = now;
            }
            if (run.resumed && run.dbt) {
                // dbt may be at work between two jobs: its log and its jobs tell whether the run goes on
                run.resumed = false;
                run.interrupted = true;
                run.lastActiveAt = now;
            } else if (run.resumed) {
                // A run none of whose jobs is running when the window opens again was cut short with the window
                run.resumed = false;
                if (active.length === 0) {
                    run.interrupted = true;
                    run.ended = { at: now };
                }
            }
            if (run.cancelling && active.length > 0) {
                await cancelJobs(run, active);
            }
        }
        if (!run.stages.startedAt && !run.resumed) {
            run.stages.silentShell = !!run.stages.firstJobAt || now - (run.stages.sentAt ?? run.startedAt) >= SILENT_SHELL_MS;
        }
        if (!run.ended && !run.sawStart) {
            // Nothing will tell of the run's end, so its jobs do
            if (run.dbt) {
                // And dbt's log, which it writes to while it works. A run whose jobs can't be seen is waited on for
                // longer, as is one that has started none yet: dbt may be long at parsing the Project
                const blind = !!run.listError || !run.dbt.invocationId || !run.projectId;
                if (now - (run.lastActiveAt ?? run.startedAt) >= (blind ? DRAIN_MS : run.sawJobs ? QUIET_MS : NO_JOBS_MS)) {
                    run.ended = { at: now, noJobs: !firstJob };
                }
            } else if (run.listError) {
                if (now - run.startedAt >= QUIET_MS) {
                    run.ended = { at: now };
                }
            } else {
                const verdict = quietVerdict({ now, startedAt: run.startedAt, sawJobs: run.sawJobs, lastActiveAt: run.lastActiveAt });
                if (verdict) {
                    run.ended = { at: now, noJobs: verdict === 'no jobs' };
                }
            }
        }
        const followed = await writeEntry(context, run);
        // Jobs still running when the run ended, as after Ctrl+C, are followed until they end
        const drained = run.ended && (run.listError || active.length === 0 || now - run.ended.at >= DRAIN_MS);
        if (!followed || drained) {
            stop(run);
        }
    } finally {
        run.polling = false;
    }
    if (run.stopped) {
        return;
    }
    if (run.pollAgain) {
        run.pollAgain = false;
        return poll(context, run);
    }
    run.timer = setTimeout(() => poll(context, run), POLL_MS);
}

function track(context: vscode.ExtensionContext, run: Pick<TrackedRun, 'id' | 'startedAt' | 'stages'> & Partial<TrackedRun>, root?: string) {
    const tracked: TrackedRun = {
        nameOf: jobTargetMatcher(matchedActions(root)),
        sawStart: false,
        cancelling: false,
        cancelled: new Set(),
        sawJobs: false,
        resumed: false,
        interrupted: false,
        rows: [],
        polling: false,
        pollAgain: false,
        stopped: false,
        ...run,
    };
    runs.set(tracked.id, tracked);
    tracked.timer = setTimeout(() => poll(context, tracked), POLL_MS);
}

/**
 * Sends a `dataform run` command line to the extension's terminal, as `runCommandInTerminal` does, and follows the
 * run's BigQuery jobs: the command is given `--job-prefix`, and the run is put in the history with a row for each
 * job. With the `trackCliRunJobs` setting off, or a CLI that has no `--job-prefix`, the command is sent as it is.
 */
export async function runDataformRunInTerminal(workspaceFolder: string, command: string, selection: CliRunSelection): Promise<void> {
    const context = extensionContext;
    if (!context || !trackingEnabled(workspaceFolder)) {
        runSentUntracked(runCommandInTerminal(command));
        return;
    }
    const cliPath = resolveDataformOptions(workspaceFolder, 'cli').cli?.path ?? 'dataform';
    if (!(await cliPrefixesJobs(cliPath))) {
        hint = `The BigQuery jobs of CLI runs are not listed: the Dataform CLI at ${cliPath} has no --job-prefix option. Update it with \`npm i -g @dataform/cli@latest\`.`;
        showHistory();
        runSentUntracked(runCommandInTerminal(command));
        return;
    }
    hint = undefined;

    const runId = newRunId();
    const flag = jobPrefixFlag(runId);
    const place = cliJobPlace(workspaceFolder);
    const startedAt = Date.now();
    const entry: WorkflowUrlEntry = {
        url: '',
        timestamp: startedAt,
        workspace: '',
        includeDependencies: selection.includeDependencies,
        includeDependents: selection.includeDependents,
        fullRefresh: selection.fullRefresh,
        executionMode: 'cli',
        workflowInvocationId: `cli-${runId}`,
        jobPrefix: jobIdPrefix(flag),
        projectId: place.projectId,
        location: place.location,
        state: 'RUNNING',
        stages: takeRunStages(startedAt),
        invocationStartTime: startedAt,
        includedTags: selection.tags,
        includedTargets: selection.targets,
        includedTargetTypes: selection.targets ? countActionTypes(selection.targets, compiledJson(workspaceFolder)) : undefined,
    };
    if (!place.projectId) {
        entry.jobsNote = "The run's BigQuery jobs are not listed: the project the CLI runs them in is not known.";
    }
    await context.workspaceState.update(HISTORY_KEY, withRunAdded(history(context), entry));
    showHistory();

    const terminal = runCommandInTerminal(withJobPrefix(command, flag));
    if (place.projectId) {
        track(context, { id: entry.workflowInvocationId!, flag, idPrefix: entry.jobPrefix!, projectId: place.projectId, startedAt, stages: entry.stages!, terminal }, workspaceFolder);
    }
}

/** A `dbt build` the extension is about to send to a terminal, or has sent */
export interface DbtRunSent {
    root: string;
    /** The command line, as it is sent */
    command: string;
    terminal: vscode.Terminal;
    selection: CliRunSelection;
    /** Where dbt runs its jobs, as the profile says */
    projectId?: string;
    location?: string;
    /** Epoch ms the run was asked for */
    invokedAt: number;
}

/**
 * Notes where dbt's log ends before a run of the Project at `root` is sent, so that the run's own start can be told
 * from those before it. Undefined with the `trackCliRunJobs` setting off: the run is then not followed.
 */
export function beforeDbtRun(root: string): { logOffset: number } | undefined {
    if (!extensionContext || !trackingEnabled(root)) {
        return undefined;
    }
    return { logOffset: sizeOf(dbtRunFiles(root, process.env, path.resolve).log) ?? 0 };
}

/**
 * Follows the BigQuery jobs of a `dbt build` that was just sent to its terminal, and puts the run in the history
 * with a row for each job. `before` is what `beforeDbtRun` gave before the command was sent.
 */
export async function followDbtRun(run: DbtRunSent, before: { logOffset: number }): Promise<void> {
    const context = extensionContext;
    if (!context) {
        return;
    }
    const startedAt = Date.now();
    const id = `dbt-${newRunId()}`;
    const { root, command, selection } = run;
    const entry: WorkflowUrlEntry = {
        url: '',
        timestamp: startedAt,
        workspace: '',
        includeDependencies: selection.includeDependencies,
        includeDependents: selection.includeDependents,
        fullRefresh: selection.fullRefresh,
        executionMode: 'dbt',
        workflowInvocationId: id,
        dbt: { root, command, logOffset: before.logOffset },
        projectId: run.projectId,
        location: run.location,
        state: 'RUNNING',
        stages: { invokedAt: run.invokedAt, sentAt: startedAt },
        invocationStartTime: startedAt,
        includedTags: selection.tags,
        includedTargets: selection.targets,
    };
    await context.workspaceState.update(HISTORY_KEY, withRunAdded(history(context), entry));
    showHistory();
    track(context, {
        id, projectId: run.projectId, startedAt, stages: entry.stages!, terminal: run.terminal,
        dbt: { root, command, logOffset: before.logOffset, files: dbtRunFiles(root, process.env, path.resolve) },
    });
}

/** Whether the run with this ID in the history is one sent to a terminal, whose jobs are followed here */
export function isFollowedRun(workflowInvocationId: string): boolean {
    return workflowInvocationId.startsWith('cli-') || workflowInvocationId.startsWith('dbt-');
}

/**
 * Cancels the running BigQuery jobs of a CLI run in the history, and those it starts until it ends, once the user
 * has confirmed. Resolves to whether the run is being cancelled.
 */
export async function cancelCliRun(workflowInvocationId: string): Promise<boolean> {
    const run = runs.get(workflowInvocationId);
    if (!extensionContext || !run) {
        vscode.window.showErrorMessage('Unable to cancel the run: its BigQuery jobs are not being followed. Stop it in the terminal with Ctrl+C.');
        return false;
    }
    const running = run.rows.filter(isActiveJob).length;
    const jobsRunning = `${running === 1 ? '1 job is' : `${running} jobs are`} running now.`;
    const confirmed = run.dbt
        ? await vscode.window.showWarningMessage('Stop this dbt run?', { modal: true, detail: `Ctrl+C is sent to dbt in its terminal, and the run's BigQuery jobs are cancelled. ${jobsRunning}` }, 'Stop run')
        : await vscode.window.showWarningMessage(
            `Cancel the BigQuery jobs of this run?`,
            { modal: true, detail: `${jobsRunning} Jobs the run starts later are cancelled too, until it ends.` },
            'Cancel jobs',
        );
    if (!confirmed || run.stopped) {
        return false;
    }
    if (run.dbt && !run.ended && !run.dbt.interruptSent) {
        // dbt stops starting nodes. What it had started is cancelled below, where dbt does not do so itself
        run.dbt.interruptSent = true;
        run.terminal?.sendText('\u0003', false);
    }
    run.cancelling = true;
    void poll(extensionContext, run);
    return true;
}

/** The run whose command line the terminal tells of. A dbt run's has nothing of the extension's in it, so it is the newest run of that command still going */
function runOf(commandLine: string | undefined): TrackedRun | undefined {
    if (!commandLine) {
        return undefined;
    }
    const all = [...runs.values()];
    return all.find((run) => run.flag && commandLine.includes(run.flag))
        ?? all.reverse().find((run) => run.dbt && !run.ended && commandLine.includes(run.dbt.command));
}

/** A CLI run left running when the window was closed is followed again, or ended as its jobs tell */
async function resumeRuns(context: vscode.ExtensionContext) {
    const entries = history(context);
    let changed = false;
    for (const entry of entries) {
        if (!isTerminalRun(entry) || !entry.workflowInvocationId || (entry.state && ENDED_RUN_STATES.has(entry.state)) || runs.has(entry.workflowInvocationId)) {
            continue;
        }
        const stages = entry.stages ?? { invokedAt: entry.timestamp, sentAt: entry.timestamp };
        if (entry.dbt && Date.now() - entry.timestamp <= RESUME_MAX_AGE_MS) {
            const { root, command, logOffset, invocationId } = entry.dbt;
            track(context, {
                id: entry.workflowInvocationId, projectId: entry.projectId, startedAt: entry.timestamp, stages, resumed: true, rows: entry.actions ?? [],
                dbt: { root, command, logOffset, invocationId, files: dbtRunFiles(root, process.env, path.resolve), jobRows: (entry.actions ?? []).filter((row) => row.jobId) },
            });
            continue;
        }
        const flag = entry.jobPrefix?.replace(/^dataform-/, '').replace(/-$/, '');
        if (!flag || !entry.projectId || Date.now() - entry.timestamp > RESUME_MAX_AGE_MS) {
            entry.state = finalRunState(entry.actions ?? [], {});
            entry.interrupted = true;
            changed = true;
            continue;
        }
        track(context, { id: entry.workflowInvocationId, flag, idPrefix: entry.jobPrefix!, projectId: entry.projectId, startedAt: entry.timestamp, stages, resumed: true, rows: entry.actions ?? [] });
    }
    if (changed) {
        await context.workspaceState.update(HISTORY_KEY, entries);
        showHistory();
    }
}

interface ShellExecutionEvent { execution: { commandLine?: { value?: string }; read?: () => AsyncIterable<string> }; exitCode?: number }

export function initCliRunJobs(context: vscode.ExtensionContext) {
    extensionContext = context;
    // Older VS Code has no shell integration API, and some shells none at all: a run's end is then told by its jobs
    const events = vscode.window as unknown as {
        onDidStartTerminalShellExecution?: vscode.Event<ShellExecutionEvent>;
        onDidEndTerminalShellExecution?: vscode.Event<ShellExecutionEvent>;
    };
    if (events.onDidStartTerminalShellExecution && events.onDidEndTerminalShellExecution) {
        context.subscriptions.push(
            events.onDidStartTerminalShellExecution((event) => {
                const run = runOf(event.execution.commandLine?.value);
                if (run) {
                    run.sawStart = true;
                    run.stages.startedAt ??= Date.now();
                    run.stages.silentShell = undefined;
                    if (!run.dbt) {
                        whenCliSaysRunning(event.execution, () => {
                            run.stages.compiledAt ??= Date.now();
                            void poll(context, run);
                        });
                    }
                    void poll(context, run);
                }
            }),
            events.onDidEndTerminalShellExecution((event) => {
                const run = runOf(event.execution.commandLine?.value);
                if (run && !run.ended) {
                    run.ended = { at: Date.now(), exitCode: event.exitCode };
                    void poll(context, run);
                }
            }),
        );
    }
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            for (const run of runs.values()) {
                if (run.terminal === terminal && !run.ended) {
                    // The CLI went with its terminal, and what it had started tells the rest
                    run.sawStart = false;
                    run.interrupted = true;
                    run.sawJobs = true;
                    run.lastActiveAt = Date.now();
                    run.terminal = undefined;
                }
            }
        }),
        { dispose: () => [...runs.values()].forEach(stop) },
    );
    resumeRuns(context).catch((error) => logger.error(`Unable to follow the CLI runs left running: ${error}`));
}
