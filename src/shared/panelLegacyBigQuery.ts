import type { BigQuerySlice, FileSlice } from './panelContract';
import { legacyModels } from './panelLegacyFile';

/*
 * The `bigquery` slice as the flat fields the panel's components still read (see panelLegacyState.ts). It goes with
 * the rest of the adapter.
 */

/**
 * The flat fields that arrive only through the `bigquery` slice. The dry-run results join them when the eleven maps
 * the flat state keeps them in have moved; until then the slice's results are not passed on.
 */
export const MIGRATED_BIGQUERY_FIELDS = ['dryRunning', 'currencySymbol', 'modelsLastUpdateTimesMeta'] as const;

/**
 * The flat fields of a `bigquery` slice.
 *
 * @param file The `file` slice sent before it. The flat state lists what is known of the tables by the position of
 * their actions, so without the actions nothing is said of the tables
 */
export function legacyStateFromBigQuerySlice(slice: BigQuerySlice, file: FileSlice | undefined): Record<string, unknown> {
    const flat: Record<string, unknown> = { dryRunning: slice.dryRunning.length > 0, currencySymbol: slice.currencySymbol };
    const shown = file ? legacyModels(file) : [];
    if (shown.length > 0) {
        flat.modelsLastUpdateTimesMeta = shown.map(({ model, action }) => {
            // A unit test builds no table
            if (model.type === 'test') {
                return null;
            }
            const table = slice.tables[action.id];
            return table && { lastModifiedTime: table.lastModified, modelWasUpdatedToday: table.modifiedToday, error: { message: table.error } };
        });
    }
    return flat;
}
