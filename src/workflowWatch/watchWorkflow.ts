import * as vscode from 'vscode';
import { compiledJson } from '../project';
import { GitService } from '../gitClient';
import { loadDataformTools } from '../lazySdk';
import { logger } from '../logger';
import { ENDED_RUN_STATES, withRunUpserted } from '../shared/cliRunJobs';
import { timestampToMs } from '../shared/jobTiming';
import type { WatchView } from '../shared/panelContract';
import type { WorkflowUrlEntry } from '../types';
import { getCachedDataformRepositoryLocation } from '../utils/gcpUtils';
import { refreshWorkflowEntry } from '../workflowJobTelemetry';
import { parseInvocation } from './parseInvocation';

/*
 * Following a workflow invocation the extension did not start (a scheduled one, a colleague's, one started from the
 * console) until it ends, with what each action's BigQuery job cost. It is kept in the run history as `external`.
 * Watching only reads: nothing here runs, changes or cancels anything in GCP.
 */

/** How often the invocation is asked about */
export const WATCH_POLL_MS = 5000;
/** How many checks in a row may fail before watching stops */
const MAX_POLL_FAILURES = 5;
const HISTORY_KEY = 'dataform_workflow_urls';

/** The invocation being followed, so the compiled query panel does not ask about it too */
let followed: string | undefined;
export function isWatchedInvocation(workflowInvocationId: string | undefined): boolean {
    return !!workflowInvocationId && workflowInvocationId === followed;
}

export class WorkflowWatcher implements vscode.Disposable {
    private view: WatchView = { watching: false, looking: false };
    private timer: NodeJS.Timeout | undefined;
    /** Bumped by each watch and stop, so a check that ends after either does nothing */
    private generation = 0;
    private failures = 0;
    private readonly changed = new vscode.EventEmitter<WatchView>();
    readonly onDidChange = this.changed.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    get state(): WatchView {
        return this.view;
    }

    /** Looks up what was pasted and follows it, in place of whatever was being watched */
    async watch(input: string): Promise<void> {
        const generation = this.halt();
        this.set({ watching: false, looking: true, lookingFor: input.trim(), readingActions: false, jobsLeft: 0, error: undefined, note: undefined });
        try {
            const entry = await this.lookUp(input);
            if (generation !== this.generation) { return; }
            await this.save(entry);
            this.set({ entry, looking: false, lookingFor: undefined, watching: !ENDED_RUN_STATES.has(entry.state ?? ''), readingActions: !entry.actions });
            await this.check(generation);
        } catch (error: any) {
            if (generation !== this.generation) { return; }
            this.set({ looking: false, lookingFor: undefined, readingActions: false, error: error?.message ?? String(error) });
        }
    }

    /** Stops following the workflow. It is never cancelled: it carries on in GCP */
    stop(): void {
        const wasWatching = this.view.watching;
        this.halt();
        this.set({ watching: false, looking: false, lookingFor: undefined, readingActions: false, jobsLeft: 0, note: wasWatching ? 'Stopped watching: the workflow carries on in GCP' : this.view.note });
    }

    dispose(): void {
        this.halt();
        this.changed.dispose();
    }

    private halt(): number {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.failures = 0;
        followed = undefined;
        return ++this.generation;
    }

    private set(change: Partial<WatchView>): void {
        this.view = { ...this.view, ...change };
        this.changed.fire(this.view);
    }

