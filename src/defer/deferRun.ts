import * as vscode from 'vscode';
import { logger } from '../logger';
import { LastRunRequest } from '../types';
import { getLastRunContext, recordLastRun } from '../lastRun';
import { replayRun } from '../rerunLastExecution';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';
import { createDataformClientForCurrentRepository } from '../utils/remoteCompiler';
import { computeRunSet, DeferralEntry, targetId } from './deferRules';
import { getDeferAvailability, isDeferEnabled, resolveDeferralForActions } from './index';
import { ensureProxyViews } from './proxyViews';
import { clearTableExistenceCache, findMissingDevDatasets } from './tableExistence';

/*
 * Defer to prod for runs. Dataform executes its own compiled SQL, so before a deferred run the extension
 * creates a Proxy View at each upstream Dev Target that is not built, reading the Prod Target. Every run
 * path calls `beginRun` just before it dispatches.
 */

const API_RUNNER_APPROVED_KEY = "defer_to_prod_api_runner_approved";
const RUN_WITH_DEPENDENCIES = "Run with dependencies";
const RUN_ANYWAY = "Run anyway";

type RunRequest = Omit<LastRunRequest, 'timestamp'>;

/** Set while a rerun replays, so it follows the recorded defer state rather than the current setting */
let deferOverride: boolean | undefined;

export async function withDeferOverride<T>(deferToProd: boolean, run: () => Promise<T>): Promise<T> {
    const previous = deferOverride;
    deferOverride = deferToProd;
    try {
        return await run();
    } finally {
        deferOverride = previous;
    }
}

/** Repeats the run with its dependencies, so the upstream actions it would have read from prod are built in dev */
async function runWithDependencies(request: RunRequest) {
    const context = getLastRunContext();
    if (!context) {
        return;
    }
    await withDeferOverride(true, () => replayRun(context, request.workspaceFolder, { ...request, includeDependencies: true, timestamp: Date.now() }));
}

function describe(entries: DeferralEntry[], note: (entry: DeferralEntry) => string): string {
    return entries.map((entry) => `${targetId(entry.dev)}: ${note(entry)}`).join("\n");
}

/** Deferred API runs read prod as the repository's service account, which the extension cannot check, so name it once per repository. */
async function confirmApiRunner(deferred: DeferralEntry[]): Promise<boolean> {
    const context = getLastRunContext();
    let repositoryName = "this repository";
    let runner = "the Dataform default service agent (service-<project number>@gcp-sa-dataform.iam.gserviceaccount.com)";
    try {
        const { dataformClient, repositoryName: name } = await createDataformClientForCurrentRepository();
        repositoryName = name;
        const [repository] = await dataformClient.client.getRepository({
            name: `projects/${dataformClient.gcpProjectId}/locations/${dataformClient.gcpLocation}/repositories/${name}`,
        });
        if (repository.serviceAccount) {
            runner = repository.serviceAccount;
        }
    } catch (error: any) {
        logger.error(`Defer to prod: could not read the repository's service account: ${error?.message}`);
    }

    const approved = context?.workspaceState.get<string[]>(API_RUNNER_APPROVED_KEY) ?? [];
    if (approved.includes(repositoryName)) {
        return true;
    }
    const prodDatasets = [...new Set(deferred.map((entry) => `${entry.prod!.database}.${entry.prod!.schema}`))].sort();
    const dontAskAgain = "Run and don't ask again";
    const choice = await vscode.window.showWarningMessage(
        `This run reads ${deferred.length} upstream table${deferred.length === 1 ? "" : "s"} from prod through proxy views. The run executes as ${runner}, which needs BigQuery Data Viewer on:`,
        { modal: true, detail: prodDatasets.join("\n") },
        "Run",
        dontAskAgain,
    );
    if (choice === dontAskAgain) {
        await context?.workspaceState.update(API_RUNNER_APPROVED_KEY, [...approved, repositoryName]);
    }
    return choice === "Run" || choice === dontAskAgain;
}

