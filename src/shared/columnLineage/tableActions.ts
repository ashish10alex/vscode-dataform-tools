/** Action types that produce a table whose columns can be traced and compared with prod */
const TABLE_TYPES = ['table', 'view', 'incremental'];

/**
 * The actions of a file that produce a table. Built-in assertions (uniqueKey, nonNull, rowConditions) compile
 * to extra assertion actions in the same file; they don't change the table's columns, so they're left out.
 */
export function tableActions<T extends { type?: string }>(actions: T[] | undefined): T[] {
    return (actions ?? []).filter((action) => TABLE_TYPES.includes(action?.type ?? ''));
}
