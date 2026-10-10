import { runPrepared } from '../runFeedback';
import * as vscode from 'vscode';
import { logger } from '../logger';
import { LastRunRequest, Target } from '../types';
import { getLastRunContext, recordLastRun } from '../lastRun';
import { replayRun } from '../rerunLastExecution';
import { getOrCompileDataformJson } from '../utils/dataformCompiler';
import { createDataformClientForCurrentRepository } from '../utils/remoteCompiler';
import { runIncludedTargets } from '../utils/dataformHelpers';
import { computeRunSet, DeferralEntry, targetId } from './deferRules';
import { findLeftoverProxies, getDeferAvailability, isDeferEnabled, resolveDeferralForActions } from './index';
import { ensureProxyViews, proxyViewsMayExist } from './proxyViews';
import { clearTableExistenceCache, findMissingDevDatasets } from './tableExistence';
import { resolveDataformOptions } from '../project/dataformOptions';

/*
 * Defer to prod for runs. Dataform executes its own compiled SQL, so before a deferred run the extension
 * creates a Proxy View at each upstream Dev Target that is not built, reading the Prod Target. Every run
 * path calls `beginRun` just before it dispatches.
 */

const API_RUNNER_APPROVED_KEY = "defer_to_prod_api_runner_approved";
const RUN_WITH_DEPENDENCIES = "Run with dependencies";
const RUN_ANYWAY = "Run anyway";
const BUILD_CHANGED_FIRST = "Build changed upstream first";

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

/** Target ids added to a run's selection, set while a run with its changed upstream actions dispatches */
let extraRunTargets: string[] | undefined;

/** Repeats the run with its dependencies, so the upstream actions it would have read from prod are built in dev */
async function runWithDependencies(request: RunRequest, deferToProd: boolean) {
    const context = getLastRunContext();
    if (!context) {
        return;
    }
    await withDeferOverride(deferToProd, () => replayRun(context, request.workspaceFolder, { ...request, includeDependencies: true, timestamp: Date.now() }));
}

/**
 * Runs some upstream actions and the run's own actions as one run. Dataform orders it by dependency, so the
 * added actions are built in dev before the actions that read them. Only those are added, unlike a run with
 * dependencies, which builds everything upstream.
 */
async function runWithUpstreamActions(request: RunRequest, upstream: DeferralEntry[], runSet: { target: Target }[]) {
    const context = getLastRunContext();
    if (!context) {
        return;
    }
    const targets = new Map<string, Target>();
    [...upstream.map((entry) => entry.dev), ...runSet.map((action) => action.target)].forEach((target) => targets.set(targetId(target), target));
    const previous = extraRunTargets;
    extraRunTargets = [...(previous ?? []), ...upstream.map((entry) => targetId(entry.dev))];
    try {
        // The run set already includes any dependencies or dependents, so they are not added again
        await withDeferOverride(true, () => runIncludedTargets(context, request.workspaceFolder, [...targets.values()], false, false, request.fullRefresh, request.executionMode, request));
    } finally {
        extraRunTargets = previous;
    }
}

/**
 * With defer to prod off, a Proxy View left by an earlier deferred run still makes the run read prod. Returns
 * false when the user cancels or starts a run with dependencies instead.
 */
