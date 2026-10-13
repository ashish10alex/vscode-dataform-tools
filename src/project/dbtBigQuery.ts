import * as vscode from 'vscode';
import { checkAuthentication, getBigQueryClient, getBigQueryClientFor, getJobSettings } from '../bigqueryClient';
import { queryDryRun } from '../bigqueryDryRun';
import { formatTimestamp } from '../utils';
import { DryRunResult, RunDryRun, dryRunActions } from '../bigquery/dryRunService';
import { jobPlace } from '../bigquery/jobPlace';
import { previewQuery } from '../bigquery/preview';
import { Action, ActionId, CompiledGraph, Target, buildsTable, dryRunScripts, targetId } from '../shared/compiledGraph';
import type { TableState } from '../shared/panelContract';

/*
 * BigQuery for the actions of a dbt Project (xf#53): the dry run of each compiled query, the preview of one, and
 * whether an incremental model's table exists. A job runs in its action's own project unless the `gcpProjectId`
 * setting names another (see `jobPlace`). Every call asks BigQuery again: no dry run is answered from an earlier
 * one. What the dry runs of a Project's latest compile said is kept until its next compile, only for the editor to
 * read: the error markers, and the columns a file's own query gives.
 */

interface ProjectDryRuns {
    compile: number;
    results: DryRunResult[];
}

const dryRuns = new Map<string, ProjectDryRuns>();
const dryRan = new vscode.EventEmitter<string>();
/** Fires with a Project's root when dry runs of its actions have ended */
export const onDidDryRunDbt = dryRan.event;

/** What the dry runs of the Project's compile `compile` have said so far. Empty for any other compile */
export function dbtDryRunResults(root: string, compile: number): DryRunResult[] {
    const kept = dryRuns.get(root);
    return kept?.compile === compile ? kept.results : [];
}

/**
 * Whether BigQuery can be asked at all: there are credentials and a client was made with them. Without them every
 * dry run fails alike, which says nothing of the SQL: such a failure is the panel's to show, and no file is marked
 * for it, nor is a save dry-run while the panel is closed.
 */
export async function dbtCanAskBigQuery(): Promise<boolean> {
    if (runDryRun) {
        return true;
    }
    await checkAuthentication();
    return getBigQueryClient() !== undefined;
}

/** As `dbtCanAskBigQuery`, from what is known now, without trying to sign in */
export function dbtAskedBigQuery(): boolean {
    return runDryRun !== undefined || getBigQueryClient() !== undefined;
}

let runDryRun: RunDryRun | undefined;
/** Replaces what asks BigQuery for a dry run, for tests. Undefined puts the real one back */
export function setDbtDryRun(run: RunDryRun | undefined) {
    runDryRun = run;
    dryRuns.clear();
}

/** The actions among `ids` that have something to dry-run: a query this compile compiled */
export function dbtActionsToDryRun(graph: CompiledGraph, ids: ActionId[]): Action[] {
    return ids.map((id) => graph.actions[id]).filter((action): action is Action => action !== undefined && action.sqlPresent && dryRunScripts(action).length > 0);
}

/**
 * Dry-runs the actions at once. `onResult` is told of each action's results as they arrive; the promise gives them
 * all. A dry run that fails is a result with an error.
 */
export async function dryRunDbtActions(root: string, actions: Action[], compile: number, onResult?: (results: DryRunResult[]) => void): Promise<DryRunResult[]> {
    const settings = getJobSettings();
    const results = await dryRunActions(actions, compile, runDryRun ?? ((sql, action) => queryDryRun(sql, false, jobPlace('dbt', action.target, settings))), onResult);
    let kept = dryRuns.get(root);
    // Results of an earlier compile than the one kept are of SQL that is gone
    if (kept && kept.compile > compile) {
        return results;
    }
    if (!kept || kept.compile !== compile) {
        kept = { compile, results: [] };
        dryRuns.set(root, kept);
    }
    const again = new Set(actions.map((action) => action.id));
    kept.results = [...kept.results.filter((result) => !again.has(result.action)), ...results];
    dryRan.fire(root);
    return results;
}

/**
 * What BigQuery knows of the table of each action that builds one: when it was last changed, or that there is no
 * such table. The panel shows the time on the action's card, as it does for Dataform, and tells by it which case of
 * an incremental model dbt compiled. An action BigQuery could not be asked about is left out.
 */
export async function tablesOfActions(actions: Action[]): Promise<Record<ActionId, TableState>> {
    const tables: Record<ActionId, TableState> = {};
    const settings = getJobSettings();
    await Promise.all(actions.filter(buildsTable).map(async (action) => {
        const { database, schema, name } = action.target;
        try {
            const client = await getBigQueryClientFor(jobPlace('dbt', action.target, settings));
            if (!client) {
                return;
            }
            const [table] = await client.dataset(schema, { projectId: database }).table(name).get();
            const modified = Number(table?.metadata?.lastModifiedTime);
            if (Number.isFinite(modified)) {
                const at = new Date(modified);
                tables[action.id] = { lastModified: formatTimestamp(at), modifiedToday: at.toDateString() === new Date().toDateString() };
            } else {
                tables[action.id] = {};
            }
        } catch (error) {
            tables[action.id] = (error as { code?: number })?.code === 404 ? { missing: true } : { error: `Could not read ${database}.${schema}.${name}: ${error instanceof Error ? error.message : String(error)}` };
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
