import * as vscode from 'vscode';
import { getBigQueryClientFor, getJobSettings } from '../bigqueryClient';
import { jobPlace } from '../bigquery/jobPlace';
import { Action, Target, buildsTable, targetId } from '../shared/compiledGraph';
import { dbtCompileState, onDidChangeDbtCompile } from './dbtCompile';
import { HeldTable, tableOfError, tableOfMetadata } from './heldTable';

/*
 * The schemas of the tables a dbt Project's files read, held for the editor features (piece 7.8 of the build plan).
 * A table is asked of BigQuery when a hover or a completion first needs it, and the answer is held in memory, by
 * Project, until that Project's next parse or compile starts; then all are dropped. So hover and completions read one
 * copy and agree, and a save asks again. This is the one exception to "no caching of table schemas": nothing is
 * written to disk, and nothing outlives a compile.
 */

export type { HeldTable } from './heldTable';

/** Asks for the table of an Action, or of a plain table id in a file */
export type FetchTable = (table: { target: Target }) => Promise<HeldTable>;

/** Asks BigQuery for the table, in the project the jobs that read it run in (see `jobPlace`) */
const fetchFromBigQuery: FetchTable = async ({ target }) => {
    const { database, schema, name } = target;
    try {
        const client = await getBigQueryClientFor(jobPlace('dbt', target, getJobSettings()));
        if (!client) {
            return { state: 'unknown', error: 'No BigQuery client: check the credentials' };
        }
        const [metadata] = await client.dataset(schema, { projectId: database }).table(name).getMetadata();
        return tableOfMetadata(metadata);
    } catch (error) {
        return tableOfError(error);
    }
};

let fetchTable: FetchTable = fetchFromBigQuery;
const held = new Map<string, Map<string, Promise<HeldTable>>>();

function hold(root: string, key: string, table: { target: Target }): Promise<HeldTable> {
    let ofProject = held.get(root);
    if (!ofProject) {
        ofProject = new Map();
        held.set(root, ofProject);
    }
    const tables = ofProject;
    let answer = tables.get(key);
    if (!answer) {
        answer = fetchTable(table).catch(tableOfError);
        tables.set(key, answer);
        // What could not be asked is asked again at the next need, unless a compile dropped everything meanwhile
        void answer.then((said) => {
            if (said.state === 'unknown' && tables.get(key) === answer) {
                tables.delete(key);
            }
        });
    }
    return answer;
}

/**
 * The table of `action`, of the Project at `root`: as held, else asked of BigQuery now and held. Undefined for an
 * Action that builds no table, such as an ephemeral model. Never rejects.
 */
export function heldTable(root: string, action: Action): Promise<HeldTable> | undefined {
    return buildsTable(action) ? hold(root, action.id, action) : undefined;
}

/** The table a plain `project.dataset.table` id names in a file of the Project at `root`: held as an Action's is */
export function heldTableOfId(root: string, target: Target): Promise<HeldTable> {
    return hold(root, targetId(target), { target });
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
