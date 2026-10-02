import { SchemaField, diffSchemas } from './impactRules';
import { inBatches } from './traceController';
import { ColumnChange, ColumnLink, DependencyType, TraceSource } from './types';

// The column impact of a branch: for every table it changes against prod, the columns it drops or retypes and who
// reads them, and the readers of the tables it deletes. Has no VS Code dependency, so the summary, its ordering and
// its Markdown are shared by the extension host, the webview and the tests.

/** Readers listed per column in the Markdown before "+N more" */
export const MARKDOWN_READERS = 5;

export interface ImpactReader {
    /** Prod Target of the reader */
    table: string;
    /** Undefined when Dataplex only has a table-level link */
    column?: string;
    dependencyType: DependencyType;
    /** Workspace-relative path when the reader is an action in this project */
    filePath?: string;
    /** This branch changes the reader too */
    changedOnBranch?: boolean;
    /** Changed on this branch, and its new SQL no longer names the column (or the deleted table) */
    probablyUpdated?: boolean;
    /** Changed on this branch, and its new SQL still names the column (or the deleted table) */
    stillNamed?: boolean;
}

export interface ImpactColumn {
    /** As prod spells it */
    column: string;
    change: ColumnChange;
    readers: ImpactReader[];
    readersError?: string;
}

export interface ImpactTable {
    /** Prod Target */
    table: string;
    fileName?: string;
    type: string;
    /** Removed on this branch: every reader loses it */
    deleted?: boolean;
    /** Dropped and retyped columns, most-read first */
    columns: ImpactColumn[];
    /** Readers of a deleted table, at table level */
    readers?: ImpactReader[];
    readersError?: string;
    /** Columns only the branch has; nothing downstream reads them yet */
    added?: string[];
}

export interface UncheckedTable {
    table: string;
    fileName?: string;
    reason: string;
}

export interface ImpactComparison {
    /** e.g. `feat/orders` */
    headRef: string;
    /** e.g. `origin/main` */
    baseRef: string;
    mergeBaseSha: string;
    /** The working tree, or the pushed commit in remote mode */
    headLabel: string;
}

export interface ImpactView {
    status: 'running' | 'ready' | 'error' | 'cancelled';
    comparison?: ImpactComparison;
    /** While running: what is being done, and how far it got */
    progress?: { phase: string; done: number; total: number };
    /** Changed or deleted tables, views and incremental tables */
    changedCount: number;
    /** Tables with dropped or retyped columns, or deleted, most-read first */
    atRisk: ImpactTable[];
    /** Changed tables whose columns all survive */
    safe: ImpactTable[];
    unchecked: UncheckedTable[];
    /** A later compile changed what the branch changes, so the summary may be out of date */
    stale?: boolean;
    message?: string;
    checkedAt?: number;
}