    /** The paste's invocation as an entry of the history, after one look at it that must succeed */
    private async lookUp(input: string): Promise<WorkflowUrlEntry> {
        const ref = parseInvocation(input);
        const projectId = ref.projectId ?? compiledJson()?.projectConfig?.defaultDatabase;
        if (!projectId) {
            throw new Error('No GCP project: paste the URL of the workflow\'s page in the Cloud console, or open a Dataform project with defaultProject set');
        }
        let repositoryName = ref.repositoryName;
        if (!repositoryName) {
            repositoryName = (await new GitService().getGitBranchAndRepoName())?.gitRepoName;
            if (!repositoryName) {
                throw new Error('No Dataform repository: paste the URL of the workflow\'s page in the Cloud console, or set gitRepoName in the settings');
            }
        }
        const location = ref.location ?? await getCachedDataformRepositoryLocation(this.context, repositoryName);
        if (!location) {
            throw new Error('No location for the Dataform repository: paste the URL of the workflow\'s page in the Cloud console');
        }

        const dataformClient = new (await loadDataformTools())(projectId, location);
        let invocation;
        try {
            invocation = await dataformClient.getWorkflowInvocation(repositoryName, ref.workflowInvocationId);
        } catch (error: any) {
            throw new Error(`Could not read workflow ${ref.workflowInvocationId} in ${repositoryName} (${projectId}, ${location}): ${error?.message ?? error}`);
        }
        // Dataform answers with the invocation's own name; it must be the one asked for (the project part may be
        // spelled as its number)
        const tail = `/locations/${location}/repositories/${repositoryName}/workflowInvocations/${ref.workflowInvocationId}`;
        if (!invocation?.name?.endsWith(tail)) {
            throw new Error(`Dataform answered with "${invocation?.name}", not the workflow asked for`);
        }

        const history = this.context.workspaceState.get<WorkflowUrlEntry[]>(HISTORY_KEY) || [];
        const known = history.find((item) => item.workflowInvocationId === ref.workflowInvocationId);
        return {
            ...known,
            url: dataformClient.getWorkflowInvocationUrl(repositoryName, ref.workflowInvocationId),
            timestamp: known?.timestamp ?? timestampToMs(invocation.invocationTiming?.startTime) ?? Date.now(),
            workspace: repositoryName,
            includeDependencies: known?.includeDependencies ?? false,
            includeDependents: known?.includeDependents ?? false,
            fullRefresh: known?.fullRefresh ?? false,
            // A run this extension started stays its own when it is watched here
            executionMode: known?.executionMode ?? 'external',
            workflowInvocationId: ref.workflowInvocationId,
            projectId,
            location,
            repositoryName,
            state: typeof invocation.state === 'string' ? invocation.state : known?.state,
        };
    }

    /** Asks about the invocation, saves what it says and, until it ends, asks again later */
    private async check(generation: number): Promise<void> {
        const current = this.view.entry;
        if (!current || generation !== this.generation) { return; }
        followed = current.workflowInvocationId;
        let entry: WorkflowUrlEntry;
        try {
            // The actions are shown as soon as they are read, and each job's cost as it comes
            entry = await refreshWorkflowEntry(current, (partial, jobsLeft) => {
                if (generation === this.generation) {
                    this.set({ entry: partial, readingActions: false, jobsLeft });
                }
            });
        } catch (error: any) {
            if (generation !== this.generation) { return; }
            this.failures++;
            logger.error(`Could not check workflow ${current.workflowInvocationId}: ${error?.message}`);
            if (this.failures >= MAX_POLL_FAILURES) {
                this.halt();
                this.set({ watching: false, readingActions: false, jobsLeft: 0, error: `Stopped watching after ${this.failures} failed checks: ${error?.message}` });
                return;
            }
            this.set({ watching: true, error: `Could not check the workflow: ${error?.message}` });
            this.timer = setTimeout(() => void this.check(generation), WATCH_POLL_MS);
            return;
        }
        if (generation !== this.generation) { return; }
        this.failures = 0;
        await this.save(entry);
        const ended = ENDED_RUN_STATES.has(entry.state ?? '');
        if (ended) {
            followed = undefined;
        } else {
            this.timer = setTimeout(() => void this.check(generation), WATCH_POLL_MS);
        }
        this.set({ entry, watching: !ended, readingActions: false, jobsLeft: 0, error: undefined });
    }

    private async save(entry: WorkflowUrlEntry): Promise<void> {
        const history = this.context.workspaceState.get<WorkflowUrlEntry[]>(HISTORY_KEY) || [];
        await this.context.workspaceState.update(HISTORY_KEY, withRunUpserted(history, entry));
        vscode.commands.executeCommand('vscode-dataform-tools.refreshWorkflowUrls').then(undefined, () => undefined);
    }
}
