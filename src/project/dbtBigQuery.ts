import * as vscode from 'vscode';
import { getBigQueryClientFor, getJobSettings } from '../bigqueryClient';
import { queryDryRun } from '../bigqueryDryRun';
import { DryRunResult, dryRunActions } from '../bigquery/dryRunService';
import { jobPlace } from '../bigquery/jobPlace';
import { previewQuery } from '../bigquery/preview';
import { Action, ActionId, CompiledGraph, Target, dryRunScripts, targetId } from '../shared/compiledGraph';
import type { TableState } from '../shared/panelContract';

/*
 * BigQuery for the actions of a dbt Project (xf#53): the dry run of each compiled query, the preview of one, and
 * whether an incremental model's table exists. A job runs in its action's own project unless the `gcpProjectId`
 * setting names another (see `jobPlace`). Nothing is cached: every call asks BigQuery again.
 */

/** The actions among `ids` that have something to dry-run: a query this compile compiled */
export function dbtActionsToDryRun(graph: CompiledGraph, ids: ActionId[]): Action[] {
    return ids.map((id) => graph.actions[id]).filter((action): action is Action => action !== undefined && action.sqlPresent && dryRunScripts(action).length > 0);
}

/**
 * Dry-runs the actions at once. `onResult` is told of each action's results as they arrive; the promise gives them
 * all. A dry run that fails is a result with an error.
 */
export function dryRunDbtActions(actions: Action[], compile: number, onResult?: (results: DryRunResult[]) => void): Promise<DryRunResult[]> {
    const settings = getJobSettings();
    return dryRunActions(actions, compile, (sql, action) => queryDryRun(sql, false, jobPlace('dbt', action.target, settings)), onResult);
}

/**
 * Whether the table of each incremental model exists: dbt compiles the incremental case of such a model only when
 * it does. An action BigQuery could not be asked about is left out.
 */
export async function incrementalTables(actions: Action[]): Promise<Record<ActionId, TableState>> {
    const tables: Record<ActionId, TableState> = {};
    const settings = getJobSettings();
    await Promise.all(actions.filter((action) => action.kind === 'incremental').map(async (action) => {
        const { database, schema, name } = action.target;
        try {
            const client = await getBigQueryClientFor(jobPlace('dbt', action.target, settings));
            if (!client) {
                return;
            }
            const [table] = await client.dataset(schema, { projectId: database }).table(name).get();
            const modified = Number(table?.metadata?.lastModifiedTime);
            tables[action.id] = Number.isFinite(modified) ? { lastModified: new Date(modified).toLocaleString() } : {};
        } catch (error) {
            if ((error as { code?: number })?.code === 404) {
                tables[action.id] = { missing: true };
            }
        }
    }));
    return tables;
}

/**
 * Runs the compiled query of an action's section and shows its rows in the results view, as a preview does for
 * Dataform: what the code would produce, not what was last built. A test's rows are its failures.
 */
export async function previewDbtAction(graph: CompiledGraph | undefined, target: Target, section: string) {
    const action = graph?.actions[targetId(target)];
    const query = action && previewQuery(action, section)?.sql;
    if (!action || !query) {
        vscode.window.showWarningMessage('No compiled query to run');
        return;
    }
    await vscode.commands.executeCommand('vscode-dataform-tools.runGeneratedQuery', query, 'table', jobPlace('dbt', action.target, getJobSettings()));
}
