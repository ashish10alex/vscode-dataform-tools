import { SchemaField, diffSchemas } from './impactRules';
import { inBatches } from './traceController';
import { ColumnChange, ColumnLink, DependencyType, TraceSource } from './types';

// The column impact of a branch: for every table it changes against prod, the columns it drops or retypes and who
// reads them, and the readers of the tables it deletes. Has no VS Code dependency, so the summary, its ordering and
// its Markdown are shared by the extension host, the webview and the tests.

/** Readers listed per column in the Markdown before "+N more" */
export const MARKDOWN_READERS = 5;
/** Reader tables listed when a Downstream cell is expanded, before "+N more" */
export const MARKDOWN_READER_LIST = 20;

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
    /** Removed on this branch, so it stops reading anything */
    deletedOnBranch?: boolean;
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
    /** Projects of the tables the changes were compared with, sorted; candidates with no Prod Target left out */
    against?: string[];
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
    /** The Prod Target of a reader that is a dev run of an action in this project, or of one this branch deletes */
    toProd?: (table: string) => string;
    /** Prod Targets of the actions this branch deletes */
    deleted?: ReadonlySet<string>;
    /** Whether an action of this project is an assertion */
    isAssertion?: (table: string) => boolean;
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
    const table = context.toProd?.(link.table) ?? link.table;
    const reader: ImpactReader = { table, dependencyType: link.dependencyType };
    if (link.column) {
        reader.column = link.column;
    }
    if (context.deleted?.has(table)) {
        reader.deletedOnBranch = true;
        return reader;
    }
    const filePath = context.resolveFile(table);
    if (filePath) {
        reader.filePath = filePath;
    }
    if (context.changed.has(table)) {
        reader.changedOnBranch = true;
        const sql = context.sqlOf(table);
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

/**
 * The readers of `table` as the summary shows them: dev runs folded into their action, the table itself left out,
 * and assertions left out unless this branch deletes them.
 */
export function impactReaders(links: ColumnLink[], table: string, name: string, context: ReaderContext): ImpactReader[] {
    return rankReaders(links.flatMap((link) => {
        const reader = annotateReader(link, name, context);
        const assertion = link.assertion || context.isAssertion?.(reader.table);
        return reader.table === table || (assertion && !reader.deletedOnBranch) ? [] : [reader];
    }));
}

/** Changed on this branch so it probably no longer names what was dropped, or deleted on this branch */
export function isSettled(reader: ImpactReader): boolean {
    return !!(reader.probablyUpdated || reader.deletedOnBranch);
}

const LINK_ORDER: Record<DependencyType, number> = { EXACT_COPY: 0, OTHER: 1, TABLE_ONLY: 2 };

function readerRank(reader: ImpactReader): number {
    if (reader.deletedOnBranch) {
        return 4;
    }
    if (!reader.filePath) {
        return 0; // Outside this project: can't be fixed in this change
    }
    if (reader.probablyUpdated) {
        return 3;
    }
    return reader.changedOnBranch ? 2 : 1;
}

/** One entry per reader table and column; readers outside the project first, then those probably updated, then those deleted */
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

/** Readers that still need looking at: all but the settled ones */
export function openReaders(readers: ImpactReader[] | undefined): number {
    return (readers ?? []).filter((reader) => !isSettled(reader)).length;
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

/** The project of a reader when it isn't `of`'s, e.g. a dev run, so it can't pass for a reader in prod */
export function otherProject(reader: string, of: string): string | undefined {
    const project = reader.split('.')[0];
    return project === of.split('.')[0] ? undefined : project;
}

export function summaryCounts(view: Pick<ImpactView, 'changedCount' | 'atRisk' | 'unchecked'>): string {
    const low = view.atRisk.filter(isLowImpact).length;
    const parts = [`${view.changedCount} changed`, `${view.atRisk.length - low} at risk`];
    if (low) {
        parts.push(`${low} low`);
    }
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

const SEVERITY_ORDER: ImpactSeverity[] = ['critical', 'unknown', 'warning', 'low'];

/** The most urgent severity of what the table deletes, drops or retypes */
export function tableSeverity(table: ImpactTable): ImpactSeverity {
    if (table.deleted) {
        return impactSeverity('deleted', table.readers, table.readersError);
    }
    const severities = new Set(table.columns.map((column) => impactSeverity(column.change, column.readers, column.readersError)));
    return SEVERITY_ORDER.find((severity) => severities.has(severity)) ?? 'low';
}

/** Nothing still reads what the table deletes, drops or retypes */
export function isLowImpact(table: ImpactTable): boolean {
    return tableSeverity(table) === 'low';
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

/** What this branch does about a reader, or that it is outside the project */
function readerNote(reader: ImpactReader): string {
    if (reader.deletedOnBranch) {
        return 'deleted here';
    }
    if (reader.probablyUpdated) {
        return 'probably updated';
    }
    if (reader.changedOnBranch) {
        return reader.stillNamed ? 'changed here, still names it' : 'changed here';
    }
    return reader.filePath ? '' : 'outside project';
}

/** How a reader reads the column, as the panel labels it */
export const LINK_LABELS: Record<DependencyType, string> = { EXACT_COPY: 'copy', OTHER: 'derived or filtered', TABLE_ONLY: 'may read' };

/** Reader columns named in the readers table before "+N more" */
const READ_COLUMNS = 3;

/**
 * Rows of the readers table for one changed column (or a deleted table): one per reader table, with the columns it
 * reads. `wholeTable`: readers of a deleted table, which read it whatever their link says.
 */
function readerRows(label: string, readers: ImpactReader[], table: string, wholeTable: boolean): string[] {
    const byTable = new Map<string, ImpactReader[]>();
    readers.forEach((reader) => byTable.set(reader.table, [...(byTable.get(reader.table) ?? []), reader]));
    const rows = [...byTable.values()].map((group) => {
        const [first] = group;
        const name = otherProject(first.table, table) ? first.table : shortTable(first.table);
        const columns = group.flatMap((reader) => reader.column ? [`\`${cell(reader.column)}\``] : []);
        const more = columns.length - READ_COLUMNS;
        const reads = columns.length ? `${columns.slice(0, READ_COLUMNS).join(', ')}${more > 0 ? `, +${more} more` : ''}` : '—';
        const link = wholeTable ? 'reads the table' : LINK_LABELS[first.dependencyType];
        return `| ${label} | \`${name}\` | ${reads} | ${link} | ${readerNote(first)} |`;
    });
    const more = rows.length - MARKDOWN_READER_LIST;
    return more > 0 ? [...rows.slice(0, MARKDOWN_READER_LIST), `| ${label} | +${more} more | | | |`] : rows;
}

/** e.g. "3 models, 1 outside project (+1 probably updated, +1 deleted here)", counting reader tables rather than columns */
function downstreamCell(readers: ImpactReader[] | undefined, error: string | undefined): string {
    if (error) {
        return cell(`lookup failed: ${error}`);
    }
    const tables = (keep: (reader: ImpactReader) => boolean | undefined) => new Set((readers ?? []).filter(keep).map((reader) => reader.table)).size;
    const inProject = tables((reader) => !isSettled(reader) && !!reader.filePath);
    const outside = tables((reader) => !isSettled(reader) && !reader.filePath);
    const updated = tables((reader) => reader.probablyUpdated);
    const deleted = tables((reader) => reader.deletedOnBranch);
    const settled = [updated && `+${updated} probably updated`, deleted && `+${deleted} deleted here`].filter(Boolean).join(', ');
    const parts = [inProject && plural(inProject, 'model'), outside && `${outside} outside project`].filter(Boolean).join(', ')
        || (settled ? 'none left' : 'none found');
    return settled ? `${parts} (${settled})` : parts;
}

/** Tables that copy the column of `table` unchanged, still to look at; outside the project marked */
function copiesCell(readers: ImpactReader[] | undefined, table: string): string {
    const copies = [...new Map((readers ?? [])
        .filter((reader) => reader.dependencyType === 'EXACT_COPY' && !isSettled(reader))
        .map((reader) => [reader.table, reader])).values()];
    if (!copies.length) {
        return '—';
    }
    const name = (reader: ImpactReader) => otherProject(reader.table, table) ? reader.table : shortTable(reader.table);
    const shown = copies.slice(0, MARKDOWN_READERS).map((reader) => `\`${name(reader)}\`${reader.filePath ? '' : ' *(outside)*'}`);
    const more = copies.length - MARKDOWN_READERS;
    return `${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`;
}

function changeCell(change: ColumnChange | 'deleted'): string {
    if (change === 'deleted') {
        return '**TABLE DELETED**';
    }
    return change.kind === 'dropped' ? '**DROPPED**' : `\`${change.from} → ${change.to}\``;
}

/** The projects of `tables`, sorted and without duplicates */
export function projectsOf(tables: string[]): string[] {
    return [...new Set(tables.map((table) => table.split('.')[0]).filter(Boolean))].sort();
}

/** "`a`, `b`" */
function codeList(items: string[]): string {
    return items.map((item) => `\`${item}\``).join(', ');
}

/**
 * e.g. "2 changed tables keep every prod column", or with the projects compared with, "2 changed tables keep every
 * column they have in `acme-prod`"
 */
export function safeSummary(count: number, against?: string[]): string {
    const one = count === 1;
    if (!against?.length) {
        return `${plural(count, 'changed table')} ${one ? 'keeps' : 'keep'} every prod column`;
    }
    return `${plural(count, 'changed table')} ${one ? 'keeps' : 'keep'} every column ${one ? 'it has' : 'they have'} in ${codeList(against)}`;
}

/** The summary as Markdown for a pull request: one table per changed model, then the tables that keep every column and what wasn't checked */
export function impactMarkdown(view: ImpactView): string {
    const lines: string[] = ['### Dataform Column Lineage Impact Report', ''];
    const comparison = view.comparison;
    const against = view.against?.length ? `**Evaluated against:** tables in ${codeList(view.against)}` : '**Evaluated against:** production schemas';
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
        const readers: string[] = [];
        const row = (column: string, change: ColumnChange | 'deleted', columnReaders: ImpactReader[] | undefined, error?: string) => {
            lines.push(`| ${column} | ${changeCell(change)} | ${SEVERITY_LABELS[impactSeverity(change, columnReaders, error)]} | ${downstreamCell(columnReaders, error)} | ${copiesCell(columnReaders, table.table)} |`);
            readers.push(...readerRows(column, columnReaders ?? [], table.table, change === 'deleted'));
        };
        if (table.deleted) {
            row('*whole table*', 'deleted', table.readers, table.readersError);
        } else {
            table.columns.forEach((column) => row(`\`${cell(column.column)}\``, column.change, column.readers, column.readersError));
        }
        if (readers.length) {
            lines.push('', `<details><summary>Readers (${readers.length})</summary>`, '');
            lines.push('| Column | Reader | Reads | Link | On this branch |', '| --- | --- | --- | --- | --- |', ...readers);
            lines.push('', '</details>');
        }
    }
    if (view.safe.length) {
        lines.push('', `<details><summary>${safeSummary(view.safe.length, view.against)}</summary>`, '');
        view.safe.forEach((entry) => lines.push(`- \`${shortTable(entry.table)}\`${entry.added?.length ? `: adds ${entry.added.map((column) => `\`${column}\``).join(', ')}` : ''}`));
        lines.push('', '</details>');
    }
    if (view.unchecked.length) {
        lines.push('', `<details><summary>Not checked (${view.unchecked.length})</summary>`, '');
        view.unchecked.forEach((entry) => lines.push(`- \`${shortTable(entry.table)}\`: ${entry.reason}`));
        lines.push('', '</details>');
    }
    lines.push('', '_Downstream readers come from Dataplex lineage of prod runs in the last 30 days, about 2 h behind. '
        + '"Probably updated": changed on this branch, and its new SQL no longer names the column. '
        + '"Deleted here": the reader is deleted on this branch too._');
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

/** Direct readers of a column: its column links, then readers Dataplex knows only at table level */
async function columnReaders(source: TraceSource, table: string, column: string): Promise<ColumnLink[]> {
    const links = await source.links(table, column, 'downstream');
    const linked = new Set(links.map((link) => link.table));
    const tableOnly = source.tableOnlyReaders ? await source.tableOnlyReaders(table, linked) : [];
    return [...links, ...tableOnly];
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
                    entry.readers = impactReaders(links, table, name, context);
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
                    column.readers = impactReaders(links, table, column.column, context);
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
