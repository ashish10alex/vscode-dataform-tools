import { DataformCompiledJson, Target } from '../types';

/*
 * Finds the actions whose compiled output differs between two compilations of a project, the
 * Dataform equivalent of dbt's `state:modified`. Comparing compiled output rather than changed files
 * also catches actions affected by edits to includes/ or workflow_settings.yaml.
 */

/** new: not in the base graph; sql: a query differs; config: a setting that changes the built object differs. */
export type ChangeReason = 'new' | 'sql' | 'config';

export interface ChangedAction {
    /** `database.schema.name` */
    target: string;
    targetObj: Target;
    fileName: string;
    type: string;
    reasons: ChangeReason[];
}

export interface DeletedAction {
    target: string;
    fileName: string;
    type: string;
}

export interface CompiledGraphDiff {
    changed: ChangedAction[];
    deleted: DeletedAction[];
}

interface ComparableAction {
    targetObj: Target;
    fileName: string;
    type: string;
    sql: unknown;
    config: unknown;
}

export function targetKey(target: Target): string {
    return `${target.database}.${target.schema}.${target.name}`;
}

/** Descriptions, column docs, tags and dependencies are left out: changing only those does not change what a run builds. */
function collectRunnableActions(graph: DataformCompiledJson): Map<string, ComparableAction> {
    const actions = new Map<string, ComparableAction>();
    const add = (target: Target | undefined, action: Omit<ComparableAction, 'targetObj'>) => {
        if (target) {
            actions.set(targetKey(target), { targetObj: target, ...action });
        }
    };

    for (const table of graph.tables ?? []) {
        const t = table as any;
        add(table.target, {
            fileName: table.fileName,
            type: table.type,
            sql: { query: t.query, incrementalQuery: t.incrementalQuery, preOps: t.preOps, postOps: t.postOps, incrementalPreOps: t.incrementalPreOps },
            config: { type: t.type, protected: t.protected, uniqueKey: t.uniqueKey, bigquery: t.bigquery, onSchemaChange: t.onSchemaChange, disabled: t.disabled },
        });
    }
    for (const operation of graph.operations ?? []) {
        const o = operation as any;
        add(operation.target, {
            fileName: operation.fileName,
            type: 'operations',
            sql: { queries: o.queries },
            config: { hasOutput: o.hasOutput, disabled: o.disabled },
        });
    }
    for (const assertion of graph.assertions ?? []) {
        const a = assertion as any;
        add(assertion.target, {
            fileName: assertion.fileName,
            type: 'assertion',
            sql: { query: a.query, preOps: a.preOps, postOps: a.postOps },
            config: { disabled: a.disabled },
        });
    }
    for (const notebook of graph.notebooks ?? []) {
        const n = notebook as any;
        add(notebook.target, {
            fileName: notebook.fileName,
            type: 'notebook',
            sql: { notebookContents: n.notebookContents },
            config: { disabled: n.disabled },
        });
    }
    return actions;
}

/**
 * Stable serialisation that treats absent, null, false, empty strings and empty arrays/objects alike,
 * since the CLI and the API adapter omit defaults inconsistently.
 */
function normalize(value: unknown): unknown {
    if (Array.isArray(value)) {
        const items = value.map(normalize);
        return items.length > 0 ? items : undefined;
    }
    if (value && typeof value === 'object') {
        const entries = Object.keys(value as object)
            .sort()
            .map((key) => [key, normalize((value as Record<string, unknown>)[key])] as const)
            .filter(([, v]) => v !== undefined);
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }
    if (value === null || value === false || value === '') {
        return undefined;
    }
    return value;
}

function isEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

export function diffCompiledGraphs(base: DataformCompiledJson, head: DataformCompiledJson): CompiledGraphDiff {
    const baseActions = collectRunnableActions(base);
    const headActions = collectRunnableActions(head);

    const changed: ChangedAction[] = [];
    for (const [key, action] of headActions) {
        const before = baseActions.get(key);
        const reasons: ChangeReason[] = [];
        if (!before) {
            reasons.push('new');
        } else {
            if (!isEqual(before.sql, action.sql)) {
                reasons.push('sql');
            }
            if (!isEqual(before.config, action.config)) {
                reasons.push('config');
            }
        }
        if (reasons.length > 0) {
            changed.push({ target: key, targetObj: action.targetObj, fileName: action.fileName, type: action.type, reasons });
        }
    }

    const deleted: DeletedAction[] = [];
    for (const [key, action] of baseActions) {
        if (!headActions.has(key)) {
            deleted.push({ target: key, fileName: action.fileName, type: action.type });
        }
    }

    const byFileThenTarget = (a: { fileName: string, target: string }, b: { fileName: string, target: string }) =>
        (a.fileName ?? '').localeCompare(b.fileName ?? '') || a.target.localeCompare(b.target);
    return { changed: changed.sort(byFileThenTarget), deleted: deleted.sort(byFileThenTarget) };
}