async function confirmLeftoverProxies(request: RunRequest): Promise<boolean> {
    if (!proxyViewsMayExist()) {
        return true;
    }
    const graph = await getOrCompileDataformJson(request.workspaceFolder, resolveDataformOptions(request.workspaceFolder));
    if (!graph) {
        return true;
    }
    clearTableExistenceCache({ includeUnreadable: false });
    const leftovers = await findLeftoverProxies(computeRunSet(graph, request));
    if (leftovers.length === 0) {
        return true;
    }
    const actions = request.includeDependencies ? [RUN_ANYWAY] : [RUN_WITH_DEPENDENCIES, RUN_ANYWAY];
    const choice = await vscode.window.showWarningMessage(
        `Defer to prod is off, but ${leftovers.length} upstream table${leftovers.length === 1 ? " is a proxy view" : "s are proxy views"} from an earlier deferred run, so this run would read prod for ${leftovers.length === 1 ? "it" : "them"}.`,
        { modal: true, detail: `${leftovers.map(targetId).join("\n")}\n\nRun with dependencies builds them in dev, replacing the proxy views. "Dataform: Remove defer to prod proxy views" deletes them.` },
        ...actions,
    );
    if (choice === RUN_WITH_DEPENDENCIES) {
        await runWithDependencies(request, false);
        return false;
    }
    return choice === RUN_ANYWAY;
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
    const record = (deferToProd: boolean) => recordLastRun({ ...request, deferToProd }).then(() => { runPrepared(); return true; });
    const workspaceFolder = request.workspaceFolder;
    if (!(deferOverride ?? isDeferEnabled(workspaceFolder))) {
        return (await confirmLeftoverProxies(request)) ? record(false) : false;
    }
    const availability = getDeferAvailability(workspaceFolder);
    if (!availability.available) {
        vscode.window.showWarningMessage(`Defer to prod is not applied to this run. ${availability.reason}`);
        return record(false);
    }

    const graph = await getOrCompileDataformJson(workspaceFolder, resolveDataformOptions(workspaceFolder));
    if (!graph) {
        return record(false);
    }
    const runSet = computeRunSet(graph, request);
    if (extraRunTargets) {
        runSet.push(...computeRunSet(graph, { kind: "changed", items: extraRunTargets, includeDependencies: false, includeDependents: false }));
    }
    // A run acts on what exists now, e.g. a table the previous run just built, so skip the cached listings
    clearTableExistenceCache({ includeUnreadable: false });
    const deferral = await resolveDeferralForActions(runSet, graph, workspaceFolder, { enabled: true, awaitStale: true });
    if (!deferral) {
        return record(false); // Why was already reported
    }

    // A proxy view cannot stand in for a function or procedure, and building one is cheap, so a run builds
    // the missing ones in dev as part of the run
    const routines = deferral.entries.filter((entry) => entry.routine);
    if (routines.length > 0) {
        vscode.window.showInformationMessage(`Defer to prod: also building ${routines.length} function${routines.length === 1 ? "" : "s"} not built in dev: ${routines.map((entry) => entry.dev.name).join(", ")}`);
        await runWithUpstreamActions(request, routines, runSet);
        return false;
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
            await runWithDependencies(request, true);
        }
        return false;
    }

    const stale = deferred.filter((entry) => entry.stale);
    if (stale.length > 0) {
        const actions = request.includeDependencies ? [RUN_ANYWAY] : [BUILD_CHANGED_FIRST, RUN_WITH_DEPENDENCIES, RUN_ANYWAY];
        const choice = await vscode.window.showWarningMessage(
            `${stale.length} upstream table${stale.length === 1 ? "" : "s"} read from prod changed on this branch, so the run would use the prod version.`,
            { modal: true, detail: `${describe(stale, (entry) => `reads ${targetId(entry.prod!)}`)}\n\n${BUILD_CHANGED_FIRST} adds only these to the run, built in dev before the actions that read them.` },
            ...actions,
        );
        if (choice === BUILD_CHANGED_FIRST) {
            await runWithUpstreamActions(request, stale, runSet);
            return false;
        }
        if (choice === RUN_WITH_DEPENDENCIES) {
            await runWithDependencies(request, true);
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
            // Usually the views exist from an earlier run, so check quietly and only speak up when something changed
            const { created, updated } = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: "Defer to prod: checking proxy views" },
                () => ensureProxyViews(deferred),
            );
            if (created + updated > 0) {
                const parts = [created > 0 ? `created ${created}` : "", updated > 0 ? `repointed ${updated}` : ""].filter(Boolean).join(", ");
                vscode.window.showInformationMessage(`Defer to prod: ${parts} proxy view${created + updated === 1 ? "" : "s"}, so ${deferred.length} upstream table${deferred.length === 1 ? " is" : "s are"} read from prod.`);
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Defer to prod: could not create proxy views, so the run was not started. ${error?.message ?? error}`);
            return false;
        }
    }
    return record(true);
}
