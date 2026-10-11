import path from 'path';
import * as vscode from 'vscode';
import { DbtGraph, DbtOptions, dbtDeferral } from '../backend/dbt';
import { readManifest } from '../backend/dbt/manifest';
import { isGitRepo, resolveChangeBase } from '../changedActions';
import { logger } from '../logger';
import { ActionId, targetId } from '../shared/compiledGraph';
import type { DeferToProdState, DeferralView } from '../types';
import { ensureDbtBase, removeDbtBase } from './dbtBases';
import type { ProjectState } from './registry';
import { extensionConfiguration } from './settings';

/*
 * Defer to prod in a dbt Project: with the `deferToProd` setting on, compiles and runs are given `--defer` and the
 * manifest of prod, so that an upstream action that is not built in the user's dbt target is read from prod. dbt
 * decides what is deferred (src/backend/dbt/defer.ts).
 *
 * The manifest of prod is not asked of the user. It is a parse of the merge-base with the default branch, as Run
 * Changed's base is, with the dbt target the `dbtProdTarget` setting names, kept by commit (dbtBases.ts). A parse
 * connects to nothing, so it needs the prod dbt target in the profile and no access to prod.
 */

function setting<T>(root: string, key: string): T | undefined {
    return extensionConfiguration(vscode.Uri.file(root)).get<T>(key) ?? undefined;
}

/** The dbt target that builds prod, from the `dbtProdTarget` setting. Undefined when it is not set */
export function dbtProdTarget(root: string): string | undefined {
    return setting<string>(root, 'dbtProdTarget')?.trim() || undefined;
}

/**
 * Whether defer to prod can be applied: a prod dbt target is named (`prod`) and is not the one in use (`target`,
 * where it is known). `enabled` is whether it is switched on, which does not change whether it can be.
 */
export function dbtDeferAvailability(enabled: boolean, prod: string | undefined, target: string | undefined): DeferToProdState {
    if (!prod) {
        return { enabled, available: false, reason: 'Set vscode-dataform-tools.dbtProdTarget to the dbt target of your profile that builds prod.' };
    }
    if (prod === target) {
        return { enabled, available: false, reason: `The dbt target in use is the prod one (${prod}), so there is nothing to defer to.` };
    }
    return { enabled, available: true };
}

/** Whether defer to prod is switched on for the Project, and whether it can be applied. `target` is the dbt target in use, where it is known */
export function dbtDeferToProdState(root: string, target: string | undefined): DeferToProdState {
    return dbtDeferAvailability(setting<boolean>(root, 'deferToProd') === true, dbtProdTarget(root), target);
}

/** What a compile or a run defers to: the directory of the prod manifest, or why there is none. Undefined when defer to prod is off or cannot be applied */
export type DbtDefer = { stateDir: string } | { error: string } | undefined;

/** By what the prod manifest is made from: why it could not be made, so that each compile does not try again */
const failures = new Map<string, string>();
/** By Project root: the graph of the prod manifest last deferred to, for the panel's list */
const prodGraphs = new Map<string, { stateDir: string; graph: DbtGraph }>();

/**
 * What a compile or a run of the Project defers to, as the settings are now. The prod manifest is parsed first when
 * it has not been for the merge-base, which takes as long as a `dbt parse`. Never rejects.
 */
export async function resolveDbtDefer(project: ProjectState, options: DbtOptions, target: string | undefined = options.target): Promise<DbtDefer> {
    const { root } = project;
    const state = dbtDeferToProdState(root, target);
    const prod = dbtProdTarget(root);
    if (!state.enabled || !state.available || !prod) {
        return undefined;
    }
    let key: string | undefined;
    try {
        if (!(await isGitRepo(root))) {
            throw new Error('The dbt project is not in a git repository, so there is no default branch to read the prod manifest from.');
        }
        const base = await resolveChangeBase(root, false);
        key = [root, prod, base.mergeBaseSha, options.binary, options.vars ?? '', options.profilesDir ?? ''].join('\n');
        const failed = failures.get(key);
        if (failed !== undefined) {
            return { error: failed };
        }
        const stateDir = await ensureDbtBase(project, { ...options, target: prod, defer: undefined }, base);
        if (prodGraphs.get(root)?.stateDir !== stateDir) {
            prodGraphs.set(root, { stateDir, graph: await readManifest(path.join(stateDir, 'manifest.json')) });
        }
        return { stateDir };
    } catch (error) {
        const message = `The manifest of the dbt target ${prod} could not be made. ${error instanceof Error ? error.message : String(error)}`;
        logger.error(`dbt: defer to prod is not applied in ${root}: ${message}`);
        if (key !== undefined) {
            failures.set(key, message);
        }
        return { error: message };
    }
}

/**
 * Forgets the prod manifest of the Project, kept or failed: the next compile or run parses it again. For when what
 * it was parsed with has changed without the commit changing, as the profile can.
 */
export async function forgetDbtProdManifest(project: ProjectState, options: DbtOptions | undefined): Promise<void> {
    const { root } = project;
    for (const key of [...failures.keys()]) {
        if (key.startsWith(`${root}\n`)) {
            failures.delete(key);
        }
    }
    prodGraphs.delete(root);
    const prod = dbtProdTarget(root);
    if (!options || !prod) {
        return;
    }
    try {
        await removeDbtBase(root, { ...options, target: prod }, await resolveChangeBase(root, false));
    } catch (error) {
        logger.error(`dbt: could not remove the prod manifest of ${root}: ${error}`);
    }
}

/**
 * What the panel lists of defer to prod for the actions `shown`: which tables they read were compiled to prod, as
 * the last compile left them, or why nothing is deferred. Null when the last compile did not defer and nothing went
 * wrong: defer to prod is off, cannot be applied, or the compile that will defer has not ended.
 */
export function dbtDeferralView(project: ProjectState, compiledWith: DbtDefer, shown: ActionId[]): DeferralView | null {
    if (!compiledWith) {
        return null;
    }
    if ('error' in compiledWith) {
        return { status: 'error', message: compiledWith.error };
    }
    const last = project.dbtBackend?.lastResult;
    const prod = prodGraphs.get(project.root);
    if (!last?.dbt || prod?.stateDir !== compiledWith.stateDir) {
        return null;
    }
    const { deferred, builtInDev } = dbtDeferral({ graph: last.graph, dbt: last.dbt }, prod.graph, shown);
    return {
        status: 'ready',
        entries: deferred.map((entry) => ({ dev: targetId(entry.dev), prod: targetId(entry.prod), status: 'deferred' as const })),
        builtInDev: builtInDev.map((dev) => ({ dev: targetId(dev) })),
    };
}
