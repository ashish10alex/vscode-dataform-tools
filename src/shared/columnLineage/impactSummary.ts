import { SchemaField, diffSchemas } from './impactRules';
import { inBatches } from './traceController';
import { ColumnChange, ColumnLink, DependencyType, RunBreak, TraceSource } from './types';

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
    /** Set on a reader this branch renames: `table` is its new Prod Target, and it is judged by its new SQL */
    renamedFrom?: string;
    /**
     * What a dry run of a changed reader that still names a dropped column found, reading the changed table as the
     * branch builds it: clear, it no longer reads the column (and is probably updated); reads, BigQuery couldn't
     * find the column. Undefined when it wasn't dry run or there was no telling.
     */
    checked?: 'clear' | 'reads';
    /** A Dataform property graph, found in the compile, as lineage doesn't record what one reads */
    graph?: boolean;
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
    /** An action the base doesn't have */
    new?: boolean;
    /** A new action whose table is already in BigQuery, and so was compared: a run of the branch built it, or an action deleted earlier is back */
    exists?: boolean;
    /** Set on a new action that is a deleted one renamed (a renamed file, or a new schema or name): the old Prod Target */
    renamedFrom?: string;
    /** A renamed action whose own table isn't in BigQuery yet, compared with the table of `renamedFrom` */
    fromOld?: boolean;
    /** Set on a deleted table whose action was renamed: the new Prod Target. Readers still on the old name keep reading a table nothing updates */
    renamedTo?: string;
}

