import { RESULT_CHUNK_ROWS, type ResultFilter, type ResultSort } from '../shared/queryResultsView';

/*
 * The result of a query job, read from BigQuery a part at a time: the job keeps its rows in a temporary table,
 * so the rows are asked for when they are looked at, and a sort or a filter is a query over that table. No
 * `vscode` or BigQuery client import: what talks to BigQuery is passed in.
 */

/** A field of the schema BigQuery sends with a job's rows */
export interface SchemaField {
    name?: string;
    type?: string;
    mode?: string;
    fields?: SchemaField[];
}

/** The temporary table a query job wrote its result to */
export interface TableRef {
    projectId: string;
    datasetId: string;
    tableId: string;
}

/** A column of the results table, as `processQueryResults` names it */
export interface ResultColumn {
    title: string;
    field: string;
    /** Whether a result too large for the view to hold can be sorted and filtered by it */
    sortable?: boolean;
    [key: string]: unknown;
}

/** Rows `startIndex` to `startIndex + maxResults` of a job's result, as the results table shows them */
export type RowReader = (startIndex: number, maxResults: number) => Promise<any[]>;

/** The sorted, filtered result and what BigQuery billed to make it */
export interface ResultView {
    result: QueryResult;
    /** Bytes billed, formatted, when there were any */
    billed?: string;
}

export type ViewOpener = (sorting: ResultSort[], filters: ResultFilter[]) => Promise<ResultView>;

/** Types BigQuery cannot ORDER BY */
const NOT_ORDERABLE = new Set(['RECORD', 'STRUCT', 'JSON', 'GEOGRAPHY']);

const quoted = (name: string) => `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
const orderable = (field: SchemaField) => !!field.name && field.mode !== 'REPEATED' && !NOT_ORDERABLE.has(field.type ?? '');

/**
 * The SQL expression of each column of the results table that can be sorted and filtered. The fields of a
 * STRUCT are columns named `struct_x_field`, as `processQueryResults` names them. Arrays and what is nested
 * deeper are left out.
 */
export function columnExprs(fields: SchemaField[] | undefined): Record<string, string> {
    const exprs: Record<string, string> = {};
    for (const field of fields ?? []) {
        if (orderable(field)) {
            exprs[field.name!] = quoted(field.name!);
        } else if (field.name && field.mode !== 'REPEATED' && (field.type === 'RECORD' || field.type === 'STRUCT')) {
            for (const sub of field.fields ?? []) {
                if (orderable(sub)) {
                    exprs[`${field.name}_x_${sub.name}`] = `${quoted(field.name)}.${quoted(sub.name!)}`;
                }
            }
        }
    }
    return exprs;
}

/**
 * The query that sorts and filters a result, over the temporary table that holds it. A filter keeps the rows
 * whose value has the text in it, whatever the case. The text goes as a query parameter, never in the SQL.
 * Nothing is returned when no sort or filter is of a column in `exprs`: the result is then read as it is.
 */
export function viewQuery(table: TableRef, sorting: ResultSort[], filters: ResultFilter[], exprs: Record<string, string>): { query: string, params: Record<string, string> } | undefined {
    const params: Record<string, string> = {};
    const where = filters
        .filter(filter => exprs[filter.id] && filter.value !== '')
        .map((filter, i) => {
            params[`f${i}`] = filter.value;
            return `STRPOS(LOWER(SAFE_CAST(${exprs[filter.id]} AS STRING)), LOWER(@f${i})) > 0`;
        });
    const orderBy = sorting
        .filter(sort => exprs[sort.id])
        .map(sort => `${exprs[sort.id]} ${sort.desc ? 'DESC' : 'ASC'}`);
    if (where.length === 0 && orderBy.length === 0) {
        return undefined;
    }
    const query = `SELECT * FROM ${quoted(`${table.projectId}.${table.datasetId}.${table.tableId}`)}`
        + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
        + (orderBy.length ? ` ORDER BY ${orderBy.join(', ')}` : '');
    return { query, params };
}

export class QueryResult {
    /** The parts of the result read so far, or being read, by the index of the part */
    private chunks = new Map<number, Promise<any[]>>();

    constructor(
        readonly totalRows: number,
        readonly columns: ResultColumn[],
        private readonly read: RowReader,
        firstRows?: any[],
        /** Sorts and filters this result. Missing when BigQuery kept no table for it. */
        readonly openView?: ViewOpener,
    ) {
        if (firstRows) {
            this.chunks.set(0, Promise.resolve(firstRows));
        }
    }

    /** Whether the view can hold all of it, and so sort and filter it by itself */
    get fitsInView(): boolean {
        return this.totalRows <= RESULT_CHUNK_ROWS;
    }

    private chunk(index: number): Promise<any[]> {
        let chunk = this.chunks.get(index);
        if (!chunk) {
            chunk = this.read(index * RESULT_CHUNK_ROWS, RESULT_CHUNK_ROWS);
            this.chunks.set(index, chunk);
            // A part that could not be read is asked for again the next time
            chunk.catch(() => this.chunks.delete(index));
        }
        return chunk;
    }

    /** Rows `start` up to `end`, which is cut at the end of the result */
    private async range(start: number, end: number): Promise<any[]> {
        end = Math.min(end, this.totalRows);
        const rows: any[] = [];
        for (let index = Math.floor(start / RESULT_CHUNK_ROWS); index * RESULT_CHUNK_ROWS < end; index++) {
            const chunk = await this.chunk(index);
            const offset = index * RESULT_CHUNK_ROWS;
            rows.push(...chunk.slice(Math.max(0, start - offset), end - offset));
        }
        return rows;
    }

    page(pageIndex: number, pageSize: number): Promise<any[]> {
        return this.range(pageIndex * pageSize, (pageIndex + 1) * pageSize);
    }

    /** The first `max` rows, read a part at a time. `onProgress` is told the rows read so far and whether to stop is asked of it. */
    async rows(max: number, onProgress?: (read: number, of: number) => boolean | void): Promise<any[]> {
        const end = Math.min(max, this.totalRows);
        const rows: any[] = [];
        for (let start = 0; start < end; start += RESULT_CHUNK_ROWS) {
            rows.push(...await this.range(start, Math.min(start + RESULT_CHUNK_ROWS, end)));
            if (onProgress?.(rows.length, end) === false) {
                break;
            }
        }
        return rows;
    }
}
