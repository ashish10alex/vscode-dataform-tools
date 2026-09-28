import { DataformCompiledJson, QueryMeta, Target } from '../types';

/*
 * Defer to prod (like dbt's `--defer`): an upstream action that is not selected and has not been built in
 * dev is read from its Prod Target instead. Dataform has no such feature, so the extension rewrites the
 * compiled SQL it executes itself. See CONTEXT.md and docs/adr/0001-defer-via-sql-rewrite-and-proxy-views.md.
 * Everything in this file is pure so the rules can be unit tested without BigQuery.
 */

/** Label on the dev views that phase 2 creates for runs. A Proxy View counts as a missing Dev Target. */
export const PROXY_VIEW_LABEL = "dataform_tools_proxy";

export type DeferralStatus = "deferred" | "missingEverywhere" | "unreadable";

export interface DeferralEntry {
    dev: Target;
    /** Absent when the action has no Prod Target, e.g. it is new on this branch */
    prod?: Target;
    status: DeferralStatus;
    /** A Stale Deferral: also a Changed Action, so the Prod Target does not reflect this branch */
    stale?: boolean;
}

/** An upstream action whose Dev Target differs from its Prod Target, before existence is checked */
export interface DeferralCandidate {
    dev: Target;
    prod?: Target;
}

export type ProdStatus = "exists" | "missing" | "unreadable";

export interface DeferralLookups {
    /** True when the Dev Target exists and is not a Proxy View */
    devExists: (target: Target) => boolean;
    prodStatus: (target: Target) => ProdStatus;
}

interface GraphAction {
    target: Target;
    canonicalTarget?: Target;
    type?: string;
    hasOutput?: boolean;
}

export function targetId(target: Target): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

/**
 * Matches an action across compiles with different compiler options. `canonicalTarget` ignores schema
 * suffixes and table prefixes but follows the default database, so the database is left out.
 */
export function prodKey(action: GraphAction): string {
    const target = action.canonicalTarget ?? action.target;
    return `${target.schema}.${target.name}`;
}

/** Like {@link prodKey} but with the database, to tell apart actions that share a schema and name across databases */
function fullProdKey(action: GraphAction): string {
    return targetId(action.canonicalTarget ?? action.target);
}

/** Prod Target of an action: by {@link fullProdKey} when the database matches, else by {@link prodKey} */
function lookupProdTarget(prodTargets: Map<string, Target>, action: GraphAction): Target | undefined {
    return prodTargets.get(fullProdKey(action)) ?? prodTargets.get(prodKey(action));
}

function graphActions(graph: DataformCompiledJson): GraphAction[] {
    const actions: GraphAction[] = [
        ...(graph.tables ?? []),
        ...(graph.operations ?? []),
        ...(graph.assertions ?? []),
        ...(graph.declarations ?? []),
    ];
    return actions.filter((action) => !!action?.target);
}

/** Every action and declaration of a compile, keyed by its target id */
export function indexGraphActions(graph: DataformCompiledJson): Map<string, GraphAction> {
    return new Map(graphActions(graph).map((action) => [targetId(action.target), action]));
}

/**
 * Prod Target of every action and declaration of a compile made with the Prod Options, keyed by both
 * {@link fullProdKey} and {@link prodKey}. A {@link prodKey} shared by actions in different databases is
 * left out, so such an action is only matched when its database is the same in both compiles.
 */
export function buildProdTargetMap(prodGraph: DataformCompiledJson): Map<string, Target> {
    const targets = new Map<string, Target>();
    const ambiguous = new Set<string>();
    for (const action of graphActions(prodGraph)) {
        targets.set(fullProdKey(action), action.target);
        const key = prodKey(action);
        const existing = targets.get(key);
        if (existing && targetId(existing) !== targetId(action.target)) {
            ambiguous.add(key);
        }
        targets.set(key, action.target);
    }
    ambiguous.forEach((key) => targets.delete(key));
    return targets;
}

