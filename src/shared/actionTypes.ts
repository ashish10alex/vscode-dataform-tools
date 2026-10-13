import type { DataformCompiledJson, Target } from '../types';

/*
 * Action type breakdowns for run summaries, shared by the extension and the webview (no `vscode` import).
 */

export type ActionTypeCounts = Partial<Record<ActionTypeKey, number>>;

/** `seed`, `snapshot` and `test` are a dbt Project's */
type ActionTypeKey = 'table' | 'incremental' | 'view' | 'seed' | 'snapshot' | 'assertion' | 'test' | 'operation' | 'notebook' | 'propertyGraph' | 'other';

/** Display order, with singular and plural labels. */
const ACTION_TYPE_LABELS: [ActionTypeKey, string, string][] = [
    ['table', 'table', 'tables'],
    ['incremental', 'incremental', 'incremental'],
    ['view', 'view', 'views'],
    ['seed', 'seed', 'seeds'],
    ['snapshot', 'snapshot', 'snapshots'],
    ['assertion', 'assertion', 'assertions'],
    ['test', 'test', 'tests'],
    ['operation', 'operation', 'operations'],
    ['notebook', 'notebook', 'notebooks'],
    ['propertyGraph', 'property graph', 'property graphs'],
    ['other', 'other', 'other'],
];

const targetKey = (target: Target) => `${target.database}.${target.schema}.${target.name}`;

/** Maps a compiled action's `type` (`table`, `view`, `operations`, ...), or the Kind of a dbt Project's action, to its breakdown key. */
function toActionTypeKey(type: string): ActionTypeKey {
    switch (type) {
        case 'table':
        case 'incremental':
        case 'view':
        case 'assertion':
        case 'notebook':
        case 'propertyGraph':
        case 'seed':
        case 'snapshot':
        case 'test':
            return type;
        case 'unit test':
            return 'test';
        case 'materialized view':
            return 'view';
        case 'operation':
        case 'operations':
            return 'operation';
        default:
            return 'other';
    }
}

/** Counts actions by their compiled `type`, e.g. the types of the changed actions. */
export function countTypeNames(types: string[]): ActionTypeCounts {
    const counts: ActionTypeCounts = {};
    for (const type of types) {
        const key = toActionTypeKey(type);
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

/**
 * Counts `targets` by action type, looked up in the compiled graph; targets it does not know count as `other`.
 * Undefined without a compiled graph, so the summary shows just the total rather than everything as `other`.
 */
export function countActionTypes(targets: Target[], compiled: DataformCompiledJson | undefined): ActionTypeCounts | undefined {
    if (!compiled) {
        return undefined;
    }
    const types = new Map<string, ActionTypeKey>();
    for (const table of compiled.tables ?? []) {
        const type = table.type === 'incremental' || table.type === 'view' ? table.type : 'table';
        types.set(targetKey(table.target), type);
    }
    for (const assertion of compiled.assertions ?? []) {
        types.set(targetKey(assertion.target), 'assertion');
    }
    for (const operation of compiled.operations ?? []) {
        types.set(targetKey(operation.target), 'operation');
    }
    for (const notebook of compiled.notebooks ?? []) {
        types.set(targetKey(notebook.target), 'notebook');
    }
    for (const graph of compiled.propertyGraphs ?? []) {
        types.set(targetKey(graph.target), 'propertyGraph');
    }
    const counts: ActionTypeCounts = {};
    for (const target of targets) {
        const type = types.get(targetKey(target)) ?? 'other';
        counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
}

/** `4 tables, 2 incremental, 1 view, 9 assertions`; empty without counts. */
export function describeTypeCounts(counts: ActionTypeCounts | undefined): string {
    return ACTION_TYPE_LABELS
        .filter(([key]) => (counts?.[key] ?? 0) > 0)
        .map(([key, singular, plural]) => `${counts![key]} ${counts![key] === 1 ? singular : plural}`)
        .join(', ');
}

/** `16 actions: 4 tables, 2 incremental, 1 view, 9 assertions`, or just `16 actions` without counts. */
export function describeActionTypes(total: number, counts: ActionTypeCounts | undefined): string {
    const head = `${total} action${total === 1 ? '' : 's'}`;
    const types = describeTypeCounts(counts);
    return types ? `${head}: ${types}` : head;
}
