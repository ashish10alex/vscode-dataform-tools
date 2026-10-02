import * as vscode from 'vscode';
import { loadLineageClient } from '../lazySdk';
import { logger } from '../logger';
import { GraphAction } from '../shared/columnLineage/graphLinks';
import { Limiter } from '../shared/columnLineage/limiter';
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

type SearchRequest = Parameters<LineageClient['searchLinks']>[0];

/** Dataplex calls in flight at once for a panel, across every column's trace and count */
const MAX_SEARCHES = 8;

/** A column's own links go first; table-level reader searches and probes wait behind them */
const enum Priority {
    Readers = 0,
    ColumnLinks = 1,
}

/**
 * Every page of a link search, one page after another, timed for the debug log. Each page waits for a slot, so
 * a long search doesn't hold one while more urgent searches queue.
 */
async function searchLinks(limiter: Limiter, priority: Priority, api: LineageClient, request: SearchRequest, label: string): Promise<any[]> {
    const started = Date.now();
    const links: any[] = [];
    let pages = 0;
    let next: SearchRequest | null | undefined = request;
    while (next) {
        const current: SearchRequest = next;
        const [page, nextRequest]: [any[], SearchRequest | null, unknown] = await limiter.run(priority, () => api.searchLinks(current, { autoPaginate: false }));
        links.push(...page);
        pages++;
        next = nextRequest;
    }
    logger.debug(`Column trace: searchLinks ${label}: ${links.length} links in ${pages} page${pages === 1 ? '' : 's'}, ${Date.now() - started} ms`);
    return links;
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
    private readonly limiter = new Limiter(MAX_SEARCHES);

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
                    (await searchLinks(this.limiter, Priority.Readers, api, { parent, target: { fullyQualifiedName: lineageFqn(table), field: lineageField(field.name) } }, `probe ${table}.${field.name}`)).length));
                return counts.some((count) => count > 0);
            })();
            this.tracked.set(table, pending);
        }
        return pending;
    }

    private tableReaders(api: LineageClient, parent: string, table: string): Promise<any[]> {
        let pending = this.readers.get(table);
        if (!pending) {
            pending = searchLinks(this.limiter, Priority.Readers, api, { parent, source: { fullyQualifiedName: lineageFqn(table) } }, `readers of ${table}`);
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

    private isAssertion(table: string): boolean {
        return this.prodIndex.get(table)?.type === 'assertion';
    }

    private async lookup<T>(table: string, run: (api: LineageClient, parent: string) => Promise<T>): Promise<T> {
        const parent = await this.parentOf(table);
        if (!parent) {
            throw new Error(`Couldn't read ${table} to find its region.`);
        }
        const api = await lineageClient();
        try {
            return await run(api, parent);
        } catch (error: any) {
            throw Object.assign(new Error(describeError(error, table.split('.')[0])), { code: error?.code });
        }
    }

    links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        return this.lookup(table, async (api, parent) => {
            const started = Date.now();
            if (direction === 'downstream') {
                // Started now so it overlaps the column search; tableOnlyReaders picks it up from the cache
                this.tableReaders(api, parent, table).catch(() => undefined);
            }
            const side = direction === 'downstream' ? 'source' : 'target';
            const columnLinks = await searchLinks(this.limiter, Priority.ColumnLinks, api, { parent, [side]: { fullyQualifiedName: lineageFqn(table), field: lineageField(column) } }, `${direction} ${table}.${column}`);

            // Dataplex returns lowercase names; show them as each table's schema spells them
            const links: ColumnLink[] = await Promise.all(columnLinksFromApi(columnLinks, direction).map(async (link) => ({
                ...link,
                column: link.column && await this.schemas.casing(link.table, link.column),
                ...(this.isAssertion(link.table) ? { assertion: true } : {}),
            })));
            logger.debug(`Column trace: ${direction} ${table}.${column}: ${links.length} column links in ${Date.now() - started} ms`);
            return links;
        });
    }

    /**
     * A reader with only a table-level link may still read a column when Dataplex doesn't track its columns:
     * incremental tables never get column lineage, other readers are probed. Operations are probed too: some
     * get column lineage (e.g. `CREATE TABLE ... CLONE`), others, such as procedures, don't.
     */
    tableOnlyReaders(table: string, linked: Set<string>): Promise<ColumnLink[]> {
        return this.lookup(table, async (api, parent) => {
            const started = Date.now();
            const readers = tablesFromApi(await this.tableReaders(api, parent, table), 'downstream');
            const untracked = await untrackedReaders(readers, linked, async (reader) => {
                return this.prodIndex.get(reader)?.type === 'incremental' ? false : this.hasColumnLineage(reader);
            });
            logger.debug(`Column trace: readers of ${table} without column lineage: ${untracked.length} of ${readers.length} readers, ${Date.now() - started} ms`);
            return untracked.map((reader): ColumnLink => ({
                table: reader,
                dependencyType: 'TABLE_ONLY',
                ...(this.isAssertion(reader) ? { assertion: true } : {}),
            }));
        });
    }

    clearCache() {
        this.schemas.clear();
        this.tracked.clear();
        this.readers.clear();
    }
}
