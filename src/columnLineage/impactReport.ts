import * as vscode from 'vscode';
import { GraphAction, indexGraph, targetFqn } from '../shared/columnLineage/graphLinks';
import { ColumnLink, ImpactEntry } from '../shared/columnLineage/types';
import { tableActions } from '../shared/columnLineage/tableActions';
import { DataplexTraceSource } from './dataplexSource';
import { ColumnImpact, SchemaField, diffSchemas } from './impactRules';
import { indexByProdTarget } from './prodIndex';
import { SchemaCache } from './schemaCache';

/*
 * The column impact check, run on demand: compares the schema of the file's last dry run with its Prod
 * Target's, and asks Dataplex which columns still read each dropped or retyped one.
 */

interface DryRunRecord {
    uri: string;
    curFileMeta: any;
    fields: SchemaField[];
}

let lastDryRun: DryRunRecord | undefined;

/** Keeps the schema a dry run returned, so the check doesn't need another dry run */
export function recordDryRunSchema(document: vscode.TextDocument, curFileMeta: any, schema: { fields?: SchemaField[] } | undefined) {
    const fields = (schema?.fields ?? []).filter((field) => field.name);
    lastDryRun = fields.length ? { uri: document.uri.toString(), curFileMeta, fields } : undefined;
}

export function forgetDryRunSchema(document: vscode.TextDocument) {
    if (lastDryRun?.uri === document.uri.toString()) {
        lastDryRun = undefined;
    }
}

export interface ImpactAnalysis {
    /** Prod Target compared with */
    table: string;
    results: { impact: ColumnImpact; links: ColumnLink[] }[];
    /** Set when there is nothing to compare, e.g. no prod table yet */
    note?: string;
    schemas: SchemaCache;
    index: Map<string, GraphAction>;
}

export function toImpactEntries(analysis: ImpactAnalysis): ImpactEntry[] {
    return analysis.results
        .map(({ impact, links }) => ({
            column: impact.column,
            change: impact.change,
            copies: links.filter((link) => link.dependencyType === 'EXACT_COPY').length,
            derived: links.filter((link) => link.dependencyType === 'OTHER').length,
            mayRead: links.filter((link) => link.dependencyType === 'TABLE_ONLY').length,
        }))
        .sort((a, b) => (b.copies + b.derived + b.mayRead) - (a.copies + a.derived + a.mayRead) || a.column.localeCompare(b.column));
}

/** Throws with a message for the panel when the file can't be checked */
export async function analyzeColumnImpact(document: vscode.TextDocument): Promise<ImpactAnalysis> {
    const record = lastDryRun;
    if (!record || record.uri !== document.uri.toString()) {
        throw new Error('No dry run for this file yet. Save it or refresh the compiled query panel, then check again.');
    }
    const tables = tableActions<{ type?: string; target: { database: string; schema: string; name: string } }>(record.curFileMeta?.fileMetadata?.tables);
    const action = tables[0];
    if (tables.length !== 1) {
        throw new Error('Column impact works for .sqlx files that define one table, view or incremental table.');
    }
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        throw new Error('Compile the project first.');
    }

    const { index, toProd } = await indexByProdTarget(indexGraph(CACHED_COMPILED_DATAFORM_JSON));
    const table = toProd(targetFqn(action.target));
    const schemas = new SchemaCache();
    const prodFields = await schemas.schema(table);
    if (!prodFields?.length) {
        return { table, results: [], note: `There is no prod table ${table} to compare with yet.`, schemas, index };
    }

    const impacts = diffSchemas(record.fields, prodFields);
    const source = new DataplexTraceSource(schemas, index);
    const results = await Promise.all(impacts.map(async (impact) => ({ impact, links: await source.links(table, impact.column, 'downstream') })));
    return {
        table,
        results,
        note: impacts.length ? undefined : 'No columns were dropped or changed type against prod.',
        schemas,
        index,
    };
}
