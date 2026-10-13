import * as vscode from 'vscode';
import { logger } from '../logger';
import { DataformCompiledJson, DeferToProdState, DeferralView, TablesWtFullQuery, Target } from '../types';
import { computeChangedActions, isGitRepo } from '../changedActions';
import { applyDeferral, BuiltInDevEntry, collectCandidates, decideDeferral, DeferralEntry, findAccessDeniedTargets, indexGraphActions, prodKey, prodMatchesDev, targetId } from './deferRules';
import { findExistingDevTargets, findProxyViews, getDevLastModified, getProdStatuses, getTableExistenceGeneration, markProdUnreadable } from './tableExistence';
import { proxyViewsMayExist } from './proxyViews';
import { getProdCompilerOptions, getProdTargets, prefetchProdTargets } from './prodTargets';
import { extensionConfiguration } from '../project/settings';

export interface Deferral {
    entries: DeferralEntry[];
    /** Upstream actions left on their Dev Target because they are built in dev */
    builtInDev?: BuiltInDevEntry[];
}

const deferralUpdated = new vscode.EventEmitter<void>();
/** Fires when Stale Deferral flags arrive after the deferral was first shown */
export const onDeferralUpdated = deferralUpdated.event;

const deferralResolved = new vscode.EventEmitter<void>();
/** Fires after the current file's deferral was worked out for a compile, dry run or preview */
export const onDeferralResolved = deferralResolved.event;

let lastReportedError: string | undefined;

