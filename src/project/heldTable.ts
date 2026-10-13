import type { ColumnMetadata } from '../types';

/*
 * What BigQuery said of a table, as the hover of either Backend and the dbt editor features read it. Plain data from
 * the table's metadata; no `vscode` import.
 */

/** What BigQuery said of a table */
export type HeldTable =
    | {
        state: 'found';
        fields: ColumnMetadata[];
        description?: string;
        /** Where the table's dataset is, e.g. `EU` */
        location?: string;
        /** The column the table is partitioned by, with how */
        partition?: string;
        /** Absent for a view: BigQuery counts no rows for one */
        rows?: number;
        /** Milliseconds since the epoch */
        lastModified?: number;
    }
    /** BigQuery has no table of the name: the Action is not built yet */
    | { state: 'missing' }
    /** BigQuery could not be asked. Not held: the next need asks again */
    | { state: 'unknown'; error: string };

function partitionOf(metadata: any): string | undefined {
    const time = metadata?.timePartitioning;
    if (time) {
        return `${time.field ?? '_PARTITIONTIME'} (${String(time.type ?? 'DAY').toLowerCase()})`;
    }
    const range = metadata?.rangePartitioning;
    return range?.field ? `${range.field} (range)` : undefined;
}

/** The table of the metadata BigQuery gave for it */
export function tableOfMetadata(metadata: any): HeldTable {
    // BigQuery says 0 rows of a view, whatever its query gives
    const rows = metadata?.type === 'VIEW' ? NaN : Number(metadata?.numRows);
    const lastModified = Number(metadata?.lastModifiedTime);
    const partition = partitionOf(metadata);
    return {
        state: 'found',
        fields: metadata?.schema?.fields ?? [],
        ...(metadata?.description ? { description: metadata.description } : {}),
        ...(metadata?.location ? { location: metadata.location } : {}),
        ...(partition ? { partition } : {}),
        ...(Number.isFinite(rows) ? { rows } : {}),
        ...(Number.isFinite(lastModified) ? { lastModified } : {}),
    };
}

/** The table of a request for its metadata that failed: missing when BigQuery has none of the name */
export function tableOfError(error: unknown): HeldTable {
    if ((error as { code?: number })?.code === 404) {
        return { state: 'missing' };
    }
    return { state: 'unknown', error: error instanceof Error ? error.message : String(error) };
}
