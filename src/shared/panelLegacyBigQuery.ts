import type { DryRunResult } from '../bigquery/dryRunService';
import { applyColumnDescriptions } from '../utils/schemaTree';
import { joinScript } from './compiledGraph';
import type { BigQuerySlice, FileSlice, PanelAction } from './panelContract';
import { LegacyModel, legacyModels } from './panelLegacyFile';

/*
 * The `bigquery` slice as the flat fields the panel's components still read (see panelLegacyState.ts). It goes with
 * the rest of the adapter.
 */

/** The flat fields that arrive only through the `bigquery` slice */
export const MIGRATED_BIGQUERY_FIELDS = [
    'dryRunning', 'currencySymbol', 'modelsLastUpdateTimesMeta', 'compiledQuerySchema',
    'dryRunStatByNodeName', 'dryRunErrorsByNodeName', 'dryRunIncrementalErrorsByNodeName', 'dryRunExpectedOutputErrorsByNodeName',
    'dryRunQueryByNodeName', 'dryRunIncrementalQueryByNodeName', 'dryRunNonIncrementalQueryByNodeName',
    'dryRunStatByNodeType', 'dryRunErrorsByNodeType', 'dryRunIncrementalErrorsByNodeType', 'dryRunExpectedOutputErrorsByNodeType',
] as const;

type Shown = { model: LegacyModel; action: PanelAction };

/** An error of a dry run as the flat state has it: placed in the script that was sent, which the panel shows */
interface Annotation {
    message: string;
    location?: { line: number; column: number };
}

/** An error BigQuery gave no place for is at line 0, as the flat state has always had it */
const NO_PLACE = { line: 0, column: 0 };

/** The script of each type of action that gives its cost, its schema and the SQL shown for it */
const mainScript = (model: LegacyModel) => (model.type === 'operations' ? 'operation' : 'query');

const UNKNOWN_BYTES = '⚠ Bytes unknown';

