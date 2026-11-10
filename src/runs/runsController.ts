import * as vscode from 'vscode';
import { cancelCliRun, isFollowedRun } from '../cliRunJobs';
import { cancelWorkflowInvocation } from '../dataformApiUtils';
import { logger } from '../logger';
import { withRunUpserted } from '../shared/cliRunJobs';
import { MAX_POLL_FAILURES, isApiRun, nextPollDelay, polledRuns, runKey } from '../shared/runPolling';
import type { WorkflowUrlEntry } from '../types';
import { refreshWorkflowEntry } from '../workflowJobTelemetry';

/*
 * The run history of the workspace, and what keeps it current: the runs started through the Dataform API and the
 * workflows watched are asked about here, in the extension host, until they end. The Compiled Query panel and the
 * Runs view both show what is here. CLI and dbt runs are followed by their BigQuery jobs, in cliRunJobs.ts; that,
 * and whatever else writes the history, runs `vscode-dataform-tools.refreshWorkflowUrls`, which calls `changed`.
 */

export const HISTORY_KEY = 'dataform_workflow_urls';

/** What a check of a run has read before it is saved: its actions first, then each job's cost as it comes */
export interface RunProgress {
    entry: WorkflowUrlEntry;
    jobsLeft: number;
}

export class RunsController implements vscode.Disposable {
    private readonly changedEmitter = new vscode.EventEmitter<void>();
    /** The history was written */
    readonly onDidChange = this.changedEmitter.event;
    private readonly progressEmitter = new vscode.EventEmitter<void>();
    /** A check read more of a run, which is not saved yet */
    readonly onDidProgress = this.progressEmitter.event;

    private readonly live = new Map<string, RunProgress>();
    private readonly failures = new Map<string, number>();
    /** The runs whose checks failed `MAX_POLL_FAILURES` times in a row, with the last error */
    private readonly gaveUp = new Map<string, string>();
    /** The runs polled at the last look, so a new one is asked about at once */
    private followed = new Set<string>();
    private pollingSince: number | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** Checks run one after the other */
    private queue: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(private readonly context: vscode.ExtensionContext) {}

    history(): WorkflowUrlEntry[] {
        return this.context.workspaceState.get<WorkflowUrlEntry[]>(HISTORY_KEY) || [];
    }

    /** What is being read of each run now, by `runKey` */
    progress(): Record<string, RunProgress> {
        return Object.fromEntries(this.live);
    }

    /** Why each run the checks gave up on is no longer asked about, by `runKey` */
    problems(): Record<string, string> {
        return Object.fromEntries(this.gaveUp);
    }

    async save(history: WorkflowUrlEntry[]): Promise<void> {
        await this.context.workspaceState.update(HISTORY_KEY, history);
        this.changed();
    }

    /** Adds the run, or updates the one with its ID; it is asked about again from scratch */
    async upsert(entry: WorkflowUrlEntry): Promise<void> {
        const key = runKey(entry);
        this.failures.delete(key);
        this.gaveUp.delete(key);
        await this.save(withRunUpserted(this.history(), entry));
    }

    /** Sets fields of the run with that ID, as it is in the history now */
    async update(workflowInvocationId: string, change: Partial<WorkflowUrlEntry>): Promise<void> {
        const history = this.history();
        if (!history.some((entry) => entry.workflowInvocationId === workflowInvocationId)) { return; }
        await this.save(history.map((entry) => entry.workflowInvocationId === workflowInvocationId ? { ...entry, ...change } : entry));
    }

    async clear(): Promise<void> {
        this.live.clear();
        this.failures.clear();
        this.gaveUp.clear();
        await this.save([]);
    }

    /** The history was written: whoever shows it is told, and what has not ended is followed */
    changed(): void {
        if (this.disposed) { return; }
        this.changedEmitter.fire();
        this.schedule();
    }

    /** Asks about every run the Dataform API knows of that has not ended, or whose actions or reasons are missing */
    refreshAll(): Promise<void> {
        return this.check((entry) => isApiRun(entry) && (
            !entry.state || entry.state === 'RUNNING' || entry.state === 'CANCELING'
            || (entry.state === 'FAILED' && !entry.failedActions?.length) || !entry.actionCounts || !entry.actions));
    }