export interface UncheckedTable {
    table: string;
    fileName?: string;
    reason: string;
    /** As for `ImpactTable`: the table is one half of a rename */
    renamedFrom?: string;
    renamedTo?: string;
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
    /**
     * New actions with nothing to lose: no table in BigQuery yet, or one (`exists`) whose columns all survive. A
     * new action that drops or retypes a column of its table is in `atRisk`.
     */
    new: ImpactTable[];
    unchecked: UncheckedTable[];
    /** `prodCompilerOptions` when that setting isn't set: the changes were compared with the default targets, which may be dev tables */
    unset?: string;
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
    /** The new Prod Targets of the deleted actions this branch renames, by the old */
    renamed?: ReadonlyMap<string, string>;
    /**
     * The readers of a table's column, or of the table when `column` is undefined, that the project's compile knows
     * and lineage may not: its property graphs
     */
    projectReaders?: (table: string, column?: string) => ColumnLink[];
    /** Whether an action of this project is a property graph */
    isGraph?: (table: string) => boolean;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `sql` names `identifier` as a whole word, case-insensitively as BigQuery compares column names. A dotted
 * identifier is a table path, `dataset.table`, and matches with backticks round each part too:
 * `` `p.dataset.table` `` and `` `dataset`.`table` ``. Only a hint: an alias or a `SELECT *` can make it wrong
 * either way.
 */
export function mentions(sql: string, identifier: string): boolean {
    const pattern = identifier.split('.').map(escapeRegExp).join('`?\\.`?');
    return new RegExp(`(?<![\\w$])${pattern}(?![\\w$])`, 'i').test(sql);
}

/**
 * What a reader of the table `table` has to stop naming when it is deleted: `dataset.table`, its last two parts.
 * The table name alone isn't enough: a branch that moves a table to another dataset leaves its readers naming the
 * new table by the same name.
 */
export function tablePath(table: string): string {
    return table.split('.').slice(-2).join('.');
}

/**
 * A reader as the summary shows it. `name`: what the reader would have to stop naming, the column for a dropped or
 * retyped column, the table path (see `tablePath`) for a deleted table.
 */
export function annotateReader(link: ColumnLink, name: string, context: ReaderContext): ImpactReader {
    let table = context.toProd?.(link.table) ?? link.table;
    const reader: ImpactReader = { table, dependencyType: link.dependencyType };
    if (link.column) {
        reader.column = link.column;
    }
    const renamedTo = context.renamed?.get(table);
    if (renamedTo) {
        reader.renamedFrom = table;
        reader.table = table = renamedTo;
    }
    if (context.isGraph?.(table)) {
        reader.graph = true;
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
        // An incremental table reads itself, under its old name too when renamed
        return reader.table === table || reader.renamedFrom === table || (assertion && !reader.deletedOnBranch) ? [] : [reader];
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

export function summaryCounts(view: Pick<ImpactView, 'changedCount' | 'atRisk' | 'new' | 'unchecked'>): string {
    const low = view.atRisk.filter(isLowImpact).length;
    const parts = [`${view.changedCount} changed`, `${view.atRisk.length - low} at risk`];
    if (low) {
        parts.push(`${low} low`);
    }
    if (view.new.length) {
        parts.push(`${view.new.length} new`);
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
 * Why dropping `column` breaks the incremental run of a table whose uniqueKey is `key`, or undefined when it doesn't.
 * Dataform's incremental MERGE or INSERT names every column the table in BigQuery has, reading each from the query,
 * so a dropped column fails the next run until a full refresh rebuilds the table ('table'); one uniqueKey still names
 * fails every run, after a full refresh too ('uniqueKey'). `ownRun`: the table is a Dataform incremental table.
 */
export function breaksRun(change: ColumnChange, column: string, ownRun: boolean, key: string[] | undefined): RunBreak | undefined {
    if (!ownRun || change.kind !== 'dropped') {
        return undefined;
    }
    return (key ?? []).some((name) => name.replace(/`/g, '').toLowerCase() === column.toLowerCase()) ? 'uniqueKey' : 'table';
}

/** The change is the base branch's but the run break isn't: this branch's uniqueKey names the dropped column and the base's doesn't */
function keyedHere(change: ColumnChange): boolean {
    return !!change.onBase && change.breaksRun === 'uniqueKey' && change.baseBreaksRun !== 'uniqueKey';
}

/**
 * How urgent a change is: low for a change the base branch already made, which this branch can do nothing about,
 * unless its uniqueKey alone names the dropped column; else critical for a drop that breaks the table's own
 * incremental run; else unknown when its readers couldn't be looked up, low when nothing still reads it (no readers,
 * or only ones this branch probably updated), else critical for a drop or deletion and a warning for a retype.
 */
export function impactSeverity(change: ColumnChange | 'deleted', readers: ImpactReader[] | undefined, error?: string): ImpactSeverity {
    if (change !== 'deleted' && change.onBase && !keyedHere(change)) {
        return 'low';
    }
    if (change !== 'deleted' && change.breaksRun) {
        return 'critical';
    }
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

/**
 * What this branch does about a reader, or that it is outside the project. `movedFrom`: the reader reads a whole
 * table this branch renames, so one that no longer names it moved to the new name.
 */
export function readerNote(reader: ImpactReader, movedFrom = false): string {
    if (reader.deletedOnBranch) {
        return 'deleted here';
    }
    if (movedFrom && reader.probablyUpdated && !reader.renamedFrom) {
        return 'moved to the new name';
    }
    const note = reader.checked === 'clear' ? 'no longer reads it (dry run passes)'
        : reader.checked === 'reads' ? 'still reads it (dry run fails)'
            : reader.probablyUpdated ? 'probably updated' : reader.stillNamed ? 'still names it' : '';
    if (reader.renamedFrom) {
        return note ? `renamed here, ${note}` : 'renamed here';
    }
    if (reader.probablyUpdated) {
        return note;
    }
    if (reader.changedOnBranch) {
        return reader.stillNamed ? `changed here, ${note}` : 'changed here';
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
function readerRows(label: string, readers: ImpactReader[], table: string, wholeTable: boolean, renamed = false): string[] {
    const byTable = new Map<string, ImpactReader[]>();
    readers.forEach((reader) => byTable.set(reader.table, [...(byTable.get(reader.table) ?? []), reader]));
    const rows = [...byTable.values()].map((group) => {
        const [first] = group;
        const name = otherProject(first.table, table) ? first.table : shortTable(first.table);
        const columns = group.flatMap((reader) => reader.column ? [`\`${cell(reader.column)}\``] : []);
        const more = columns.length - READ_COLUMNS;
        const reads = columns.length ? `${columns.slice(0, READ_COLUMNS).join(', ')}${more > 0 ? `, +${more} more` : ''}` : '—';
        const link = wholeTable ? 'reads the table' : LINK_LABELS[first.dependencyType];
        return `| ${label} | \`${name}\` | ${reads} | ${link} | ${readerNote(first, wholeTable && renamed)} |`;
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

function changeCell(change: ColumnChange | 'deleted', renamedTo?: string, base = 'the base branch'): string {
    if (change === 'deleted') {
        return renamedTo ? `**RENAMED** to \`${shortTable(renamedTo)}\`` : '**TABLE DELETED**';
    }
    const text = change.kind === 'dropped' ? '**DROPPED**' : `\`${change.from} → ${change.to}\``;
    return change.onBase ? `${text}, already on ${base}` : text;
}

/** "`a`, `b`" of the columns of `table` whose change `keep` picks */
function columnsWhere(table: ImpactTable, keep: (change: ColumnChange) => boolean): string[] {
    return table.columns.filter((column) => keep(column.change)).map((column) => column.column);
}

/**
 * How the columns `table` drops break its own incremental run, as Markdown lines: this branch's in bold, then the
 * base branch's, which it carries over or fixes. `base`: the base branch, as Markdown.
 */
export function runBreaks(table: ImpactTable, base = 'the base branch'): string[] {
    const own = (change: ColumnChange) => !change.onBase || keyedHere(change);
    const key = columnsWhere(table, (change) => own(change) && change.breaksRun === 'uniqueKey');
    const whole = columnsWhere(table, (change) => own(change) && change.breaksRun === 'table');
    const fixed = columnsWhere(table, (change) => !own(change) && change.baseBreaksRun === 'uniqueKey' && change.breaksRun !== 'uniqueKey');
    const stillFails = table.columns.some(({ change }) => !own(change) && change.baseBreaksRun === 'uniqueKey' && change.breaksRun === 'table');
    const baseKey = columnsWhere(table, (change) => !own(change) && change.breaksRun === 'uniqueKey');
    const baseWhole = columnsWhere(table, (change) => !own(change) && change.breaksRun === 'table' && change.baseBreaksRun !== 'uniqueKey');
    const lines: string[] = [];
    if (key.length) {
        lines.push(`**Its own incremental run fails every time: \`uniqueKey\` still names ${codeList(key)}, which its query no longer returns.**`);
    }
    if (whole.length) {
        lines.push(`**Its own incremental run fails: Dataform's MERGE or INSERT names ${codeList(whole)}, which its table still has, until a full refresh rebuilds it.**`);
    }
    if (fixed.length) {
        lines.push(`Its own incremental run is fixed here: ${base}'s \`uniqueKey\` names ${codeList(fixed)}, which its query no longer returns, and this branch's doesn't${stillFails ? '. The next run still fails until a full refresh rebuilds it' : ''}.`);
    }
    if (baseKey.length) {
        lines.push(`Its own incremental run fails every time, as on ${base}: \`uniqueKey\` still names ${codeList(baseKey)}, which its query no longer returns.`);
    }
    if (baseWhole.length) {
        lines.push(`Its own incremental run fails, as on ${base}: Dataform's MERGE or INSERT names ${codeList(baseWhole)}, which its table still has, until a full refresh rebuilds it.`);
    }
    return lines;
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

/** Marks a new action among the tables at risk */
export const NEW_TAG = 'new on this branch';

/** What the summary says of a new action with nothing to lose: "nothing reads it yet", or "table already in `acme-prod`, keeps every column" */
export function newNote(table: ImpactTable): string {
    if (table.renamedFrom) {
        const from = `renamed from \`${shortTable(table.renamedFrom)}\``;
        if (!table.fromOld) {
            return `${from}; nothing reads it yet`;
        }
        const note = `${from}, keeps every column`;
        return table.added?.length ? `${note} and adds ${codeList(table.added)}` : note;
    }
    if (!table.exists) {
        return 'nothing reads it yet';
    }
    const note = `table already in \`${table.table.split('.')[0]}\`, keeps every column`;
    return table.added?.length ? `${note} and adds ${codeList(table.added)}` : note;
}

/**
 * What a summary compared with the default targets says, as Markdown: they may be dev tables, and the setting that
 * compares with prod. Empty when the setting is set.
 */
export function unsetHint(view: Pick<ImpactView, 'unset' | 'against'>): string {
    if (!view.unset) {
        return '';
    }
    const targets = `the project's default targets${view.against?.length ? ` (${codeList(view.against)})` : ''}`;
    return `Compared with ${targets}, which may be dev tables. Set \`${view.unset}\` to compare with prod.`;
}

/**
 * The summary as Markdown for a pull request: one table per changed model, then the tables that keep every column,
 * the new ones and what wasn't checked
 */
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
    const base = comparison ? `\`${comparison.baseRef}\`` : undefined;
    for (const table of view.atRisk) {
        lines.push('', `**Target model:** ${modelTitle(table)}`, '');
        const breaks = runBreaks(table, base);
        if (breaks.length) {
            lines.push(...breaks, '');
        }
        lines.push('| Column | Change | Severity | Downstream | Direct copies |', '| --- | --- | --- | --- | --- |');
        const readers: string[] = [];
        const row = (column: string, change: ColumnChange | 'deleted', columnReaders: ImpactReader[] | undefined, error?: string) => {
            lines.push(`| ${column} | ${changeCell(change, table.renamedTo, base)} | ${SEVERITY_LABELS[impactSeverity(change, columnReaders, error)]} | ${downstreamCell(columnReaders, error)} | ${copiesCell(columnReaders, table.table)} |`);
            readers.push(...readerRows(column, columnReaders ?? [], table.table, change === 'deleted', !!table.renamedTo));
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
        view.safe.forEach((entry) => lines.push(`- ${modelTitle(entry)}${entry.added?.length ? `: adds ${entry.added.map((column) => `\`${column}\``).join(', ')}` : ''}`));
        lines.push('', '</details>');
    }
    if (view.new.length) {
        lines.push('', `<details><summary>New (${view.new.length})</summary>`, '');
        view.new.forEach((entry) => lines.push(`- \`${shortTable(entry.table)}\`: ${newNote(entry)}`));
        lines.push('', '</details>');
    }
    if (view.unchecked.length) {
        lines.push('', `<details><summary>Not checked (${view.unchecked.length})</summary>`, '');
        view.unchecked.forEach((entry) => lines.push(`- ${modelTitle(entry)}: ${entry.reason}`));
        lines.push('', '</details>');
    }
    lines.push('', '_Downstream readers come from Dataplex lineage of prod runs in the last 30 days, about 2 h behind. '
        + '"Probably updated": changed on this branch, and its new SQL no longer names the column. '
        + '"Deleted here": the reader is deleted on this branch too. '
        + 'A renamed table is compared with the table it had, and a reader of its old name that no longer names it moved to the new one. '
        + '"Already on" the base branch: the base branch made the change too, so the table in BigQuery is behind it, and it counts as low. '
        + 'A changed reader that still names a dropped column is dry run against the branch\'s table: a pass means it no longer reads it._');
    const graphs = (readers: ImpactReader[] | undefined) => (readers ?? []).some((reader) => reader.graph);
    if (view.atRisk.some((table) => graphs(table.readers) || table.columns.some((column) => graphs(column.readers)))) {
        lines.push('', '_Property graphs come from the compile, as lineage doesn\'t record what one reads._');
    }
    const hint = unsetHint(view);
    if (hint) {
        lines.push('', `<sub>${hint}</sub>`);
    }
    return lines.join('\n');
}

/** How a table at risk is titled: its name, and whether it is new on this branch or one half of a rename */
export function modelTitle(table: Pick<ImpactTable, 'table' | 'new' | 'renamedFrom' | 'renamedTo'>): string {
    const name = `\`${shortTable(table.table)}\``;
    if (table.renamedFrom) {
        return `${name} (renamed from \`${shortTable(table.renamedFrom)}\`)`;
    }
    if (table.renamedTo) {
        return `${name} (renamed to \`${shortTable(table.renamedTo)}\`)`;
    }
    return table.new ? `${name} (${NEW_TAG})` : name;
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
    /** The base doesn't have the action */
    new?: boolean;
    /** A new action with no table to compare with: there is nothing to lose, so it wasn't dry run */
    noTable?: boolean;
    /** Set when the table couldn't be compared, e.g. its dry run failed */
    uncheckedReason?: string;
    /**
     * A deleted table as the readers' compiled SQL names it, when that differs from `table`: its target in the
     * compile with the user's compiler options, which may have a schema suffix the Prod Target hasn't
     */
    named?: string;
    /** The table `prod` was read from, whose readers are looked up, when it isn't `table`: see `fromOld` */
    target?: string;
    /** As for `ImpactTable` */
    renamedFrom?: string;
    fromOld?: boolean;
    renamedTo?: string;
    /**
     * The schema of a dry run of the action as it is at the merge-base, when the dry run drops or retypes a column
     * of `prod` and the base's could be dry run: a change it makes too is the base branch's
     */
    base?: SchemaField[];
    /** A Dataform incremental table, whose incremental run names every column its table has, and its uniqueKey */
    ownRun?: boolean;
    uniqueKey?: string[];
    /** `ownRun` and `uniqueKey` of the action at the merge-base, read with `base` */
    baseOwnRun?: boolean;
    baseUniqueKey?: string[];
}

export interface ImpactResult {
    atRisk: ImpactTable[];
    safe: ImpactTable[];
    new: ImpactTable[];
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
    const fresh: ImpactTable[] = [];
    const atRisk: ImpactTable[] = [];
    const lookups: (() => Promise<void>)[] = [];

    for (const candidate of candidates) {
        const { table, fileName, type } = candidate;
        const renamedFrom = candidate.renamedFrom ? { renamedFrom: candidate.renamedFrom } : {};
        const renamedTo = candidate.renamedTo ? { renamedTo: candidate.renamedTo } : {};
        if (candidate.uncheckedReason) {
            unchecked.push({ table, fileName, reason: candidate.uncheckedReason, ...renamedFrom, ...renamedTo });
            continue;
        }
        if (candidate.noTable) {
            fresh.push({ table, fileName, type, columns: [], new: true, ...renamedFrom });
            continue;
        }
        if (candidate.deleted) {
            const entry: ImpactTable = { table, fileName, type, deleted: true, columns: [], ...renamedTo };
            atRisk.push(entry);
            const name = tablePath(candidate.named ?? table);
            lookups.push(async () => {
                let links: ColumnLink[] = [];
                try {
                    links = source.tableReaders ? await source.tableReaders(table) : [];
                } catch (error) {
                    entry.readersError = errorMessage(error);
                }
                links = [...links, ...(context.projectReaders?.(table) ?? [])];
                if (links.length || !entry.readersError) {
                    entry.readers = impactReaders(links, table, name, context);
                }
            });
            continue;
        }
        const prod = candidate.prod ?? [];
        const dev = candidate.dev ?? [];
        const prodNames = new Set(prod.map((field) => field.name.toLowerCase()));
        const added = dev.filter((field) => !prodNames.has(field.name.toLowerCase())).map((field) => field.name);
        const onBase = candidate.base?.length ? diffSchemas(candidate.base, prod).map((impact) => JSON.stringify(impact)) : [];
        const columns: ImpactColumn[] = diffSchemas(dev, prod).map(({ column, change }) => {
            const context: ColumnChange = { ...change };
            if (onBase.includes(JSON.stringify({ column, change }))) {
                context.onBase = true;
            }
            // A renamed table compared with its old one is built anew
            const run = breaksRun(change, column, !!candidate.ownRun && !candidate.fromOld, candidate.uniqueKey);
            if (run) {
                context.breaksRun = run;
            }
            const baseRun = context.onBase ? breaksRun(change, column, !!candidate.baseOwnRun && !candidate.fromOld, candidate.baseUniqueKey) : undefined;
            if (baseRun) {
                context.baseBreaksRun = baseRun;
            }
            return { column, change: context, readers: [] };
        });
        const entry: ImpactTable = {
            table, fileName, type, columns, ...(added.length ? { added } : {}),
            ...(candidate.new ? { new: true, ...(candidate.fromOld ? {} : { exists: true }) } : {}),
            ...renamedFrom, ...(candidate.fromOld ? { fromOld: true } : {}),
        };
        // A renamed table compared with its old one: the readers to look up are the old one's
        const readersOf = candidate.target ?? table;
        // A new action that keeps every column of the table already there has nothing to lose either
        (columns.length ? atRisk : candidate.new ? fresh : safe).push(entry);
        for (const column of columns) {
            lookups.push(async () => {
                let links: ColumnLink[] = [];
                try {
                    links = await columnReaders(source, readersOf, column.column);
                } catch (error) {
                    column.readersError = errorMessage(error);
                }
                links = [...links, ...(context.projectReaders?.(readersOf, column.column) ?? [])];
                if (links.length || !column.readersError) {
                    column.readers = impactReaders(links, table, column.column, context);
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
        new: [...fresh].sort((a, b) => a.table.localeCompare(b.table)),
        unchecked: [...unchecked].sort((a, b) => a.table.localeCompare(b.table)),
    };
}
