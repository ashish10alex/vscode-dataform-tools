import * as vscode from 'vscode';
import { compiledJson } from '../project';
import path from 'path';
import { getWorkspaceFolder } from '../utils';
import { GraphAction, indexGraph } from '../shared/columnLineage/graphLinks';
import { isOperation, tableActions } from '../shared/columnLineage/tableActions';
import { SchemaField, diffSchemas } from '../shared/columnLineage/impactRules';
import { ColumnsInput } from '../shared/columnLineage/columnsController';
import { resolveProdIndex } from './prodIndex';
import { SchemaCache } from './schemaCache';

/*
 * Where the column list gets its columns: the schema of the file's Prod Target, and the schema its last dry run
 * returned, kept here so labelling changes against prod doesn't need another dry run.
 */

export interface DryRunSchemaEvent {
    document: vscode.TextDocument;
    /** Workspace-relative path, as the compiled query panel shows it */
    relativeFilePath?: string;
    /** Undefined when the last dry run failed or returned no schema, so labels from an earlier one are dropped */
    fields?: SchemaField[];
}

const dryRuns = new Map<string, SchemaField[]>();
const recorded = new vscode.EventEmitter<DryRunSchemaEvent>();
/** Fires after each dry run of a file: with its schema when it defines one table, view or incremental table and the dry run passed */
export const onDidRecordDryRunSchema = recorded.event;

export function recordDryRunSchema(document: vscode.TextDocument, curFileMeta: any, schema: { fields?: SchemaField[] } | undefined) {
    const fields = (schema?.fields ?? []).filter((field) => field.name);
    if (!fields.length) {
        forgetDryRunSchema(document, curFileMeta);
        return;
    }
    dryRuns.set(document.uri.toString(), fields);
    recorded.fire({ document, relativeFilePath: curFileMeta?.pathMeta?.relativeFilePath, fields });
}

export function forgetDryRunSchema(document: vscode.TextDocument, curFileMeta: any) {
    dryRuns.delete(document.uri.toString());
    recorded.fire({ document, relativeFilePath: curFileMeta?.pathMeta?.relativeFilePath });
}

/** The Prod Target of the one table the file defines. Throws with a message for the panel otherwise. */
async function locate(document: vscode.TextDocument): Promise<{ table: string; index: Map<string, GraphAction>; toProd: (table: string) => string; operation: boolean }> {
    const compiled = compiledJson();
    if (!compiled) {
        throw new Error('Compile the project first.');
    }
    const workspaceFolder = await getWorkspaceFolder();
    const fileName = workspaceFolder && path.relative(workspaceFolder, document.uri.fsPath).split(path.sep).join('/');
    const devIndex = indexGraph(compiled);
    const actions = tableActions([...devIndex.values()].filter((action) => action.fileName === fileName));
    if (actions.length !== 1) {
        throw new Error('Column lineage works for files that define one table, view, incremental table or operation with hasOutput.');
    }
    let prodIndex: Awaited<ReturnType<typeof resolveProdIndex>>;
    try {
        prodIndex = await resolveProdIndex(devIndex);
    } catch (error: any) {
        // Comparing with the dev table instead would pass it off as prod
        throw new Error(`The prod table to compare with is unknown: ${error?.message ?? error}`);
    }
    const { index, toProd, prodTarget } = prodIndex;
    const table = prodTarget(actions[0].fqn);
    if (!table) {
        throw new Error(`The prod table of ${actions[0].fqn} is unknown: nothing in the compile with prodCompilerOptions matches it.`);
    }
    return { table, index, toProd, operation: isOperation(actions[0]) };
}

export interface LoadedColumns {
    input: ColumnsInput;
    schemas: SchemaCache;
    /** Actions keyed by Prod Target */
    index: Map<string, GraphAction>;
    /** The Prod Target of a dev run of one of them */
    toProd: (table: string) => string;
}

/** The columns to list for a file: its Prod Target's, labelled against its last dry run when there is one */
export async function loadColumns(document: vscode.TextDocument): Promise<LoadedColumns> {
    const { table, index, toProd, operation } = await locate(document);
    const schemas = new SchemaCache();
    const prod = await schemas.schema(table);
    if (operation) {
        // BigQuery's dry run of a script has no schema, so there is nothing to compare prod with
        if (!prod?.length) {
            throw new Error(`There is no prod table ${table} yet. Its columns get lineage once the operation is deployed and has run.`);
        }
        return { input: { table, prod, message: 'Operations aren’t compared with prod: a dry run of a script has no schema.' }, schemas, index, toProd };
    }
    const dev = dryRuns.get(document.uri.toString());
    if (prod?.length) {
        return { input: { table, prod, dev }, schemas, index, toProd };
    }
    if (!dev) {
        throw new Error(`There is no prod table ${table} yet, and no dry run of this file to list columns from. Save the file or refresh the compiled query panel.`);
    }
    return {
        input: { table, dev, message: `There is no prod table ${table} yet. Its columns get lineage once it is deployed and has run.` },
        schemas,
        index,
        toProd,
    };
}

/** Prod schemas for the "N changed" hint, re-read every few minutes so a hint doesn't cost a call per dry run */
const HINT_SCHEMA_TTL_MS = 10 * 60 * 1000;
let hintSchemas = new SchemaCache();
let hintSchemasAt = Date.now();

/** How many columns a dry run drops or retypes against prod; undefined when there is no prod table to compare */
export async function changedColumnCount(document: vscode.TextDocument, fields: SchemaField[]): Promise<number | undefined> {
    if (Date.now() - hintSchemasAt > HINT_SCHEMA_TTL_MS) {
        hintSchemas = new SchemaCache();
        hintSchemasAt = Date.now();
    }
    const { table } = await locate(document);
    const prod = await hintSchemas.schema(table);
    return prod?.length ? diffSchemas(fields, prod).length : undefined;
}