/**
 * Upstream actions of the Selected Actions whose Dev Target differs from their Prod Target. Selected Actions
 * are never deferred, and neither are operations without output, which have no table to read.
 */
export function collectCandidates(
    selected: { target?: Target, dependencyTargets?: Target[], type?: string }[],
    devActions: Map<string, GraphAction>,
    prodTargets: Map<string, Target>,
): DeferralCandidate[] {
    const selectedIds = new Set(selected.filter((action) => action.target).map((action) => targetId(action.target!)));
    const candidates = new Map<string, DeferralCandidate>();
    for (const action of selected) {
        if (action.type === "test") {
            continue;
        }
        for (const dependency of action.dependencyTargets ?? []) {
            const id = targetId(dependency);
            if (selectedIds.has(id) || candidates.has(id)) {
                continue;
            }
            const upstream = devActions.get(id);
            if (upstream?.type === "operations" && !upstream.hasOutput) {
                continue;
            }
            const prod = lookupProdTarget(prodTargets, upstream ?? { target: dependency });
            if (prod && targetId(prod) === id) {
                continue;
            }
            candidates.set(id, { dev: dependency, prod });
        }
    }
    return [...candidates.values()];
}

/** Applies the defer rule to candidates whose existence has been looked up. Returns only candidates missing in dev. */
export function decideDeferral(candidates: DeferralCandidate[], lookups: DeferralLookups): DeferralEntry[] {
    const entries: DeferralEntry[] = [];
    for (const { dev, prod } of candidates) {
        if (lookups.devExists(dev)) {
            continue;
        }
        const status = prod ? lookups.prodStatus(prod) : "missing";
        if (status === "exists") {
            entries.push({ dev, prod, status: "deferred" });
        } else if (status === "unreadable") {
            entries.push({ dev, prod, status: "unreadable" });
        } else {
            entries.push({ dev, prod, status: "missingEverywhere" });
        }
    }
    return entries;
}

/**
 * Swaps the Dev Target of each deferred entry for its Prod Target. Dataform renders refs as backtick-quoted
 * `database.schema.name`, so only that exact form is replaced. Newlines are untouched, which keeps the line
 * numbers of dry run errors valid.
 */
export function rewriteSql(sql: string, entries: DeferralEntry[]): string {
    if (!sql) {
        return sql;
    }
    let rewritten = sql;
    for (const entry of entries) {
        if (entry.status !== "deferred" || !entry.prod) {
            continue;
        }
        rewritten = rewritten.split(`\`${targetId(entry.dev)}\``).join(`\`${targetId(entry.prod)}\``);
    }
    return rewritten;
}

/** A copy of `queryMeta` with every executable query rewritten. Unit test queries run on fixed inputs, so they are left alone. */
export function applyDeferral(queryMeta: QueryMeta, entries: DeferralEntry[]): QueryMeta {
    const rewrite = (sql: string) => rewriteSql(sql, entries);
    return {
        ...queryMeta,
        preOpsQuery: rewrite(queryMeta.preOpsQuery),
        postOpsQuery: rewrite(queryMeta.postOpsQuery),
        incrementalPreOpsQuery: rewrite(queryMeta.incrementalPreOpsQuery),
        assertionQuery: rewrite(queryMeta.assertionQuery),
        operationsQuery: rewrite(queryMeta.operationsQuery),
        tableQueries: queryMeta.tableQueries.map((q) => ({ ...q, query: rewrite(q.query), preOpsQuery: rewrite(q.preOpsQuery) })),
        incrementalQueries: queryMeta.incrementalQueries.map((q) => ({
            ...q,
            incrementalQuery: rewrite(q.incrementalQuery),
            nonIncrementalQuery: rewrite(q.nonIncrementalQuery),
            preOpsQuery: rewrite(q.preOpsQuery),
            incrementalPreOpsQuery: rewrite(q.incrementalPreOpsQuery),
        })),
        assertionQueries: queryMeta.assertionQueries.map((q) => ({ ...q, query: rewrite(q.query) })),
        operationQueries: queryMeta.operationQueries.map((q) => ({ ...q, query: rewrite(q.query), preOpsQuery: rewrite(q.preOpsQuery) })),
        testQueries: queryMeta.testQueries.map((q) => ({ ...q })),
    };
}

