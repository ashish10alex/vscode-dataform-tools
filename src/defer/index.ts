import * as vscode from 'vscode';
import { logger } from '../logger';
import { DataformCompiledJson, DeferToProdState, DeferralView, TablesWtFullQuery, Target } from '../types';
import { computeChangedActions, isGitRepo } from '../changedActions';
import { applyDeferral, collectCandidates, decideDeferral, DeferralEntry, findAccessDeniedTargets, indexGraphActions, prodKey, targetId } from './deferRules';
import { findExistingDevTargets, getProdStatuses, markProdUnreadable } from './tableExistence';
import { getProdCompilerOptions, getProdTargets, prefetchProdTargets } from './prodTargets';

export interface Deferral {
    entries: DeferralEntry[];
}

const deferralUpdated = new vscode.EventEmitter<void>();
/** Fires when Stale Deferral flags arrive after the deferral was first shown */
export const onDeferralUpdated = deferralUpdated.event;

let lastReportedError: string | undefined;

function settings(workspaceFolder?: string) {
    return vscode.workspace.getConfiguration('vscode-dataform-tools', workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
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
    options: { enabled?: boolean, awaitStale?: boolean } = {},
): Promise<Deferral | undefined> {
    if (!(options.enabled ?? isDeferEnabled(workspaceFolder))) {
        return undefined;
    }
    const availability = getDeferAvailability(workspaceFolder);
    if (!availability.available) {
        return undefined;
    }

    const devActions = indexGraphActions(devGraph);
    const requiredKeys = selected
        .flatMap((action) => action.dependencyTargets ?? [])
        .map((dependency) => prodKey(devActions.get(targetId(dependency)) ?? { target: dependency }));

    try {
        const prodTargets = await getProdTargets(workspaceFolder, availability.prodOptions, requiredKeys);
        const candidates = collectCandidates(selected, devActions, prodTargets);
        if (candidates.length === 0) {
            lastReportedError = undefined;
            return { entries: [] };
        }
        const existingDev = await findExistingDevTargets(candidates.map((candidate) => candidate.dev));
        const prodToCheck = candidates
            .filter((candidate) => candidate.prod && !existingDev.has(targetId(candidate.dev)))
            .map((candidate) => candidate.prod!);
        const prodStatuses = await getProdStatuses(prodToCheck);
        const entries = decideDeferral(candidates, {
            devExists: (target) => existingDev.has(targetId(target)),
            prodStatus: (target) => prodStatuses.get(targetId(target)) ?? "missing",
        });
        lastReportedError = undefined;
        const stale = flagStaleDeferrals(entries, workspaceFolder, devGraph);
        if (options.awaitStale) {
            await stale;
        }
        return { entries };
    } catch (error: any) {
        reportError(error?.message ?? String(error));
        return undefined;
    }
}

/** Which upstream actions of the current file to read from prod */
export function resolveDeferral(fileMetadata: TablesWtFullQuery, devGraph: DataformCompiledJson, workspaceFolder: string): Promise<Deferral | undefined> {
    return resolveDeferralForActions(fileMetadata.tables ?? [], devGraph, workspaceFolder);
}

/**
 * Rewrites the queries of the current file so deferred upstream actions are read from prod. Called for every
 * read of the current file's metadata, so dry runs, previews and the compiled query panel all see the same SQL.
 * A retry after an `Access Denied` error just reads the metadata again: the unreadable Prod Target is then skipped.
 */
export async function deferFileMetadata(fileMetadata: TablesWtFullQuery, devGraph: DataformCompiledJson, workspaceFolder: string): Promise<Deferral | undefined> {
    const deferral = await resolveDeferral(fileMetadata, devGraph, workspaceFolder);
    if (deferral && countDeferred(deferral) > 0) {
        fileMetadata.queryMeta = applyDeferral(fileMetadata.queryMeta, deferral.entries);
    }
    return deferral;
}

/**
 * Marks deferred entries that are Changed Actions: reading their Prod Target ignores this branch's changes.
 * Uses the base graph Run Changed has cached; without one it is compiled in the background and the flags
 * arrive through `onDeferralUpdated`.
 */
async function flagStaleDeferrals(entries: DeferralEntry[], workspaceFolder: string, head: DataformCompiledJson) {
    const deferred = entries.filter((entry) => entry.status === "deferred");
    if (deferred.length === 0 || !(await isGitRepo(workspaceFolder))) {
        return;
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
            apply(new Set(cached.changed.map((action) => action.target)));
            return;
        }
        const computed = await computeChangedActions(workspaceFolder, head, true);
        if (computed && apply(new Set(computed.changed.map((action) => action.target)))) {
            deferralUpdated.fire();
        }
    } catch (error: any) {
        logger.error(`Defer to prod: could not check for changed upstream actions: ${error?.message}`);
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

/** Null when defer to prod is off or unavailable, so the panel hides its banner */
export function toDeferralView(deferral: Deferral | undefined): DeferralView | null {
    if (!deferral) {
        return null;
    }
    return {
        entries: deferral.entries.map((entry) => ({
            dev: targetId(entry.dev),
            prod: entry.prod ? targetId(entry.prod) : undefined,
            status: entry.status,
            stale: entry.stale,
        })),
    };
}
