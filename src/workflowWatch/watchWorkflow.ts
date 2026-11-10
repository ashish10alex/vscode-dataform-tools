import * as vscode from 'vscode';
import { compiledJson } from '../project';
import { GitService } from '../gitClient';
import { loadDataformTools } from '../lazySdk';
import { runsController } from '../runs/runsController';
import { timestampToMs } from '../shared/jobTiming';
import type { WatchView } from '../shared/panelContract';
import { needsPolling, runKey } from '../shared/runPolling';
import type { WorkflowUrlEntry } from '../types';
import { getCachedDataformRepositoryLocation } from '../utils/gcpUtils';
import { parseInvocation } from './parseInvocation';

/*
 * Watching a workflow invocation the extension did not start (a scheduled one, a colleague's, one started from the
 * console): it is looked up, then kept in the run history as `external`, where the history's poller follows it until
 * it ends, with what each action's BigQuery job cost. Watching only reads: nothing here runs, changes or cancels
 * anything in GCP.
 */

export class WorkflowWatcher implements vscode.Disposable {
    private view: WatchView = { looking: false };
    /** Bumped by each watch, so a look-up that ends after a newer one does nothing */
    private generation = 0;
    private readonly changed = new vscode.EventEmitter<WatchView>();
    readonly onDidChange = this.changed.event;

    constructor(private readonly context: vscode.ExtensionContext) {}

    get state(): WatchView {
        return this.view;
    }

    /** Looks up what was pasted and adds it to the history, followed. Gives the run, or undefined when it can't */
    async watch(input: string): Promise<WorkflowUrlEntry | undefined> {
        const generation = ++this.generation;
        this.set({ looking: true, lookingFor: input.trim(), error: undefined, note: undefined });
        try {
            const entry: WorkflowUrlEntry = { ...await this.lookUp(input), unwatched: false };
            if (generation !== this.generation) { return undefined; }
            const runs = runsController();
            await runs.upsert(entry);
            this.set({ looking: false, lookingFor: undefined });
            // One that has not ended is asked about at once by the poller; one that has, once here, for its actions
            if (!needsPolling(entry)) {
                void runs.refreshRun(runKey(entry));
            }
            return entry;
        } catch (error: any) {
            if (generation !== this.generation) { return undefined; }
            this.set({ looking: false, lookingFor: undefined, error: error?.message ?? String(error) });
            return undefined;
        }
    }

    /** Stops following the workflow. It is never cancelled: it carries on in GCP */
    async stop(workflowInvocationId: string): Promise<void> {
        await runsController().update(workflowInvocationId, { unwatched: true });
        this.set({ note: 'Stopped watching: the workflow carries on in GCP' });
    }

    dispose(): void {
        this.changed.dispose();
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

        const history = runsController().history();
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
}
