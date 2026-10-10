import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { quotedCli } from './backend/dataform/run';
import { checkAuthentication, getBigQueryClientFor } from './bigqueryClient';
import { logger } from './logger';
import { compiledJson } from './project';
import { resolveDataformOptions } from './project/dataformOptions';
import { extensionConfiguration } from './project/settings';
import { countActionTypes } from './shared/actionTypes';
import {
    BigQueryJobMetadata, CLOCK_SKEW_MS, DRAIN_MS, ENDED_RUN_STATES, MatchedAction, POLL_MS, QUIET_MS, RESUME_MAX_AGE_MS,
    cliJobProject, countJobRows, failedJobRows, finalRunState, helpListsJobPrefix, isActiveJob, jobIdPrefix, jobPrefixFlag,
    jobTargetMatcher, newRunId, quietVerdict, runJobRows, withJobPrefix, withRunAdded,
} from './shared/cliRunJobs';
import { RunStages, SILENT_SHELL_MS } from './shared/runStages';
import { runSentUntracked, takeRunStages, whenCliSaysRunning } from './runFeedback';
import { SupportedCurrency, Target, WorkflowAction, WorkflowUrlEntry } from './types';
import { defaultCredentialFile } from './utils/googleAccounts';
import { runCommandInTerminal } from './utils/vscodeUi';
import { parseBigQueryJobId, summariseJobStats, toJobStats } from './workflowJobTelemetry';

/*
 * Follows the BigQuery jobs of the `dataform run` commands the extension sends to the terminal, and keeps each run in
 * the history the API runs are in. See src/shared/cliRunJobs.ts for how a run's jobs are found.
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

interface TrackedRun {
    /** The run's `workflowInvocationId` in the history */
    id: string;
    /** What `--job-prefix` was given, which the run's command line in the terminal has */
    flag: string;
    idPrefix: string;
    projectId: string;
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
    const client = await jobsClient(run.projectId);
    const [jobs] = await withTimeout(client.getJobs({
        projection: 'full',
        allUsers: false,
        minCreationTime: String(run.startedAt - CLOCK_SKEW_MS),
        maxResults: 500,
    }), 'listing the BigQuery jobs');
    const unit = currency();
    return runJobRows(jobs.map((job) => job.metadata as BigQueryJobMetadata), run.idPrefix, run.nameOf, (statistics, location) => toJobStats(statistics, location, unit));
}

async function cancelJobs(run: TrackedRun, rows: WorkflowAction[]) {
    const client = await jobsClient(run.projectId);
    await Promise.all(rows.filter((row) => row.jobId && !run.cancelled.has(row.jobId)).map(async (row) => {
        run.cancelled.add(row.jobId!);
        const ref = parseBigQueryJobId(row.jobId!, run.projectId);
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
    entry.jobsNote = run.listError ? `The run's BigQuery jobs can't be listed in ${run.projectId}: ${run.listError}` : undefined;
    if (run.ended) {
        const toldHow = run.ended.exitCode !== undefined;
        entry.state = !toldHow && (run.listError || run.ended.noJobs) ? 'UNKNOWN' : finalRunState(run.rows, { exitCode: run.ended.exitCode, cancelling: run.cancelling });
        entry.invocationEndTime = run.ended.at;
        entry.interrupted = run.interrupted || undefined;
        if (run.ended.noJobs) {
            entry.jobsNote = `No BigQuery job of this run was found in ${run.projectId}. Its jobs are looked for among those of the account the extension signs in with.`;
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
        if (!run.listError) {
            try {
                run.rows = await listRows(run);
            } catch (error: any) {
                run.listError = error?.message ?? String(error);
                logger.error(`Unable to list the BigQuery jobs of the CLI run ${run.id}: ${run.listError}`);
            }
        }
        const now = Date.now();
        const active = run.rows.filter(isActiveJob);
        if (!run.listError) {
            if (run.rows.length > 0 && !run.sawJobs) {
                run.sawJobs = true;
                run.lastActiveAt = now;
            }
            if (run.rows.length > 0 && !run.stages.firstJobAt) {
                // The job was started before it was listed, and after the stage the run was last known to be in
                const { compiledAt, startedAt, sentAt, invokedAt } = run.stages;
                run.stages.firstJobAt = Math.min(now, Math.max(compiledAt ?? startedAt ?? sentAt ?? invokedAt, run.rows[0].startTime ?? now));
            }
            if (active.length > 0) {
                run.lastActiveAt = now;
            }
            if (run.resumed) {
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
            if (run.listError) {
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

function track(context: vscode.ExtensionContext, run: Pick<TrackedRun, 'id' | 'flag' | 'idPrefix' | 'projectId' | 'startedAt' | 'stages'> & Partial<TrackedRun>, root?: string) {
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
    const confirmed = await vscode.window.showWarningMessage(
        `Cancel the BigQuery jobs of this run?`,
        { modal: true, detail: `${running === 1 ? '1 job is' : `${running} jobs are`} running now. Jobs the run starts later are cancelled too, until it ends.` },
        'Cancel jobs',
    );
    if (confirmed !== 'Cancel jobs' || run.stopped) {
        return false;
    }
    run.cancelling = true;
    void poll(extensionContext, run);
    return true;
}

/** The run whose command line the terminal tells of */
function runOf(commandLine: string | undefined): TrackedRun | undefined {
    return commandLine ? [...runs.values()].find((run) => commandLine.includes(run.flag)) : undefined;
}

/** A CLI run left running when the window was closed is followed again, or ended as its jobs tell */
async function resumeRuns(context: vscode.ExtensionContext) {
    const entries = history(context);
    let changed = false;
    for (const entry of entries) {
        if (entry.executionMode !== 'cli' || !entry.workflowInvocationId || (entry.state && ENDED_RUN_STATES.has(entry.state)) || runs.has(entry.workflowInvocationId)) {
            continue;
        }
        const flag = entry.jobPrefix?.replace(/^dataform-/, '').replace(/-$/, '');
        if (!flag || !entry.projectId || Date.now() - entry.timestamp > RESUME_MAX_AGE_MS) {
            entry.state = finalRunState(entry.actions ?? [], {});
            entry.interrupted = true;
            changed = true;
            continue;
        }
        track(context, { id: entry.workflowInvocationId, flag, idPrefix: entry.jobPrefix!, projectId: entry.projectId, startedAt: entry.timestamp, stages: entry.stages ?? { invokedAt: entry.timestamp, sentAt: entry.timestamp }, resumed: true, rows: entry.actions ?? [] });
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
                    whenCliSaysRunning(event.execution, () => {
                        run.stages.compiledAt ??= Date.now();
                        void poll(context, run);
                    });
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
                }
            }
        }),
        { dispose: () => [...runs.values()].forEach(stop) },
    );
    resumeRuns(context).catch((error) => logger.error(`Unable to follow the CLI runs left running: ${error}`));
}
