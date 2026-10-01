import * as vscode from 'vscode';
import { loadLineageClient } from '../lazySdk';
import { GraphAction, runsAsScript } from '../shared/columnLineage/graphLinks';
import { columnLinksFromApi, lineageField, lineageFqn, tablesFromApi } from '../shared/columnLineage/dataplexLinks';
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
export class DataplexTraceSource implements TraceSource {
    readonly kind = 'dataplex' as const;

    /** `prodIndex`: this project's actions keyed by Prod Target, to spot readers that get no column lineage */
    constructor(private readonly schemas: SchemaCache, private readonly prodIndex: Map<string, GraphAction>) {}

    resolveFile = (table: string): string | undefined => this.prodIndex.get(table)?.fileName;

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const [project] = table.split('.');
        const location = await this.schemas.location(table);
        if (!location) {
            throw new Error(`Couldn't read ${table} to find its region.`);
        }
        const parent = `projects/${project}/locations/${location.toLowerCase()}`;
        const api = await lineageClient();
        const side = direction === 'downstream' ? 'source' : 'target';

        try {
            const [columnLinks, tableLinks] = await Promise.all([
                api.searchLinks({ parent, [side]: { fullyQualifiedName: lineageFqn(table), field: lineageField(column) } }).then(([links]) => links),
                direction === 'downstream'
                    ? api.searchLinks({ parent, source: { fullyQualifiedName: lineageFqn(table) } }).then(([links]) => links)
                    : Promise.resolve([]),
            ]);

            // Dataplex returns lowercase names; show them as each table's schema spells them
            const links: ColumnLink[] = await Promise.all(columnLinksFromApi(columnLinks, direction).map(async (link) => ({
                ...link,
                column: link.column && await this.schemas.casing(link.table, link.column),
            })));

            // Readers in this project that run as scripts get table-level lineage only: show them as "may read"
            const withColumns = new Set(links.map((link) => link.table));
            for (const reader of tablesFromApi(tableLinks, 'downstream')) {
                const action = this.prodIndex.get(reader);
                if (!withColumns.has(reader) && action && runsAsScript(action)) {
                    links.push({ table: reader, dependencyType: 'TABLE_ONLY' });
                }
            }
            return links;
        } catch (error: any) {
            throw new Error(describeError(error, project));
        }
    }

    clearCache() {
        this.schemas.clear();
    }
}
