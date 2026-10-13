import type { Target } from '../shared/compiledGraph';
import { quoted } from './queryResult';

/*
 * How a declared table is previewed. It has no SQL of its own, so the preview reads the table itself. No `vscode`
 * or BigQuery client import.
 */

/**
 * `rows` reads the first rows of the table without a query job, which BigQuery does not bill. Only a base table
 * can be read so: a view, a materialized view or an external table needs a query. `tableType` is the `type` of
 * the table's metadata.
 */
export function previewMethod(tableType: string | undefined): 'rows' | 'query' {
    return tableType === 'TABLE' ? 'rows' : 'query';
}

export function tableName(target: Target): string {
    return [target.database, target.schema, target.name].filter(Boolean).join('.');
}

/** The query that previews a table that cannot be read without one */
export function declarationPreviewSql(target: Target, limit: number): string {
    return `SELECT * FROM ${quoted(tableName(target))} LIMIT ${limit}`;
}
