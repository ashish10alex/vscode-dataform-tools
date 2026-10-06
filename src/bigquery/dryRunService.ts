import { Action, ActionId, DryRunScript, dryRunScripts, positionInSection } from '../shared/compiledGraph';
import type { BigQueryDryRunResponse, CompiledQuerySchema } from '../types';

/*
 * Dry runs for the actions of a Compiled Graph, whichever Backend compiled them. It works only from the SQL sections
 * an action carries and the scripts they name (see `dryRunScripts`); it knows nothing of Dataform, dbt or defer, and
 * it keeps no result: every call asks BigQuery again.
 */

/**
 * Asks BigQuery to dry-run one script of `action`. The host makes it from the extension's `queryDryRun`, which goes
 * through the shared pool, and from `jobPlace`, which says where the action's jobs run.
 */
export type RunDryRun = (sql: string, action: Action) => Promise<BigQueryDryRunResponse>;

/** What BigQuery said about one dry-run script of an action */
export interface DryRunResult {
    action: ActionId;
    /** Which of the action's scripts this is, see `DryRunScript` */
    script: string;
    incremental: boolean;
    /** The sections the script was made of, by title, in order */
    sections: string[];
    /** The compile whose SQL was dry-run, so a result that arrives after a later compile can be dropped */
    compile: number;
    /** The script as it was sent */
    sql: string;
    /** What the script would scan. Unset when it failed */
    bytes?: number;
    /** BigQuery could not tell what the script would scan, and reported 0 bytes: not an estimate */
    bytesUnknown?: boolean;
    cost?: { currency: string; value: number };
    /** The columns the script's last statement gives. Unset when it gives none, or failed */
    schema?: CompiledQuerySchema;
    /** Where BigQuery would run the job */
    location?: string;
    statementType?: string;
    error?: {
        message: string;
        /** Where in a section's own SQL BigQuery places the error. Unset when it gave no place, or one outside the script */
        section?: string;
        line?: number;
        column?: number;
    };
}

function toResult(action: Action, script: DryRunScript, compile: number, response: BigQueryDryRunResponse): DryRunResult {
    const result: DryRunResult = {
        action: action.id,
        script: script.name,
        incremental: script.incremental,
        sections: script.parts.map((part) => part.source),
        compile,
        sql: script.sql,
    };
    if (response.error?.hasError) {
        const { message, location } = response.error;
        // No place in the message is reported as line 0
        const position = location && location.line > 0 ? positionInSection(action, script, location.line, location.column) : undefined;
        result.error = { message, ...position };
        return result;
    }
    const statistics = response.statistics;
    result.bytes = statistics?.totalBytesProcessed ?? 0;
    if (statistics?.bytesEstimateUnknown) {
        result.bytesUnknown = true;
    }
    if (statistics?.cost) {
        result.cost = statistics.cost;
    }
    if (response.schema) {
        result.schema = response.schema;
    }
    if (response.location) {
        result.location = response.location;
    }
    if (statistics?.statementType) {
        result.statementType = statistics.statementType;
    }
    return result;
}

/**
 * Dry-runs every script of the action at once and gives one result for each, in the order of `dryRunScripts`. An
 * action with nothing to dry-run gives none, and BigQuery is not asked. A dry run that throws is a result with an
 * error, so that one failure does not lose the others.
 */
export async function dryRunAction(action: Action, compile: number, run: RunDryRun): Promise<DryRunResult[]> {
    return Promise.all(dryRunScripts(action).map(async (script) => {
        let response: BigQueryDryRunResponse;
        try {
            response = await run(script.sql, action);
        } catch (error) {
            response = { error: { hasError: true, message: error instanceof Error ? error.message : String(error) } };
        }
        return toResult(action, script, compile, response);
    }));
}

/**
 * Dry-runs several actions at once, e.g. a model and the tests shown with it. `onResult` is told of each action's
 * results as they arrive; the promise gives them all, in the order of `actions`.
 */
export async function dryRunActions(actions: Action[], compile: number, run: RunDryRun, onResult?: (results: DryRunResult[]) => void): Promise<DryRunResult[]> {
    const all = await Promise.all(actions.map(async (action) => {
        const results = await dryRunAction(action, compile, run);
        if (results.length > 0) {
            onResult?.(results);
        }
        return results;
    }));
    return all.flat();
}
