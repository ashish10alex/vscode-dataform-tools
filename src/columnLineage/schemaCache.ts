import { logger } from '../logger';
import { fetchTableMetadata } from '../hoverProvider';
import { SchemaColumn } from '../shared/columnLineage/graphLinks';
import { Limiter } from '../shared/columnLineage/limiter';

/** Metadata reads in flight at once across every trace; a wide hop would otherwise start one per linked table */
const metadataReads = new Limiter(6);
/** A read that takes longer is given up on, so one stuck call can't hold a trace on "Loading hop…" */
const METADATA_TIMEOUT_MS = 15_000;

class TimeoutError extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(`${what} took longer than ${ms / 1000} s`)), ms);
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

interface TableInfo {
    columns: SchemaColumn[];
    location?: string;
}

/** BigQuery schemas and locations of the tables a trace touches, fetched once per trace */
export class SchemaCache {
    private readonly tables = new Map<string, Promise<TableInfo | undefined>>();
    /** Why a table couldn't be read, when it wasn't because there is no such table */
    private readonly failures = new Map<string, string>();

    private info(table: string): Promise<TableInfo | undefined> {
        let pending = this.tables.get(table);
        if (!pending) {
            const [projectId, datasetId, tableId] = table.split('.');
            pending = metadataReads.run(0, () => {
                const started = Date.now();
                return withTimeout(fetchTableMetadata(projectId, datasetId, tableId), METADATA_TIMEOUT_MS, 'Reading the table')
                    .then((metadata: any) => [metadata, Date.now() - started] as const);
            })
                .then(([metadata, ms]) => {
                    logger.debug(`Column trace: metadata of ${table}, ${ms} ms`);
                    return metadata;
                })
                .then((metadata: any) => {
                    this.failures.delete(table);
                    return metadata;
                })
                .then((metadata: any) => ({
                    columns: (metadata?.schema?.fields ?? []).map((field: any) => ({ name: String(field.name), type: String(field.type) })),
                    location: metadata?.location ? String(metadata.location) : undefined,
                }))
                .catch((error: any) => {
                    logger.debug(`Column trace: no metadata for ${table}: ${error?.message ?? error}`);
                    if (error?.code === 404) {
                        this.failures.delete(table);
                        return undefined;
                    }
                    this.failures.set(table, error?.message ?? String(error));
                    if (this.tables.get(table) === stored) {
                        // Unlike a missing table, a slow, rate-limited or unauthorised read is worth trying again next time
                        this.tables.delete(table);
                    }
                    return undefined;
                });
            const stored = pending;
            this.tables.set(table, pending);
        }
        return pending;
    }

    async schema(table: string): Promise<SchemaColumn[] | undefined> {
        return (await this.info(table))?.columns;
    }

    /** The table's columns, or why it couldn't be read; neither when there is no such table */
    async read(table: string): Promise<{ columns?: SchemaColumn[]; error?: string }> {
        const columns = await this.schema(table);
        return { columns, error: this.failures.get(table) };
    }

    async location(table: string): Promise<string | undefined> {
        return (await this.info(table))?.location;
    }

    /** The column's name as the table's schema spells it, e.g. `PLAYER_ID` for the lowercased `player_id` */
    async casing(table: string, column: string): Promise<string> {
        const columns = await this.schema(table);
        return columns?.find((field) => field.name.toLowerCase() === column.toLowerCase())?.name ?? column;
    }

    clear() {
        this.tables.clear();
        this.failures.clear();
    }
}