/** Tables named in BigQuery `Access Denied: Table project:dataset.table` errors */
export function findAccessDeniedTargets(errorMessage: string | undefined): Target[] {
    if (!errorMessage) {
        return [];
    }
    const targets: Target[] = [];
    // Table names cannot contain dots, so a sentence-ending period is not taken as part of the name
    for (const match of errorMessage.matchAll(/Access Denied: Table ([^:\s]+):([^.\s]+)\.([^:\s,.]+)/g)) {
        targets.push({ database: match[1], schema: match[2], name: match[3] });
    }
    return targets;
}

interface RunnableAction {
    target: Target;
    fileName?: string;
    type?: string;
    tags?: string[];
    dependencyTargets?: Target[];
}

export interface RunSelection {
    kind: "currentFile" | "files" | "tags" | "changed";
    /** Workspace-relative files, tag names or `database.schema.name` target ids, depending on `kind` */
    items: string[];
    includeDependencies: boolean;
    includeDependents: boolean;
}

/**
 * The actions a run builds: the ones it selects, plus their transitive dependencies or dependents when the
 * run includes them. Upstream actions outside this set are the ones a deferred run reads from prod.
 */
export function computeRunSet(graph: DataformCompiledJson, selection: RunSelection): RunnableAction[] {
    const actions: RunnableAction[] = [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.assertions ?? [])]
        .filter((action) => action?.target && action.type !== "test");
    const byId = new Map(actions.map((action) => [targetId(action.target), action]));

    const items = new Set(selection.items);
    const seeds = actions.filter((action) => {
        switch (selection.kind) {
            case "currentFile":
            case "files":
                return !!action.fileName && items.has(action.fileName);
            case "tags":
                return (action.tags ?? []).some((tag) => items.has(tag));
            case "changed":
                return items.has(targetId(action.target));
        }
    });

    const runSet = new Map(seeds.map((action) => [targetId(action.target), action]));
    const walk = (next: (action: RunnableAction) => string[]) => {
        const queue = [...runSet.values()];
        while (queue.length > 0) {
            for (const id of next(queue.pop()!)) {
                const action = byId.get(id);
                if (action && !runSet.has(id)) {
                    runSet.set(id, action);
                    queue.push(action);
                }
            }
        }
    };
    if (selection.includeDependencies) {
        walk((action) => (action.dependencyTargets ?? []).map(targetId));
    }
    if (selection.includeDependents) {
        const dependents = new Map<string, string[]>();
        for (const action of actions) {
            for (const dependency of action.dependencyTargets ?? []) {
                const id = targetId(dependency);
                dependents.set(id, [...(dependents.get(id) ?? []), targetId(action.target)]);
            }
        }
        walk((action) => dependents.get(targetId(action.target)) ?? []);
    }
    return [...runSet.values()];
}

export interface ProxyViewSpec {
    projectId: string;
    datasetId: string;
    tableId: string;
    query: string;
    labels: { [key: string]: string };
    description: string;
}

/** The view created at a Deferred Action's Dev Target so a Dataform run reads its Prod Target */
export function proxyViewSpec(entry: DeferralEntry): ProxyViewSpec {
    if (!entry.prod) {
        throw new Error(`${targetId(entry.dev)} has no prod table to read`);
    }
    return {
        projectId: entry.dev.database,
        datasetId: entry.dev.schema,
        tableId: entry.dev.name,
        query: `SELECT * FROM \`${targetId(entry.prod)}\``,
        labels: { [PROXY_VIEW_LABEL]: "true" },
        description: `Defer to prod proxy for ${targetId(entry.prod)}, created by Dataform Tools. The next dev build of this action replaces it.`,
    };
}
