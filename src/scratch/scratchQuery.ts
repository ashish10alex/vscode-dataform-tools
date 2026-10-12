import type { BackendName } from '../project/detection';
import type { JobPlace, JobSettings } from '../bigquery/jobPlace';

/*
 * Scratch queries: `.sql` files of plain BigQuery SQL that a Project keeps in `.vscode-dataform-tools/tmp`, run as
 * they are written. What can be worked out without the editor or BigQuery is here (no `vscode` import).
 */

/** Where a Project keeps its scratch queries, from its root */
export const SCRATCH_FOLDER = '.vscode-dataform-tools/tmp';

/** Whether the file is a scratch query: a `.sql` file directly in a Project's scratch folder */
export function isScratchPath(filePath: string): boolean {
    return /(^|[\\/])\.vscode-dataform-tools[\\/]tmp[\\/][^\\/]+\.sql$/i.test(filePath);
}

const two = (n: number) => String(n).padStart(2, '0');

/** The name of a scratch query made at `now`, other than those in `taken`: `scratch-2026-10-12-1432.sql` */
export function scratchFileName(now: Date, taken: readonly string[] = []): string {
    const stem = `scratch-${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
    const names = new Set(taken.map((name) => name.toLowerCase()));
    let name = `${stem}.sql`;
    for (let n = 2; names.has(name); n++) {
        name = `${stem}-${n}.sql`;
    }
    return name;
}

/**
 * Where a scratch query's jobs run: where the previews of its Project run. `gcpProjectId` and `gcpLocation` win when
 * set. Unset, a dbt Project's jobs run in the GCP project most of its tables are in, which is that of its dbt target,
 * and a Dataform Project's in the credentials' default project.
 *
 * @param databases The GCP project of each table of the Project's Compiled Graph
 */
export function scratchJobPlace(backend: BackendName, databases: readonly string[], settings: JobSettings): JobPlace {
    const place: JobPlace = {};
    let projectId = settings.gcpProjectId?.trim();
    if (!projectId && backend === 'dbt') {
        const counts = new Map<string, number>();
        databases.filter(Boolean).forEach((database) => counts.set(database, (counts.get(database) ?? 0) + 1));
        projectId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    if (projectId) {
        place.projectId = projectId;
    }
    const location = settings.gcpLocation?.trim();
    if (location) {
        place.location = location;
    }
    return place;
}

const GIB = 1024 ** 3;

/** How loudly the status bar shows a scan: as it is, in the warning colour, or in the error colour */
export type ScanLevel = 'plain' | 'warn' | 'confirm';

/** A scan of `warnGiB` or more is shown as a warning, and one above `confirmGiB` is asked about before it runs. 0 turns a step off. */
export function scanLevel(bytes: number, warnGiB: number, confirmGiB: number): ScanLevel {
    if (confirmGiB > 0 && bytes > confirmGiB * GIB) {
        return 'confirm';
    }
    return warnGiB > 0 && bytes >= warnGiB * GIB ? 'warn' : 'plain';
}

/** What a dry run said of the text about to run */
export interface RunCheck {
    /** BigQuery's statement type: SELECT, INSERT, CREATE_TABLE, SCRIPT... Undefined when the dry run failed */
    statementType?: string;
    bytes: number;
    /** The cost of the scan, as shown: "$0.38" */
    cost?: string;
}

/**
 * What to ask before the text runs, or undefined to run it at once: a statement that is not a SELECT may change
 * data, and a scan above `confirmGiB` is costly.
 */
export function runConfirmation(check: RunCheck, confirmGiB: number): string | undefined {
    const reasons: string[] = [];
    if (check.statementType && check.statementType !== 'SELECT') {
        reasons.push(check.statementType === 'SCRIPT'
            ? 'This is a script of several statements, which may change data in BigQuery.'
            : `This is a ${check.statementType.replace(/_/g, ' ')} statement, which changes data in BigQuery.`);
    }
    if (scanLevel(check.bytes, 0, confirmGiB) === 'confirm') {
        reasons.push(`This query will scan ${(check.bytes / GIB).toFixed(2)} GiB${check.cost ? ` (~${check.cost})` : ''}.`);
    }
    return reasons.length ? `${reasons.join(' ')} Run it?` : undefined;
}

/** A table a query names: `project.dataset.table`, or `dataset.table` for one in the project its job runs in */
export interface TableName {
    projectId?: string;
    datasetId: string;
    tableId: string;
}

export const tableNameText = (table: TableName) => [table.projectId, table.datasetId, table.tableId].filter(Boolean).join('.');

/** Comments and string literals as spaces of the same length, so that what is left keeps its place */
function withoutCommentsAndStrings(sql: string): string {
    return sql.replace(/--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (match) => match.replace(/[^\n]/g, ' '));
}

/** Whether there is anything to run in the text: more than comments and space */
export function hasStatement(sql: string): boolean {
    return sql.replace(/--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() !== '';
}

/** A table a query names, and where in the text: from `start` up to `end` */
export interface TableNameAt {
    table: TableName;
    start: number;
    end: number;
}

/**
 * Each place a query names a table, read from its text, as a query being written often does not parse: names in
 * backticks and names after FROM or JOIN, of two or three parts. A name of one part is left out: it is a CTE or an
 * alias.
 */
export function tableNamesAt(sql: string): TableNameAt[] {
    const text = withoutCommentsAndStrings(sql);
    const found: TableNameAt[] = [];
    const add = (name: string, start: number) => {
        const parts = name.replace(/`/g, '').split('.').map((part) => part.trim()).filter(Boolean);
        if (parts.length < 2 || parts.length > 3 || found.some((each) => start < each.end && each.start < start + name.length)) {
            return;
        }
        const [tableId, datasetId, projectId] = [...parts].reverse();
        found.push({ table: projectId ? { projectId, datasetId, tableId } : { datasetId, tableId }, start, end: start + name.length });
    };
    // `project.dataset.table`, and `project`.`dataset`.`table` or `project.dataset`.table
    for (const match of text.matchAll(/`[^`\n]+`(?:\s*\.\s*(?:`[^`\n]+`|[\w-]+))*/g)) {
        add(match[0], match.index);
    }
    for (const match of text.matchAll(/\b(?:from|join)\s+([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*){1,2})/gi)) {
        add(match[1], match.index + match[0].length - match[1].length);
    }
    return found.sort((x, y) => x.start - y.start);
}

/** The tables a query names, each once: see `tableNamesAt` */
export function tableNamesIn(sql: string): TableName[] {
    const found = new Map<string, TableName>();
    tableNamesAt(sql).forEach(({ table }) => found.set(tableNameText(table).toLowerCase(), table));
    return [...found.values()];
}

/** The top-level column names of a table, to paste into a SELECT: one to a line, each but the last with a comma */
export function columnNamesText(fields: ReadonlyArray<{ name: string }>): string {
    return fields.map((field) => field.name).join(',\n');
}

/**
 * What is being typed of a table name at the end of `linePrefix`: from its opening backtick when it has one.
 * `inTableName` says the text can only be a table name: it is in backticks or has a dot.
 */
export function tableNamePrefix(linePrefix: string): { text: string, inTableName: boolean } {
    const text = /`?[\w.-]*$/.exec(linePrefix)?.[0] ?? '';
    return { text, inTableName: text.startsWith('`') || text.includes('.') };
}
