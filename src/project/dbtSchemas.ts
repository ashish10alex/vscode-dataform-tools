import * as vscode from 'vscode';
import { getBigQueryClientFor, getJobSettings } from '../bigqueryClient';
import { jobPlace } from '../bigquery/jobPlace';
import { Action, ActionId, buildsTable } from '../shared/compiledGraph';
import type { ColumnMetadata } from '../types';
import { dbtCompileState, onDidChangeDbtCompile } from './dbtCompile';

/*
 * The schemas of the tables a dbt Project's files read, held for the editor features (piece 7.8 of the build plan).
 * A table is asked of BigQuery when a hover or a completion first needs it, and the answer is held in memory, by
 * Project, until that Project's next parse or compile starts; then all are dropped. So hover and completions read one
 * copy and agree, and a save asks again. This is the one exception to "no caching of table schemas": nothing is
 * written to disk, and nothing outlives a compile.
 */

/** What BigQuery said of an Action's table */
export type HeldTable =
    | {
        state: 'found';
        fields: ColumnMetadata[];
        description?: string;
        /** The column the table is partitioned by, with how */
        partition?: string;
        rows?: number;
        /** Milliseconds since the epoch */
        lastModified?: number;
    }
    /** BigQuery has no table of the name: the Action is not built yet */
    | { state: 'missing' }
    /** BigQuery could not be asked. Not held: the next need asks again */
    | { state: 'unknown'; error: string };

export type FetchTable = (action: Action) => Promise<HeldTable>;

function partitionOf(metadata: any): string | undefined {
    const time = metadata?.timePartitioning;
    if (time) {
        return `${time.field ?? '_PARTITIONTIME'} (${String(time.type ?? 'DAY').toLowerCase()})`;
    }
    const range = metadata?.rangePartitioning;
    return range?.field ? `${range.field} (range)` : undefined;
}

/** Asks BigQuery for the table, in the project its Action's jobs run in (see `jobPlace`) */
const fetchFromBigQuery: FetchTable = async (action) => {
    const { database, schema, name } = action.target;
    try {
        const client = await getBigQueryClientFor(jobPlace('dbt', action.target, getJobSettings()));
        if (!client) {
            return { state: 'unknown', error: 'No BigQuery client: check the credentials' };
        }
        const [metadata] = await client.dataset(schema, { projectId: database }).table(name).getMetadata();
        const rows = Number(metadata?.numRows);
        const lastModified = Number(metadata?.lastModifiedTime);
        const partition = partitionOf(metadata);
        return {
            state: 'found',
            fields: metadata?.schema?.fields ?? [],
            ...(metadata?.description ? { description: metadata.description } : {}),
            ...(partition ? { partition } : {}),
            ...(Number.isFinite(rows) ? { rows } : {}),
            ...(Number.isFinite(lastModified) ? { lastModified } : {}),
        };
    } catch (error) {
        if ((error as { code?: number })?.code === 404) {
            return { state: 'missing' };
        }
        return { state: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
};

let fetchTable: FetchTable = fetchFromBigQuery;
const held = new Map<string, Map<ActionId, Promise<HeldTable>>>();

/**
 * The table of `action`, of the Project at `root`: as held, else asked of BigQuery now and held. Undefined for an
 * Action that builds no table, such as an ephemeral model. Never rejects.
 */
export function heldTable(root: string, action: Action): Promise<HeldTable> | undefined {
    if (!buildsTable(action)) {
        return undefined;
    }
    let ofProject = held.get(root);
    if (!ofProject) {
        ofProject = new Map();
        held.set(root, ofProject);
    }
    const tables = ofProject;
    let table = tables.get(action.id);
    if (!table) {
        table = fetchTable(action).catch((error): HeldTable => ({ state: 'unknown', error: error instanceof Error ? error.message : String(error) }));
        tables.set(action.id, table);
        // What could not be asked is asked again at the next need, unless a compile dropped everything meanwhile
        void table.then((answer) => {
            if (answer.state === 'unknown' && tables.get(action.id) === table) {
                tables.delete(action.id);
            }
        });
    }
    return table;
}

/** How many tables of the Project are held, for tests */
export function heldTableCount(root: string): number {
    return held.get(root)?.size ?? 0;
}

/** Replaces what asks BigQuery, for tests. Undefined puts the real one back. Everything held is dropped */
export function setTableFetch(fetch: FetchTable | undefined) {
    fetchTable = fetch ?? fetchFromBigQuery;
    held.clear();
}

export function initDbtSchemas(context: vscode.ExtensionContext) {
    context.subscriptions.push(onDidChangeDbtCompile((root) => {
        // The start of a parse or a compile: what the Project builds may be about to change
        if (dbtCompileState(root).compiling) {
            held.delete(root);
        }
    }));
}