function settings(workspaceFolder?: string) {
    return extensionConfiguration(workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
}

export function isDeferEnabled(workspaceFolder?: string): boolean {
    return settings(workspaceFolder).get<boolean>('deferToProd') === true;
}

export type DeferAvailability = { available: true, prodOptions: string } | { available: false, reason: string };

export function getDeferAvailability(workspaceFolder: string): DeferAvailability {
    const prodOptions = getProdCompilerOptions(workspaceFolder);
    if (prodOptions === undefined) {
        return { available: false, reason: "Dev and prod resolve to the same tables. Set the prod compiler options, e.g. --default-database=my-prod-project." };
    }
    return { available: true, prodOptions };
}

export function getDeferToProdState(workspaceFolder: string | undefined): DeferToProdState {
    if (!workspaceFolder) {
        return { enabled: false, available: false };
    }
    const availability = getDeferAvailability(workspaceFolder);
    return {
        enabled: isDeferEnabled(workspaceFolder),
        available: availability.available,
        reason: availability.available ? undefined : availability.reason,
    };
}

/** Called before a fresh dev compile so the prod compile runs alongside it */
export function prepareDeferral(workspaceFolder: string) {
    if (!isDeferEnabled(workspaceFolder)) {
        return;
    }
    const availability = getDeferAvailability(workspaceFolder);
    if (availability.available) {
        prefetchProdTargets(workspaceFolder, availability.prodOptions);
    }
}

function reportError(message: string) {
    logger.error(`Defer to prod: ${message}`);
    if (message !== lastReportedError) {
        lastReportedError = message;
        vscode.window.showWarningMessage(`Defer to prod is not applied: ${message}`);
    }
}

type SelectedActions = { target?: Target, dependencyTargets?: Target[], type?: string }[];

type ResolveOptions = { enabled?: boolean, awaitStale?: boolean };

/**
 * Which upstream actions of the Selected Actions to read from prod. Undefined when defer to prod is off or
 * unavailable, in which case everything runs as compiled. `enabled` overrides the setting, e.g. for a rerun
 * of a run recorded with defer on. With `awaitStale`, Stale Deferral flags are set before returning, as a
 * run has to ask about them first; otherwise they may arrive later through `onDeferralUpdated`.
 */
export async function resolveDeferralForActions(
    selected: SelectedActions,
    devGraph: DataformCompiledJson,
    workspaceFolder: string,
    options: ResolveOptions = {},
): Promise<Deferral | undefined> {
    return (await tryResolveDeferral(selected, devGraph, workspaceFolder, options)).deferral;
}

/**
 * Like {@link resolveDeferralForActions}, but returns without waiting for the Stale Deferral flags. `staleFlags`
 * resolves once they are set on the entries, to true when any entry was flagged.
 */
export async function resolveDeferralWithStaleFlags(
    selected: SelectedActions,
    devGraph: DataformCompiledJson,
    workspaceFolder: string,
): Promise<{ deferral?: Deferral, staleFlags?: Promise<boolean> }> {
    const { deferral, staleFlags } = await tryResolveDeferral(selected, devGraph, workspaceFolder);
    return { deferral, staleFlags };
}

type DeferralResolution = { deferral?: Deferral, error?: string, staleFlags?: Promise<boolean> };

/**
 * One save resolves the current file's deferral for the compiled query panel and again for the editor hints.
 * The second reuses the first while the compiled graph, the prod options and the table lookups are unchanged.
 */
const DEFERRAL_REUSE_MS = 10_000;
const recentDeferrals = new WeakMap<DataformCompiledJson, Map<string, { at: number, generation: number, resolution: Promise<DeferralResolution> }>>();

/** Like {@link resolveDeferralForActions}, but says why defer to prod is on and still not applied */
async function tryResolveDeferral(
    selected: SelectedActions,
    devGraph: DataformCompiledJson,
    workspaceFolder: string,
    options: ResolveOptions = {},
): Promise<DeferralResolution> {
    if (!(options.enabled ?? isDeferEnabled(workspaceFolder))) {
        return {};
    }
    const availability = getDeferAvailability(workspaceFolder);
    if (!availability.available) {
        return {};
    }

    const key = JSON.stringify([workspaceFolder, availability.prodOptions, selected.map((action) => action.target ? targetId(action.target) : '').sort()]);
    let byKey = recentDeferrals.get(devGraph);
    if (!byKey) {
        byKey = new Map();
        recentDeferrals.set(devGraph, byKey);
    }
    let recent = byKey.get(key);
    const generation = getTableExistenceGeneration();
    if (!recent || recent.generation !== generation || Date.now() - recent.at > DEFERRAL_REUSE_MS) {
        recent = { at: Date.now(), generation, resolution: computeDeferral(selected, devGraph, workspaceFolder, availability.prodOptions) };
        byKey.set(key, recent);
    }
    const resolution = await recent.resolution;
    if (options.awaitStale) {
        await resolution.staleFlags;
    }
    return resolution;
}

async function computeDeferral(
    selected: SelectedActions,
    devGraph: DataformCompiledJson,
    workspaceFolder: string,
    prodOptions: string,
): Promise<DeferralResolution> {
    const devActions = indexGraphActions(devGraph);
    const requiredKeys = selected
        .flatMap((action) => action.dependencyTargets ?? [])
        .map((dependency) => prodKey(devActions.get(targetId(dependency)) ?? { target: dependency }));

    try {
        const prodTargets = await getProdTargets(workspaceFolder, prodOptions, requiredKeys);
        if (prodMatchesDev(devGraph, prodTargets)) {
            const prod = prodOptions ? `The prod compiler options (${prodOptions})` : "Prod, which is the project defaults,";
            throw new Error(`${prod} name the same tables as dev, so there is nothing to read from prod. Point the prod compiler options at your prod project, e.g. --default-database=my-prod-project.`);
        }
        const candidates = collectCandidates(selected, devActions, prodTargets);
        if (candidates.length === 0) {
            lastReportedError = undefined;
            return { deferral: { entries: [] } };
        }
        const existingDev = await findExistingDevTargets(candidates.map((candidate) => candidate.dev));
        const prodToCheck = candidates.filter((candidate) => candidate.prod && !existingDev.has(targetId(candidate.dev)));
        const builtInDevCandidates = candidates.filter((candidate) => candidate.prod && existingDev.has(targetId(candidate.dev)));
        const [prodStatuses, lastModified] = await Promise.all([
            getProdStatuses(
                prodToCheck.map((candidate) => candidate.prod!),
                new Set(prodToCheck.filter((candidate) => candidate.routine).map((candidate) => targetId(candidate.prod!))),
            ),
            getDevLastModified(
                builtInDevCandidates.map((candidate) => candidate.dev),
                new Set(builtInDevCandidates.filter((candidate) => candidate.routine).map((candidate) => targetId(candidate.dev))),
            ),
        ]);
        const builtInDev = builtInDevCandidates.map(({ dev }) => ({ dev, lastModified: lastModified.get(targetId(dev)) }));
        const entries = decideDeferral(candidates, {
            devExists: (target) => existingDev.has(targetId(target)),
            prodStatus: (target) => prodStatuses.get(targetId(target)) ?? "missing",
        });
        lastReportedError = undefined;
        const staleFlags = flagStaleDeferrals(entries, workspaceFolder, devGraph);
        return { deferral: { entries, builtInDev }, staleFlags };
    } catch (error: any) {
        const message = error?.message ?? String(error);
        reportError(message);
        return { error: message };
    }
}


/**
 * Upstream actions of the Selected Actions whose Dev Target is a Proxy View left by an earlier deferred run:
 * they read prod even with defer to prod off. Only looked up once this workspace has created proxy views.
 */
export async function findLeftoverProxies(selected: SelectedActions): Promise<Target[]> {
    if (!proxyViewsMayExist()) {
        return [];
    }
    const selectedIds = new Set(selected.filter((action) => action.target).map((action) => targetId(action.target!)));
    const upstream = new Map<string, Target>();
    for (const dependency of selected.flatMap((action) => action.dependencyTargets ?? [])) {
        if (!selectedIds.has(targetId(dependency))) {
            upstream.set(targetId(dependency), dependency);
        }
    }
    try {
        return await findProxyViews([...upstream.values()]);
    } catch (error: any) {
        logger.error(`Defer to prod: could not look for leftover proxy views: ${error?.message}`);
        return [];
    }
}

/**
 * Rewrites the queries of the current file so deferred upstream actions are read from prod. Called for every
 * read of the current file's metadata, so dry runs, previews and the compiled query panel all see the same SQL.
 * A retry after an `Access Denied` error just reads the metadata again: the unreadable Prod Target is then skipped.
 * When nothing is deferred, it reports upstream Proxy Views that still read prod, and when the lookup failed, why.
 */
export async function deferFileMetadata(fileMetadata: TablesWtFullQuery, devGraph: DataformCompiledJson, workspaceFolder: string): Promise<{ deferral?: Deferral, deferralError?: string, leftoverProxies?: string[] }> {
    try {
        const { deferral, error } = await tryResolveDeferral(fileMetadata.tables ?? [], devGraph, workspaceFolder);
        if (error) {
            return { deferralError: error };
        }
        if (!deferral) {
            const leftovers = await findLeftoverProxies(fileMetadata.tables ?? []);
            return { leftoverProxies: leftovers.length > 0 ? leftovers.map(targetId) : undefined };
        }
        if (countDeferred(deferral) > 0) {
            fileMetadata.queryMeta = applyDeferral(fileMetadata.queryMeta, deferral.entries);
        }
        return { deferral };
    } finally {
        // A compile or a new lookup may have changed what editors should show for the file
        deferralResolved.fire();
    }
}

/**
 * Marks deferred entries that are Changed Actions: reading their Prod Target ignores this branch's changes.
 * Uses the base graph Run Changed has cached; without one it is compiled in the background and the flags
 * arrive through `onDeferralUpdated`. Resolves to true when any entry was flagged.
 */
async function flagStaleDeferrals(entries: DeferralEntry[], workspaceFolder: string, head: DataformCompiledJson): Promise<boolean> {
    const deferred = entries.filter((entry) => entry.status === "deferred");
    if (deferred.length === 0 || !(await isGitRepo(workspaceFolder))) {
        return false;
    }
    const apply = (changedTargets: Set<string>) => {
        let flagged = false;
        for (const entry of deferred) {
            if (changedTargets.has(targetId(entry.dev))) {
                entry.stale = true;
                flagged = true;
            }
        }
        return flagged;
    };
    try {
        const cached = await computeChangedActions(workspaceFolder, head, false);
        if (cached) {
            return apply(new Set(cached.changed.map((action) => action.target)));
        }
        const computed = await computeChangedActions(workspaceFolder, head, true);
        if (computed && apply(new Set(computed.changed.map((action) => action.target)))) {
            deferralUpdated.fire();
            return true;
        }
        return false;
    } catch (error: any) {
        logger.error(`Defer to prod: could not check for changed upstream actions: ${error?.message}`);
        return false;
    }
}

/**
 * Prod Targets named in `Access Denied` errors of deferred queries. They are remembered as unreadable, so the
 * next deferral keeps those upstream actions on their Dev Target. Returns the newly unreadable ones.
 */
export function handleAccessDenied(deferral: Deferral | undefined, errorMessages: (string | undefined)[]): Target[] {
    if (!deferral) {
        return [];
    }
    const deferredProd = new Set(deferral.entries.filter((entry) => entry.status === "deferred" && entry.prod).map((entry) => targetId(entry.prod!)));
    const denied = errorMessages
        .flatMap((message) => findAccessDeniedTargets(message))
        .filter((target) => deferredProd.has(targetId(target)));
    if (denied.length === 0 || !markProdUnreadable(denied)) {
        return [];
    }
    const names = denied.map(targetId).join(", ");
    vscode.window.showWarningMessage(`No read access to ${names} in prod, so the dev table is used instead.`, "Turn off defer to prod")
        .then((choice) => {
            if (choice) {
                vscode.commands.executeCommand('vscode-dataform-tools.toggleDeferToProd', false);
            }
        });
    return denied;
}

export function countDeferred(deferral: Deferral | undefined): number {
    return deferral?.entries.filter((entry) => entry.status === "deferred").length ?? 0;
}

/** Null when defer to prod is off or unavailable; the banner then shows the switch or why it is not applied */
export function toDeferralView(deferral: Deferral | undefined, error?: string): DeferralView | null {
    if (error) {
        return { status: "error", message: error };
    }
    if (!deferral) {
        return null;
    }
    return {
        status: "ready",
        entries: deferral.entries.map((entry) => ({
            dev: targetId(entry.dev),
            prod: entry.prod ? targetId(entry.prod) : undefined,
            status: entry.status,
            stale: entry.stale,
        })),
        builtInDev: (deferral.builtInDev ?? []).map((entry) => ({ dev: targetId(entry.dev), lastModified: entry.lastModified })),
    };
}
