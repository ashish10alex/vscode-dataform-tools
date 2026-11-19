import { ImpactReader, ImpactTable, rankReaders } from '../shared/columnLineage/impactSummary';
import { inBatches } from '../shared/columnLineage/traceController';
import { Target } from '../types';

/*
 * Settles the readers that a text search can't, as xf does (internal/impact/verify.go): those this branch changes
 * whose new SQL still names a dropped column. Each is dry run with every reference to the changed table swapped for
 * that table's own query on the branch, so BigQuery resolves the names: a pass means it no longer reads the column,
 * "Unrecognized name" that it does. Any other failure leaves the reader as it was.
 */

/** Dry runs started at once */
const DRY_RUN_BATCH = 6;

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `sql` with every reference to `target`, as Dataform compiles them (`` `project.dataset.table` ``, or each part
 * quoted on its own), replaced by `query` as a subquery; undefined when `sql` has none.
 */
export function swapTable(sql: string, target: Target, query: string): string | undefined {
    const parts = [target.database, target.schema, target.name].filter((part): part is string => !!part).map(escapeRegExp);
    const pattern = new RegExp(`\`${parts.join('\\.')}\`|\`${parts.join('`\\.`')}\``, 'gi');
    if (!pattern.test(sql)) {
        return undefined;
    }
    const subquery = `(\n${query.trim().replace(/;+$/, '')}\n)`;
    return sql.replace(pattern, () => subquery);
}

/** Whether a BigQuery error is about `column` not being there: "Unrecognized name: X", or "Name X not found inside Y" */
export function missingColumn(message: string, column: string): boolean {
    const name = escapeRegExp(column);
    return new RegExp(`(unrecognized name: ${name}|name ${name} not found inside)([^A-Za-z0-9_$]|$)`, 'i').test(message);
}

/** A reader's dry run: undefined when it passes, else why it failed */
export type ReaderDryRun = (reader: string, sql: string) => Promise<string | undefined>;

export interface VerifyDeps {
    /** The compiled SQL of the reader with Prod Target `reader`, as a dry run of it plans it; undefined when there is no telling */
    readerSql: (reader: string) => string | undefined;
    /** The changed table with Prod Target `table`: its target in the compile, and its query; undefined when it has none */
    changedTable: (table: string) => { target: Target; query: string } | undefined;
    dryRun: ReaderDryRun;
}

/** What a dry run of `reader` with the changed table swapped in found: clear when it passes, reads when BigQuery can't find `column` */
async function checkReader(reader: string, column: string, changed: { target: Target; query: string }, deps: VerifyDeps): Promise<ImpactReader['checked']> {
    const sql = deps.readerSql(reader);
    const swapped = sql === undefined ? undefined : swapTable(sql, changed.target, changed.query);
    if (swapped === undefined) {
        return undefined;
    }
    const error = await deps.dryRun(reader, swapped);
    if (error === undefined) {
        return 'clear';
    }
    return missingColumn(error, column) ? 'reads' : undefined;
}

/**
 * Dry runs the readers of `tables` that still name a column this branch drops (not one the base branch dropped), and
 * marks what each found. `progress` is told after each run; once `cancelled` returns true no more start.
 */
export async function verifyReaders(
    tables: ImpactTable[],
    deps: VerifyDeps,
    progress: (done: number, total: number) => void = () => undefined,
    cancelled: () => boolean = () => false,
): Promise<void> {
    const checks: { reader: ImpactReader; column: string; changed: { target: Target; query: string } }[] = [];
    for (const table of tables) {
        const changed = table.deleted ? undefined : deps.changedTable(table.table);
        if (!changed?.query.trim()) {
            continue;
        }
        for (const column of table.columns) {
            if (column.change.kind !== 'dropped' || column.change.onBase) {
                continue;
            }
            column.readers.filter((reader) => reader.stillNamed).forEach((reader) => checks.push({ reader, column: column.column, changed }));
        }
    }
    if (!checks.length) {
        return;
    }
    let done = 0;
    progress(done, checks.length);
    await inBatches(checks, DRY_RUN_BATCH, async ({ reader, column, changed }) => {
        if (cancelled()) {
            return;
        }
        const checked = await checkReader(reader.table, column, changed, deps);
        if (checked) {
            reader.checked = checked;
            if (checked === 'clear') {
                reader.stillNamed = undefined;
                reader.probablyUpdated = true;
            }
        }
        progress(++done, checks.length);
    });
    tables.forEach((table) => table.columns.forEach((column) => {
        column.readers = rankReaders(column.readers);
    }));
}
