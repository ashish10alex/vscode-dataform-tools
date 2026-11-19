import { ImpactReader, ImpactTable, mentions, rankReaders } from '../shared/columnLineage/impactSummary';
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
 * `sql` with its comments and string literals blanked out, so that what is left is code, at the same positions:
 * `--`, `#` and block comments, and quoted strings, triple-quoted ones included. Backticked names are kept.
 */
export function codeOnly(sql: string): string {
    const out = sql.split('');
    const blank = (from: number, to: number) => {
        for (let i = from; i < to; i++) {
            if (out[i] !== '\n') {
                out[i] = ' ';
            }
        }
    };
    let i = 0;
    while (i < sql.length) {
        const rest = (length: number) => sql.slice(i, i + length);
        if (rest(2) === '--' || sql[i] === '#') {
            const end = sql.indexOf('\n', i);
            const to = end < 0 ? sql.length : end;
            blank(i, to);
            i = to;
        } else if (rest(2) === '/*') {
            const end = sql.indexOf('*/', i + 2);
            const to = end < 0 ? sql.length : end + 2;
            blank(i, to);
            i = to;
        } else if (sql[i] === "'" || sql[i] === '"') {
            const quote = rest(3) === sql[i].repeat(3) ? sql[i].repeat(3) : sql[i];
            let j = i + quote.length;
            while (j < sql.length && sql.slice(j, j + quote.length) !== quote) {
                j += sql[j] === '\\' ? 2 : 1;
            }
            const to = Math.min(sql.length, j + quote.length);
            blank(i, to);
            i = to;
        } else if (sql[i] === '`') {
            const end = sql.indexOf('`', i + 1);
            i = end < 0 ? sql.length : end + 1;
        } else {
            i++;
        }
    }
    return out.join('');
}

/** Words that may follow a table in FROM without being its alias */
const NOT_ALIASES = new Set([
    'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'outer', 'on', 'using', 'group', 'order', 'limit', 'union',
    'except', 'intersect', 'window', 'qualify', 'having', 'for', 'tablesample', 'pivot', 'unpivot', 'with', 'when', 'then',
    'select', 'natural', 'lateral',
]);

/**
 * `sql` with every reference to `target`, as Dataform compiles them (`` `project.dataset.table` ``, or each part
 * quoted on its own), replaced by `query` as a subquery; undefined when there is no telling. A reference in a comment
 * or a string isn't one, and a reference written another way (unquoted, or without its project) would still read the
 * table, so none may be left. A subquery has no implicit alias, so one without an alias is given the table's name.
 */
export function swapTable(sql: string, target: Target, query: string): string | undefined {
    const parts = [target.database, target.schema, target.name].filter((part): part is string => !!part).map(escapeRegExp);
    const pattern = new RegExp(`\`${parts.join('\\.')}\`|\`${parts.join('`\\.`')}\``, 'gi');
    const code = codeOnly(sql);
    const matches = [...code.matchAll(pattern)];
    if (!matches.length) {
        return undefined;
    }
    const subquery = `(\n${query.trim().replace(/;+$/, '')}\n)`;
    let swapped = '';
    let left = '';
    let from = 0;
    for (const match of matches) {
        const end = match.index! + match[0].length;
        const alias = /^\s+(as\s+)?([A-Za-z_][A-Za-z0-9_]*|`[^`]+`)/i.exec(code.slice(end));
        const named = !!alias && (!!alias[1] || !NOT_ALIASES.has(alias[2].toLowerCase()));
        swapped += sql.slice(from, match.index) + subquery + (named ? '' : ` AS \`${target.name}\``);
        left += code.slice(from, match.index) + ' '.repeat(match[0].length);
        from = end;
    }
    swapped += sql.slice(from);
    left += code.slice(from);
    const path = [target.schema, target.name].filter(Boolean).join('.');
    return mentions(left, path) ? undefined : swapped;
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
