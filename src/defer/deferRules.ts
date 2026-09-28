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

/** Prod Target of every action and declaration of a compile made with the Prod Options, keyed by {@link prodKey} */
export function buildProdTargetMap(prodGraph: DataformCompiledJson): Map<string, Target> {
    return new Map(graphActions(prodGraph).map((action) => [prodKey(action), action.target]));
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
            const prod = prodTargets.get(prodKey(upstream ?? { target: dependency }));
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
    for (const match of errorMessage.matchAll(/Access Denied: Table ([^:\s]+):([^.\s]+)\.([^:\s,]+)/g)) {
        targets.push({ database: match[1], schema: match[2], name: match[3] });
    }
    return targets;
}
