import { logger } from '../logger';
import { fetchTableMetadata } from '../hoverProvider';
import { SchemaColumn } from '../shared/columnLineage/graphLinks';

interface TableInfo {
    columns: SchemaColumn[];
    location?: string;
}

/** BigQuery schemas and locations of the tables a trace touches, fetched once per trace */
export class SchemaCache {
    private readonly tables = new Map<string, Promise<TableInfo | undefined>>();

    private info(table: string): Promise<TableInfo | undefined> {
        let pending = this.tables.get(table);
        if (!pending) {
            const [projectId, datasetId, tableId] = table.split('.');
            pending = fetchTableMetadata(projectId, datasetId, tableId)
                .then((metadata: any) => ({
                    columns: (metadata?.schema?.fields ?? []).map((field: any) => ({ name: String(field.name), type: String(field.type) })),
                    location: metadata?.location ? String(metadata.location) : undefined,
                }))
                .catch((error: any) => {
                    logger.debug(`Column trace: no metadata for ${table}: ${error?.message ?? error}`);
                    return undefined;
                });
            this.tables.set(table, pending);
        }
        return pending;
    }

    async schema(table: string): Promise<SchemaColumn[] | undefined> {
        return (await this.info(table))?.columns;
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
    }
}