function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const unit = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, unit)).toFixed(2)} ${units[unit]}`;
}

/**
 * What a dry run would cost, as text: "Incremental: Up to 1.20 GiB $0.006", or a warning in place of the figures
 * when BigQuery could not tell the bytes. Empty when there is nothing to show: no result, an error, or no cost.
 */
export function dryRunCostSummary(result: DryRunResult | undefined, label: string, currencySymbol: string): string {
    if (!result?.cost || result.error) {
        return '';
    }
    const prefix = label ? `${label}: ` : '';
    // 0 bytes that are not an estimate would read as "this query is free"
    if (result.bytesUnknown) {
        return prefix + UNKNOWN_BYTES;
    }
    if (result.statementType === 'SCRIPT' && result.bytesAccuracy !== 'PRECISE' && result.bytesAccuracy !== 'UPPER_BOUND') {
        return `${prefix}NOTE: Could not compute bytes processed estimate for script.`;
    }
    const bound = result.bytesAccuracy === 'UPPER_BOUND' ? 'Up to ' : result.bytesAccuracy === 'LOWER_BOUND' ? 'At least ' : '';
    return `${prefix}${bound}${formatBytes(result.bytes ?? 0)} ${currencySymbol}${result.cost.value.toFixed(3)}`;
}

/**
 * Where an error is in the script that was dry-run. A result places it in a section's own SQL; the flat state shows
 * the whole script and marks the line there, so the script is joined again from the action's sections and the place
 * found in it. Undefined when the result gives no place, or the sections on show are not those that were sent.
 */
function placeInScript(action: PanelAction, result: DryRunResult): Annotation['location'] | undefined {
    const error = result.error;
    if (!error?.section || !error.line || !error.column) {
        return undefined;
    }
    const members = result.sections.map((title) => action.sections.find((section) => section.title === title));
    if (members.some((section) => section === undefined)) {
        return undefined;
    }
    const { sql, parts } = joinScript(members.map((section) => section!.sql));
    const part = parts.find((candidate) => candidate.source === result.sections.indexOf(error.section!));
    if (sql !== result.sql || !part) {
        return undefined;
    }
    const sectionLines = members[part.source]!.sql.split('\n');
    const inSection = sectionLines.slice(0, error.line - 1).reduce((length, text) => length + text.length + 1, 0) + error.column - 1;
    const before = sql.slice(0, part.origin + inSection).split('\n');
    return { line: before.length, column: before[before.length - 1].length + 1 };
}

/** The flat maps of dry-run results, each keyed by the name the panel gives an action: its ID, or a unit test's name */
function legacyDryRunMaps(slice: BigQuerySlice, shown: Shown[]): Record<string, unknown> {
    const stats: Record<string, string> = {};
    const errors: Record<string, Annotation> = {};
    const incrementalErrors: Record<string, Annotation> = {};
    const expectedOutputErrors: Record<string, Annotation> = {};
    const queries: Record<string, string> = {};
    const incrementalQueries: Record<string, string> = {};
    const nonIncrementalQueries: Record<string, string> = {};

    for (const { model, action } of shown) {
        const result = (script: string, incremental = false) =>
            slice.results.find((candidate) => candidate.action === action.id && candidate.script === script && candidate.incremental === incremental);
        const cost = (found: DryRunResult | undefined, label: string) => dryRunCostSummary(found, label, slice.currencySymbol);
        const setStat = (name: string, parts: string[]) => {
            const text = parts.filter(Boolean).join('<br>');
            if (text) {
                stats[name] = text;
            }
        };
        const setError = (map: Record<string, Annotation>, name: string, found: DryRunResult | undefined) => {
            if (found?.error) {
                map[name] = { message: found.error.message, location: placeInScript(action, found) ?? NO_PLACE };
            }
        };
        const setQuery = (map: Record<string, string>, name: string, found: DryRunResult | undefined) => {
            if (found) {
                map[name] = found.sql;
            }
        };

        if (model.type === 'test') {
            const name = model.name ?? '';
            const [input, expected] = [result('test query'), result('expected output')];
            setStat(name, [cost(input, 'Input'), cost(expected, 'Expected')]);
            setError(errors, name, input);
            setError(expectedOutputErrors, name, expected);
        } else if (model.type === 'incremental') {
            const [full, incremental] = [result('query'), result('query', true)];
            setStat(action.id, [cost(full, 'Non incremental'), cost(incremental, 'Incremental')]);
            setError(errors, action.id, full);
            setError(incrementalErrors, action.id, incremental);
            setQuery(nonIncrementalQueries, action.id, full);
            setQuery(incrementalQueries, action.id, incremental);
        } else {
            const main = result(mainScript(model));
            setStat(action.id, [cost(main, '')]);
            setError(errors, action.id, main);
            setQuery(queries, action.id, main);
        }
    }
    return {
        dryRunStatByNodeName: stats,
        dryRunErrorsByNodeName: errors,
        dryRunIncrementalErrorsByNodeName: incrementalErrors,
        dryRunExpectedOutputErrorsByNodeName: expectedOutputErrors,
        dryRunQueryByNodeName: queries,
        dryRunIncrementalQueryByNodeName: incrementalQueries,
        dryRunNonIncrementalQueryByNodeName: nonIncrementalQueries,
        // Every result is given by name. The maps by type of action were a second way to find the same result, and
        // are sent empty so that those of the last file do not stand
        dryRunStatByNodeType: {},
        dryRunErrorsByNodeType: {},
        dryRunIncrementalErrorsByNodeType: {},
        dryRunExpectedOutputErrorsByNodeType: {},
    };
}

const NO_COLUMNS = { fields: [{ name: '', type: '' }] };

/**
 * The columns of the first action on show, from the dry run of its query, described as its config describes them.
 * An action whose dry run gave no columns has the one empty column the flat state has always had for that.
 */
function legacySchema(slice: BigQuerySlice, shown: Shown[]): unknown {
    const [{ model, action }] = shown;
    const schema = slice.results.find((result) => result.action === action.id && result.script === mainScript(model) && !result.incremental)?.schema;
    return schema?.fields ? { fields: applyColumnDescriptions(schema.fields, action.columns ?? []) } : NO_COLUMNS;
}

/**
 * The flat fields of a `bigquery` slice.
 *
 * @param file The `file` slice sent before it. The flat state names a result by its action's name and lists what is
 * known of the tables by the position of their actions, so without the actions it has neither
 */
export function legacyStateFromBigQuerySlice(slice: BigQuerySlice, file: FileSlice | undefined): Record<string, unknown> {
    const dryRunning = slice.dryRunning.length > 0;
    const shown = file ? legacyModels(file) : [];
    const flat: Record<string, unknown> = { dryRunning, currencySymbol: slice.currencySymbol, ...legacyDryRunMaps(slice, shown) };
    if (shown.length === 0) {
        // Nothing with columns is on show
        if (!dryRunning) {
            flat.compiledQuerySchema = null;
        }
        return flat;
    }
    flat.modelsLastUpdateTimesMeta = shown.map(({ model, action }) => {
        // A unit test builds no table
        if (model.type === 'test') {
            return null;
        }
        const table = slice.tables[action.id];
        return table && { lastModifiedTime: table.lastModified, modelWasUpdatedToday: table.modifiedToday, error: { message: table.error } };
    });
    // The columns on show stay until dry runs have given others: not while they are out, nor when none was made
    if (!dryRunning && slice.results.length > 0) {
        flat.compiledQuerySchema = legacySchema(slice, shown);
    }
    return flat;
}
