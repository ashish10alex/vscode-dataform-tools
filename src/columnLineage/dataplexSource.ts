import * as vscode from 'vscode';
import { loadLineageClient } from '../lazySdk';
import { GraphAction, runsAsScript } from '../shared/columnLineage/graphLinks';
import { columnLinksFromApi, lineageField, lineageFqn, tablesFromApi, untrackedReaders } from '../shared/columnLineage/dataplexLinks';
import { ColumnLink, LineageDirection, TraceSource } from '../shared/columnLineage/types';
import { SchemaCache } from './schemaCache';

type LineageClient = InstanceType<Awaited<ReturnType<typeof loadLineageClient>>>;

let client: LineageClient | undefined;

/** One client for the session, with the same credentials as the BigQuery calls */
async function lineageClient(): Promise<LineageClient> {
    if (!client) {
        const keyFilename = vscode.workspace.getConfiguration('vscode-dataform-tools').get<string>('serviceAccountJsonPath');
        client = new (await loadLineageClient())(keyFilename ? { keyFilename } : {});
    }
    return client;
}

function describeError(error: any, project: string): string {
    if (error?.code === 7) {
        return `No access to Data Lineage in ${project}. It needs the Data Lineage API enabled and roles/datalineage.viewer.`;
    }
    if (error?.code === 16) {
        return 'Not signed in to Google Cloud. Run `gcloud auth application-default login`.';
    }
    return error?.details || error?.message || String(error);
}

/**
 * Column lineage from Dataplex: links recorded from the jobs that built each table, kept for 30 days and
 * ingested about two hours after a job runs. Lineage is searched in the table's own project and region.
 */
/** Columns probed to decide whether Dataplex tracks a table's column lineage at all */
const PROBE_COLUMNS = 3;

export class DataplexTraceSource implements TraceSource {
    readonly kind = 'dataplex' as const;
    private readonly tracked = new Map<string, Promise<boolean>>();
    /** Table-level readers per table: the same for every column of it, so looked up once */
    private readonly readers = new Map<string, Promise<any[]>>();

    /** `prodIndex`: this project's actions keyed by Prod Target, to spot readers that get no column lineage */
    constructor(private readonly schemas: SchemaCache, private readonly prodIndex: Map<string, GraphAction>) {}

    resolveFile = (table: string): string | undefined => this.prodIndex.get(table)?.fileName;

    private async parentOf(table: string): Promise<string | undefined> {
        const location = await this.schemas.location(table);
        return location ? `projects/${table.split('.')[0]}/locations/${location.toLowerCase()}` : undefined;
    }

    /** True when any of the table's first few columns has upstream column links; cached per trace */
    private hasColumnLineage(table: string): Promise<boolean> {
        let pending = this.tracked.get(table);
        if (!pending) {
            pending = (async () => {
                const [parent, columns, api] = await Promise.all([this.parentOf(table), this.schemas.schema(table), lineageClient()]);
                if (!parent || !columns?.length) {
                    return false;
                }
                const counts = await Promise.all(columns.slice(0, PROBE_COLUMNS).map(async (field) =>
                    (await api.searchLinks({ parent, target: { fullyQualifiedName: lineageFqn(table), field: lineageField(field.name) } }))[0].length));
                return counts.some((count) => count > 0);
            })();
            this.tracked.set(table, pending);
        }
        return pending;
    }

    private tableReaders(api: LineageClient, parent: string, table: string): Promise<any[]> {
        let pending = this.readers.get(table);
        if (!pending) {
            pending = api.searchLinks({ parent, source: { fullyQualifiedName: lineageFqn(table) } }).then(([links]) => links);
            const stored = pending;
            stored.catch(() => {
                if (this.readers.get(table) === stored) {
                    this.readers.delete(table);
                }
            });
            this.readers.set(table, pending);
        }
        return pending;
    }

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const [project] = table.split('.');
        const parent = await this.parentOf(table);
        if (!parent) {
            throw new Error(`Couldn't read ${table} to find its region.`);
        }
        const api = await lineageClient();
        const side = direction === 'downstream' ? 'source' : 'target';

        try {
            const [columnLinks, tableLinks] = await Promise.all([
                api.searchLinks({ parent, [side]: { fullyQualifiedName: lineageFqn(table), field: lineageField(column) } }).then(([links]) => links),
                direction === 'downstream' ? this.tableReaders(api, parent, table) : Promise.resolve([]),
            ]);

            // Dataplex returns lowercase names; show them as each table's schema spells them
            const links: ColumnLink[] = await Promise.all(columnLinksFromApi(columnLinks, direction).map(async (link) => ({
                ...link,
                column: link.column && await this.schemas.casing(link.table, link.column),
            })));

            // A reader with only a table-level link may still read this column when Dataplex doesn't track its
            // columns: incremental tables and operations never get column lineage, other tables are probed
            const untracked = await untrackedReaders(
                tablesFromApi(tableLinks, 'downstream'),
                new Set(links.map((link) => link.table)),
                async (reader) => {
                    const action = this.prodIndex.get(reader);
                    return action && runsAsScript(action) ? false : this.hasColumnLineage(reader);
                },
            );
            return [...links, ...untracked.map((reader): ColumnLink => ({ table: reader, dependencyType: 'TABLE_ONLY' }))];
        } catch (error: any) {
            throw Object.assign(new Error(describeError(error, project)), { code: error?.code });
        }
    }

    clearCache() {
        this.schemas.clear();
        this.tracked.clear();
        this.readers.clear();
    }
}