    /** Asks about the one run now, whether or not it has ended */
    refreshRun(key: string): Promise<void> {
        return this.check((entry) => isApiRun(entry) && runKey(entry) === key);
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.changedEmitter.dispose();
        this.progressEmitter.dispose();
    }

    private elapsed(): number {
        return Date.now() - (this.pollingSince ?? Date.now());
    }

    private schedule(): void {
        if (this.disposed) { return; }
        const history = this.history();
        const keys = polledRuns(history, this.elapsed(), this.gaveUp).map(runKey);
        const fresh = keys.some((key) => !this.followed.has(key));
        this.followed = new Set(keys);
        if (keys.length === 0) {
            this.pollingSince = undefined;
            return;
        }
        if (fresh) {
            // A run started, or watched, just now: the timings start again, and it is asked about at once
            this.pollingSince = Date.now();
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.timer) { return; }
        const delay = fresh ? 0 : nextPollDelay(history, this.elapsed(), this.gaveUp);
        if (delay === undefined) { return; }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const due = new Set(polledRuns(this.history(), this.elapsed(), this.gaveUp).map(runKey));
            void this.check((entry) => due.has(runKey(entry)));
        }, delay);
    }

    private check(pick: (entry: WorkflowUrlEntry) => boolean): Promise<void> {
        this.queue = this.queue.then(() => this.checkNow(pick)).catch((error) => logger.error(`Checking the runs failed: ${error}`));
        return this.queue;
    }

    private async checkNow(pick: (entry: WorkflowUrlEntry) => boolean): Promise<void> {
        if (this.disposed) { return; }
        const before = this.history();
        const asked = before.filter(pick);
        if (asked.length === 0) {
            this.schedule();
            return;
        }
        const fresh = new Map<string, WorkflowUrlEntry>();
        await Promise.all(asked.map(async (entry) => {
            const key = runKey(entry);
            try {
                fresh.set(key, await refreshWorkflowEntry(entry, (partial, jobsLeft) => {
                    this.live.set(key, { entry: partial, jobsLeft });
                    this.progressEmitter.fire();
                }));
                this.failures.delete(key);
                this.gaveUp.delete(key);
            } catch (error: any) {
                const failures = (this.failures.get(key) ?? 0) + 1;
                this.failures.set(key, failures);
                logger.error(`Could not check workflow ${key}: ${error?.message}`);
                if (failures >= MAX_POLL_FAILURES) {
                    this.gaveUp.set(key, `Stopped checking it after ${failures} failed checks: ${error?.message ?? error}`);
                }
            } finally {
                this.live.delete(key);
            }
        }));
        if (this.disposed) { return; }

        // Merged into the history as it is now: runs may have been added, cleared or cancelled meanwhile
        const latest = this.history();
        const merged = latest.map((current) => {
            const key = runKey(current);
            const read = fresh.get(key);
            const was = before.find((entry) => runKey(entry) === key);
            // A run whose state changed meanwhile (a cancel, say) keeps what it was changed to
            if (!read || !was || !isApiRun(current) || was.state !== current.state) { return current; }
            // Watching may have been stopped meanwhile
            return { ...read, unwatched: current.unwatched };
        });
        await this.save(merged);
    }
}

let controller: RunsController | undefined;

export function initRunsController(context: vscode.ExtensionContext): RunsController {
    const runs = new RunsController(context);
    controller = runs;
    context.subscriptions.push(runs);
    // A run that went on while the window was closed is asked about once the window has started
    const resume = setTimeout(() => runs.changed(), 5000);
    context.subscriptions.push({ dispose: () => clearTimeout(resume) });
    return runs;
}

/** The workspace's runs. Set as the extension activates, before anything that shows or writes them */
export function runsController(): RunsController {
    if (!controller) {
        throw new Error('The run history is not set up yet');
    }
    return controller;
}

/** Stops a run: a CLI or dbt run by its BigQuery jobs, any other by its Dataform workflow invocation */
export async function cancelRun(context: vscode.ExtensionContext, workflowInvocationId: string): Promise<boolean> {
    return isFollowedRun(workflowInvocationId)
        ? await cancelCliRun(workflowInvocationId)
        : await cancelWorkflowInvocation(context, workflowInvocationId);
}