/** Context for annotating the readers Dataplex returns */
export interface ReaderContext {
    resolveFile: (table: string) => string | undefined;
    /** Prod Targets of the actions this branch changes */
    changed: ReadonlySet<string>;
    /** Compiled SQL of a changed reader, keyed by Prod Target */
    sqlOf: (table: string) => string | undefined;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `sql` names `identifier` as a whole word, case-insensitively as BigQuery compares column names. Only a
 * hint: an alias or a `SELECT *` can make it wrong either way.
 */
export function mentions(sql: string, identifier: string): boolean {
    return new RegExp(`(?<![\\w$])${escapeRegExp(identifier)}(?![\\w$])`, 'i').test(sql);
}

/**
 * A reader as the summary shows it. `name`: what the reader would have to stop naming, the column for a dropped or
 * retyped column, the table name for a deleted table.
 */
export function annotateReader(link: ColumnLink, name: string, context: ReaderContext): ImpactReader {
    const filePath = context.resolveFile(link.table);
    const reader: ImpactReader = { table: link.table, dependencyType: link.dependencyType };
    if (link.column) {
        reader.column = link.column;
    }
    if (filePath) {
        reader.filePath = filePath;
    }
    if (context.changed.has(link.table)) {
        reader.changedOnBranch = true;
        const sql = context.sqlOf(link.table);
        if (sql !== undefined) {
            if (mentions(sql, name)) {
                reader.stillNamed = true;
            } else {
                reader.probablyUpdated = true;
            }
        }
    }
    return reader;
}

const LINK_ORDER: Record<DependencyType, number> = { EXACT_COPY: 0, OTHER: 1, TABLE_ONLY: 2 };

function readerRank(reader: ImpactReader): number {
    if (!reader.filePath) {
        return 0; // Outside this project: can't be fixed in this change
    }
    if (reader.probablyUpdated) {
        return 3;
    }
    return reader.changedOnBranch ? 2 : 1;
}

/** One entry per reader table and column; readers outside the project first, those probably updated last */
export function rankReaders(readers: ImpactReader[]): ImpactReader[] {
    const seen = new Set<string>();
    return readers
        .filter((reader) => {
            const key = `${reader.table}#${reader.column ?? ''}`;
            return !seen.has(key) && !!seen.add(key);
        })
        .sort((a, b) =>
            readerRank(a) - readerRank(b)
            || LINK_ORDER[a.dependencyType] - LINK_ORDER[b.dependencyType]
            || a.table.localeCompare(b.table)
            || (a.column ?? '').localeCompare(b.column ?? ''));
}

/** Readers that still need looking at: all but those changed on the branch that probably dropped the column */
export function openReaders(readers: ImpactReader[] | undefined): number {
    return (readers ?? []).filter((reader) => !reader.probablyUpdated).length;
}

function tableWeight(table: ImpactTable): number {
    return openReaders(table.readers) + table.columns.reduce((sum, column) => sum + openReaders(column.readers), 0);
}

/** Columns with the most readers still to look at first, drops ahead of retypes on a tie */
export function sortColumns(columns: ImpactColumn[]): ImpactColumn[] {
    return [...columns].sort((a, b) =>
        openReaders(b.readers) - openReaders(a.readers)
        || (a.change.kind === 'dropped' ? 0 : 1) - (b.change.kind === 'dropped' ? 0 : 1)
        || a.column.localeCompare(b.column));
}

/** Tables with the most readers still to look at first */
export function sortTables(tables: ImpactTable[]): ImpactTable[] {
    return [...tables].sort((a, b) => tableWeight(b) - tableWeight(a) || a.table.localeCompare(b.table));
}

export function describeChange(change: ColumnChange): string {
    return change.kind === 'dropped' ? 'dropped' : `${change.from} → ${change.to}`;
}

/** `dataset.table` of a `project.dataset.table` */
export function shortTable(table: string): string {
    return table.split('.').slice(1).join('.');
}

export function summaryCounts(view: Pick<ImpactView, 'changedCount' | 'atRisk' | 'unchecked'>): string {
    const parts = [`${view.changedCount} changed`, `${view.atRisk.length} at risk`];
    if (view.unchecked.length) {
        parts.push(`${view.unchecked.length} not checked`);
    }
    return parts.join(' · ');
}

function plural(count: number, word: string): string {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export type ImpactSeverity = 'critical' | 'warning' | 'low' | 'unknown';

/**
 * How urgent a change is: unknown when its readers couldn't be looked up, low when nothing still reads it (no
 * readers, or only ones this branch probably updated), else critical for a drop or deletion and a warning for a retype.
 */
export function impactSeverity(change: ColumnChange | 'deleted', readers: ImpactReader[] | undefined, error?: string): ImpactSeverity {
    if (error) {
        return 'unknown';
    }
    if (!openReaders(readers)) {
        return 'low';
    }
    return change === 'deleted' || change.kind === 'dropped' ? 'critical' : 'warning';
}

const SEVERITY_LABELS: Record<ImpactSeverity, string> = {
    critical: '🚨 **CRITICAL**',
    warning: '⚠️ **WARNING**',
    low: 'ℹ️ LOW',
    unknown: '❔ UNKNOWN',
};

/** Text for a Markdown table cell: pipes would end the cell, newlines the row */
function cell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** e.g. "3 models, 1 outside project (+1 probably updated)", counting reader tables rather than columns */
function downstreamCell(readers: ImpactReader[] | undefined, error: string | undefined): string {
    if (error) {
        return cell(`lookup failed: ${error}`);
    }
    const open = (readers ?? []).filter((reader) => !reader.probablyUpdated);
    const inProject = new Set(open.filter((reader) => reader.filePath).map((reader) => reader.table)).size;
    const outside = new Set(open.filter((reader) => !reader.filePath).map((reader) => reader.table)).size;
    const settled = new Set((readers ?? []).filter((reader) => reader.probablyUpdated).map((reader) => reader.table)).size;
    const parts = [inProject && plural(inProject, 'model'), outside && `${outside} outside project`].filter(Boolean).join(', ') || 'none found';
    return settled ? `${parts} (+${settled} probably updated)` : parts;
}

/** Tables that copy the column unchanged, still to look at; outside the project marked */
function copiesCell(readers: ImpactReader[] | undefined): string {
    const copies = [...new Map((readers ?? [])
        .filter((reader) => reader.dependencyType === 'EXACT_COPY' && !reader.probablyUpdated)
        .map((reader) => [reader.table, reader])).values()];
    if (!copies.length) {
        return '—';
    }
    const shown = copies.slice(0, MARKDOWN_READERS).map((reader) => `\`${shortTable(reader.table)}\`${reader.filePath ? '' : ' *(outside)*'}`);
    const more = copies.length - MARKDOWN_READERS;
    return `${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

function changeCell(change: ColumnChange | 'deleted'): string {
    if (change === 'deleted') {
        return '**TABLE DELETED**';
    }
    return change.kind === 'dropped' ? '**DROPPED**' : `\`${change.from} → ${change.to}\``;
}

/** e.g. "2 changed tables keep every prod column" */
export function safeSummary(count: number): string {
    return count === 1 ? '1 changed table keeps every prod column' : `${count} changed tables keep every prod column`;
}

/** The summary as Markdown for a pull request: one table per changed model, then the tables that keep every column and what wasn't checked */
export function impactMarkdown(view: ImpactView): string {
    const lines: string[] = ['### Dataform Column Lineage Impact Report', ''];
    const comparison = view.comparison;
    const against = '**Evaluated against:** production schemas';
    lines.push(comparison
        ? `**Branch:** \`${comparison.headRef}\` vs \`${comparison.baseRef}\` @ \`${comparison.mergeBaseSha.slice(0, 7)}\` | ${against}`
        : against);
    lines.push('', summaryCounts(view));
    if (!view.atRisk.length) {
        lines.push('', 'No dropped or retyped columns, and no deleted tables.');
    }
    for (const table of view.atRisk) {
        lines.push('', `**Target model:** \`${shortTable(table.table)}\``, '');
        lines.push('| Column | Change | Severity | Downstream | Direct copies |', '| --- | --- | --- | --- | --- |');
        const row = (column: string, change: ColumnChange | 'deleted', readers: ImpactReader[] | undefined, error?: string) =>
            lines.push(`| ${column} | ${changeCell(change)} | ${SEVERITY_LABELS[impactSeverity(change, readers, error)]} | ${downstreamCell(readers, error)} | ${copiesCell(readers)} |`);
        if (table.deleted) {
            row('*whole table*', 'deleted', table.readers, table.readersError);
            continue;
        }
        table.columns.forEach((column) => row(`\`${cell(column.column)}\``, column.change, column.readers, column.readersError));
    }
    if (view.safe.length) {
        lines.push('', `<details><summary>${safeSummary(view.safe.length)}</summary>`, '');
        view.safe.forEach((entry) => lines.push(`- \`${shortTable(entry.table)}\`${entry.added?.length ? `: adds ${entry.added.map((column) => `\`${column}\``).join(', ')}` : ''}`));
        lines.push('', '</details>');
    }
    if (view.unchecked.length) {
        lines.push('', `<details><summary>Not checked (${view.unchecked.length})</summary>`, '');
        view.unchecked.forEach((entry) => lines.push(`- \`${shortTable(entry.table)}\`: ${entry.reason}`));
        lines.push('', '</details>');
    }
    lines.push('', '_Downstream readers come from Dataplex lineage of prod runs in the last 30 days, about 2 h behind. '
        + '"Probably updated": changed on this branch, and its new SQL no longer names the column._');
    return lines.join('\n');
}

/** A changed or deleted table, after the host read its prod schema and dry ran it */
export interface ImpactCandidate {
    /** Prod Target */
    table: string;
    fileName?: string;
    type: string;
    deleted?: boolean;
    prod?: SchemaField[];
    /** The dry run's schema; unused for a deleted table */
    dev?: SchemaField[];
    /** Set when the table couldn't be compared, e.g. its dry run failed */
    uncheckedReason?: string;
}

export interface ImpactResult {
    atRisk: ImpactTable[];
    safe: ImpactTable[];
    unchecked: UncheckedTable[];
}

/** Reader lookups in flight at once; the source throttles its own calls further */
const READER_CONCURRENCY = 4;

function errorMessage(error: any): string {
    return error?.message ?? String(error);
}

/** Direct readers of a column: its column links, then readers Dataplex knows only at table level. Assertions are left out. */
async function columnReaders(source: TraceSource, table: string, column: string): Promise<ColumnLink[]> {
    const links = await source.links(table, column, 'downstream');
    const linked = new Set(links.map((link) => link.table));
    const tableOnly = source.tableOnlyReaders ? await source.tableOnlyReaders(table, linked) : [];
    return [...links, ...tableOnly].filter((link) => !link.assertion && link.table !== table);
}

/**
 * Compares each candidate with prod and looks up who reads what it drops, retypes or deletes. `progress` is told
 * after each lookup; once `cancelled` returns true no more lookups start and undefined is returned.
 */
export async function buildImpactSummary(
    candidates: ImpactCandidate[],
    source: TraceSource,
    context: ReaderContext,
    progress: (done: number, total: number) => void = () => undefined,
    cancelled: () => boolean = () => false,
): Promise<ImpactResult | undefined> {
    const unchecked: UncheckedTable[] = [];
    const safe: ImpactTable[] = [];
    const atRisk: ImpactTable[] = [];
    const lookups: (() => Promise<void>)[] = [];

    for (const candidate of candidates) {
        const { table, fileName, type } = candidate;
        if (candidate.uncheckedReason) {
            unchecked.push({ table, fileName, reason: candidate.uncheckedReason });
            continue;
        }
        if (candidate.deleted) {
            const entry: ImpactTable = { table, fileName, type, deleted: true, columns: [] };
            atRisk.push(entry);
            const name = table.split('.').pop() ?? table;
            lookups.push(async () => {
                try {
                    const links = source.tableReaders ? await source.tableReaders(table) : [];
                    entry.readers = rankReaders(links.filter((link) => !link.assertion && link.table !== table).map((link) => annotateReader(link, name, context)));
                } catch (error) {
                    entry.readersError = errorMessage(error);
                }
            });
            continue;
        }
        const prod = candidate.prod ?? [];
        const dev = candidate.dev ?? [];
        const prodNames = new Set(prod.map((field) => field.name.toLowerCase()));
        const added = dev.filter((field) => !prodNames.has(field.name.toLowerCase())).map((field) => field.name);
        const columns: ImpactColumn[] = diffSchemas(dev, prod).map(({ column, change }) => ({ column, change, readers: [] }));
        const entry: ImpactTable = { table, fileName, type, columns, ...(added.length ? { added } : {}) };
        (columns.length ? atRisk : safe).push(entry);
        for (const column of columns) {
            lookups.push(async () => {
                try {
                    const links = await columnReaders(source, table, column.column);
                    column.readers = rankReaders(links.map((link) => annotateReader(link, column.column, context)));
                } catch (error) {
                    column.readersError = errorMessage(error);
                }
            });
        }
    }

    let done = 0;
    progress(done, lookups.length);
    await inBatches(lookups, READER_CONCURRENCY, async (lookup) => {
        if (cancelled()) {
            return;
        }
        await lookup();
        progress(++done, lookups.length);
    });
    if (cancelled()) {
        return undefined;
    }
    atRisk.forEach((entry) => {
        entry.columns = sortColumns(entry.columns);
    });
    return {
        atRisk: sortTables(atRisk),
        safe: [...safe].sort((a, b) => a.table.localeCompare(b.table)),
        unchecked: [...unchecked].sort((a, b) => a.table.localeCompare(b.table)),
    };
}