/**
 * Prepares defer to prod for a run and records it as the last run. Returns false when the run should not be
 * dispatched: the user cancelled, a run with dependencies was started instead, or the proxy views failed.
 */
export async function beginRun(request: RunRequest): Promise<boolean> {
    const record = (deferToProd: boolean) => recordLastRun({ ...request, deferToProd }).then(() => true);
    const workspaceFolder = request.workspaceFolder;
    if (!(deferOverride ?? isDeferEnabled(workspaceFolder))) {
        return record(false);
    }
    const availability = getDeferAvailability(workspaceFolder);
    if (!availability.available) {
        vscode.window.showWarningMessage(`Defer to prod is not applied to this run. ${availability.reason}`);
        return record(false);
    }

    const graph = await getOrCompileDataformJson(workspaceFolder);
    if (!graph) {
        return record(false);
    }
    const runSet = computeRunSet(graph, request);
    // A run acts on what exists now, e.g. a table the previous run just built, so skip the cached listings
    clearTableExistenceCache({ includeUnreadable: false });
    const deferral = await resolveDeferralForActions(runSet, graph, workspaceFolder, { enabled: true, awaitStale: true });
    if (!deferral) {
        return record(false); // Why was already reported
    }

    const deferred = deferral.entries.filter((entry) => entry.status === "deferred");
    const missingDatasets = await findMissingDevDatasets(deferred.map((entry) => entry.dev));
    const blocked = [
        ...deferral.entries.filter((entry) => entry.status !== "deferred"),
        ...deferred.filter((entry) => missingDatasets.has(`${entry.dev.database}.${entry.dev.schema}`)),
    ];
    if (blocked.length > 0) {
        const detail = describe(blocked, (entry) => entry.status === "missingEverywhere"
            ? "not built in dev or prod"
            : entry.status === "unreadable"
                ? "not built in dev, and no read access to prod"
                : `dev dataset ${entry.dev.database}.${entry.dev.schema} does not exist`);
        const actions = request.includeDependencies ? [] : [RUN_WITH_DEPENDENCIES];
        const choice = await vscode.window.showErrorMessage(
            `Cannot defer ${blocked.length} upstream table${blocked.length === 1 ? "" : "s"} to prod, so this run would fail.`,
            { modal: true, detail },
            ...actions,
        );
        if (choice === RUN_WITH_DEPENDENCIES) {
            await runWithDependencies(request);
        }
        return false;
    }

    const stale = deferred.filter((entry) => entry.stale);
    if (stale.length > 0) {
        const actions = request.includeDependencies ? [RUN_ANYWAY] : [RUN_WITH_DEPENDENCIES, RUN_ANYWAY];
        const choice = await vscode.window.showWarningMessage(
            `${stale.length} upstream table${stale.length === 1 ? "" : "s"} read from prod changed on this branch, so the run would use the prod version.`,
            { modal: true, detail: describe(stale, (entry) => `reads ${targetId(entry.prod!)}`) },
            ...actions,
        );
        if (choice === RUN_WITH_DEPENDENCIES) {
            await runWithDependencies(request);
            return false;
        }
        if (choice !== RUN_ANYWAY) {
            return false;
        }
    }

    if (deferred.length > 0) {
        if ((request.executionMode === "api" || request.executionMode === "api_workspace") && !(await confirmApiRunner(deferred))) {
            return false;
        }
        try {
            const written = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: "Defer to prod: creating proxy views" },
                () => ensureProxyViews(deferred),
            );
            if (written > 0) {
                vscode.window.showInformationMessage(`Defer to prod: ${written} upstream table${written === 1 ? "" : "s"} read from prod through proxy views.`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Defer to prod: could not create proxy views, so the run was not started. ${error?.message ?? error}`);
            return false;
        }
    }
    return record(true);
}
