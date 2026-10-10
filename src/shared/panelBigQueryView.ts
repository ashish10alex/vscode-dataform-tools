import type { DryRunResult } from '../bigquery/dryRunService';
import type { CompiledQuerySchema } from '../types';
import { applyColumnDescriptions } from '../utils/schemaTree';
import { joinScript } from './compiledGraph';
import type { BigQuerySlice, FileSlice, PanelAction } from './panelContract';
import { FileModel, fileModels } from './panelFileView';

/*
 * What BigQuery said of the actions the compiled-query panel shows, worked out from the `bigquery` slice and the
 * `file` slice it is for. A result is found by the name the panel gives its action: the action's ID, or a unit
 * test's name.
 */

type Shown = { model: FileModel; action: PanelAction };

/** An error of a dry run, placed in the script that was sent, which the panel shows */
export interface DryRunAnnotation {
    message: string;
    location?: { line: number; column: number };
}

/** An error BigQuery gave no place for is at line 0, which the panel marks nowhere */
const NO_PLACE = { line: 0, column: 0 };

/** The script of each type of action that gives its cost, its schema and the SQL shown for it */
const mainScript = (model: FileModel) => (model.type === 'operations' ? 'operation' : 'query');

const UNKNOWN_BYTES = '⚠ Bytes unknown';

export function formatBytes(bytes: number): string {
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
 * Where an error is in the script that was dry-run. A result places it in a section's own SQL; the panel shows
 * the whole script and marks the line there, so the script is joined again from the action's sections and the place
 * found in it. Undefined when the result gives no place, or the sections on show are not those that were sent.
 */
function placeInScript(action: PanelAction, result: DryRunResult): DryRunAnnotation['location'] | undefined {
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

/** The dry-run results, each keyed by the name the panel gives an action: its ID, or a unit test's name */
function dryRunMaps(slice: BigQuerySlice, shown: Shown[]): Pick<BigQueryFields, 'stats' | 'errors' | 'incrementalErrors' | 'expectedOutputErrors' | 'queries' | 'incrementalQueries' | 'nonIncrementalQueries'> {
    const stats: Record<string, string> = {};
    const errors: Record<string, DryRunAnnotation> = {};
    const incrementalErrors: Record<string, DryRunAnnotation> = {};
    const expectedOutputErrors: Record<string, DryRunAnnotation> = {};
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
        const setError = (map: Record<string, DryRunAnnotation>, name: string, found: DryRunResult | undefined) => {
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
    return { stats, errors, incrementalErrors, expectedOutputErrors, queries, incrementalQueries, nonIncrementalQueries };
}

const NO_COLUMNS = { fields: [{ name: '', type: '' }] };

/**
 * The columns of the first action on show, from the dry run of its query, described as its config describes them.
 * An action whose dry run gave no columns has one empty column, which the Schema tab shows as no schema.
 */
function columnsOf(slice: BigQuerySlice, shown: Shown[]): CompiledQuerySchema {
    const [{ model, action }] = shown;
    const schema = slice.results.find((result) => result.action === action.id && result.script === mainScript(model) && !result.incremental)?.schema;
    return schema?.fields ? { fields: applyColumnDescriptions(schema.fields, action.columns ?? []) } : NO_COLUMNS;
}

/** What is known of a model's table */
export interface TableTimes {
    lastModifiedTime: string | undefined;
    modelWasUpdatedToday: boolean | undefined;
    error: { message: string | undefined };
}

/** What a `bigquery` slice says of the actions of a `file` slice */
export interface BigQueryFields {
    /** Dry runs are out */
    dryRunning: boolean;
    currencySymbol: string;
    /** What each dry run would cost, as text */
    stats: Record<string, string>;
    errors: Record<string, DryRunAnnotation>;
    incrementalErrors: Record<string, DryRunAnnotation>;
    expectedOutputErrors: Record<string, DryRunAnnotation>;
    /** The SQL that was dry-run, which the panel shows in place of the action's own */
    queries: Record<string, string>;
    incrementalQueries: Record<string, string>;
    nonIncrementalQueries: Record<string, string>;
    /** What is known of each model's table, by the model's position. Null for one that builds none; empty when no model is on show */
    lastUpdates: Array<TableTimes | null | undefined>;
    /**
     * The columns of the first model. Null when no model is on show. Unset while dry runs are out, and when none
     * was made: the columns the panel has stay.
     */
    columns?: CompiledQuerySchema | null;
}

/**
 * @param file The `file` slice the `bigquery` slice is for. Without its actions there is no name to find a result by
 */
export function bigQueryFieldsOf(slice: BigQuerySlice, file: FileSlice | undefined): BigQueryFields {
    const dryRunning = slice.dryRunning.length > 0;
    const shown = file ? fileModels(file) : [];
    const fields: BigQueryFields = { dryRunning, currencySymbol: slice.currencySymbol, ...dryRunMaps(slice, shown), lastUpdates: [] };
    if (shown.length === 0) {
        if (!dryRunning) {
            fields.columns = null;
        }
        return fields;
    }
    fields.lastUpdates = shown.map(({ model, action }) => {
        // A unit test builds no table
        if (model.type === 'test') {
            return null;
        }
        const table = slice.tables[action.id];
        return table && { lastModifiedTime: table.lastModified, modelWasUpdatedToday: table.modifiedToday, error: { message: table.error } };
    });
    if (!dryRunning && slice.results.length > 0) {
        fields.columns = columnsOf(slice, shown);
    }
    return fields;
}
