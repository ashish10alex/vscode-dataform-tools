import { ActionId, Target, buildsTable, isExternalKind, targetId } from '../../shared/compiledGraph';
import type { DbtGraph } from './graph';
import type { DbtOptions } from './options';

/*
 * Defer to prod in a dbt Project. dbt does it itself (`--defer`): given the manifest of prod, a `ref()` to an action
 * that is not selected and is not built in the dbt target resolves to where that manifest says the action is. The
 * extension gives dbt the manifest and reads back what dbt decided, so that the panel can list it; it never decides
 * itself, and asks BigQuery nothing.
 *
 * Both engines were checked (dbt-core 1.12, dbt v2 2.0): each defers in `compile` and in `build`, from a manifest
 * that `dbt parse` wrote, and each takes `--defer-state`, which dbt v2's `--help` does not list.
 */

/** The arguments that make a compile or a run defer to the manifest in `defer.stateDir`. None without `defer` */
export function dbtDeferArguments(defer: DbtOptions['defer']): string[] {
    return defer ? ['--defer', '--defer-state', defer.stateDir] : [];
}

/** What a compile with `--defer` did with the tables the actions on show read */
export interface DbtDeferral {
    /** Read from prod: not built in the dbt target */
    deferred: Array<{ dev: Target; prod: Target }>;
    /** Read from the dbt target, where it is built, though prod has it */
    builtInDev: Target[];
}

/** How BigQuery SQL that dbt compiled names a table */
function relationOf(target: Target): string {
    return `\`${target.database}\`.\`${target.schema}\`.\`${target.name}\``;
}

/**
 * Which of the tables that the actions `shown` read were compiled to their table in prod. `dev` is the compile on
 * show and `prod` the manifest it deferred to; an action is the same in both when dbt calls it the same, since its
 * Target differs. A table is listed when prod has it somewhere else than the dbt target: as deferred when the SQL
 * of an action on show names its table in prod, else as built in dev. What prod does not have (new on the branch), a
 * source, and an action whose SQL this compile left out are not listed. An ephemeral model has no table: what it
 * reads counts as read by the action it is inlined into.
 */
export function dbtDeferral(dev: DbtGraph, prod: DbtGraph, shown: ActionId[]): DbtDeferral {
    const prodTargets = new Map<string, Target>();
    for (const action of Object.values(prod.graph.actions)) {
        const name = prod.dbt.names[action.id]?.qualifiedName;
        if (name && buildsTable(action) && !isExternalKind(action.kind)) {
            prodTargets.set(name, action.target);
        }
    }
    const result: DbtDeferral = { deferred: [], builtInDev: [] };
    const listed = new Set<ActionId>();
    for (const id of shown) {
        const action = dev.graph.actions[id];
        if (!action?.sqlPresent || action.sections.length === 0) {
            continue;
        }
        const sql = action.sections.filter((section) => section.compiled).map((section) => section.sql).join('\n');
        const visited = new Set<ActionId>();
        const read = [...action.dependencyTargets];
        for (let target = read.pop(); target !== undefined; target = read.pop()) {
            const upstream = dev.graph.actions[targetId(target)];
            if (!upstream || visited.has(upstream.id)) {
                continue;
            }
            visited.add(upstream.id);
            if (upstream.kind === 'ephemeral') {
                read.push(...upstream.dependencyTargets);
                continue;
            }
            const name = dev.dbt.names[upstream.id]?.qualifiedName;
            const prodTarget = name === undefined ? undefined : prodTargets.get(name);
            if (!prodTarget || isExternalKind(upstream.kind) || !buildsTable(upstream) || targetId(prodTarget) === upstream.id || listed.has(upstream.id)) {
                continue;
            }
            listed.add(upstream.id);
            if (sql.includes(relationOf(prodTarget))) {
                result.deferred.push({ dev: upstream.target, prod: prodTarget });
            } else {
                result.builtInDev.push(upstream.target);
            }
        }
    }
    const byId = (a: Target, b: Target) => (targetId(a) < targetId(b) ? -1 : targetId(a) > targetId(b) ? 1 : 0);
    result.deferred.sort((a, b) => byId(a.dev, b.dev));
    result.builtInDev.sort(byId);
    return result;
}
