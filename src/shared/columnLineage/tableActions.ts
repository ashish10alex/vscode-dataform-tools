/** Action types that produce a table whose columns can be traced */
const TABLE_TYPES = ['table', 'view', 'incremental'];

/**
 * The actions of a file that produce a table: tables, views, incremental tables and operations with
 * `hasOutput`. Built-in assertions (uniqueKey, nonNull, rowConditions) compile to extra assertion actions in the
 * same file; they don't change the table's columns, so they're left out.
 */
export function tableActions<T extends { type?: string; hasOutput?: boolean }>(actions: T[] | undefined): T[] {
    return (actions ?? []).filter((action) => TABLE_TYPES.includes(action?.type ?? '') || (isOperation(action) && !!action.hasOutput));
}

export function isOperation(action: { type?: string } | undefined): boolean {
    return action?.type === 'operations' || action?.type === 'operation';
}
