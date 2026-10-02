import { ColumnLink, DependencyType, LineageDirection } from './types';

// Turns Data Lineage API links into trace links. Kept free of the SDK so it can be unit tested.

/** The parts of a Data Lineage API `Link` the trace uses */
export interface LineageApiLink {
    source?: { fullyQualifiedName?: string | null; field?: string[] | null } | null;
    target?: { fullyQualifiedName?: string | null; field?: string[] | null } | null;
    dependencyInfo?: { dependencyType?: string | number | null }[] | null;
}

const BIGQUERY_PREFIX = 'bigquery:';

/**
 * Dataplex stores column names lowercased and matches `field` case-sensitively, so a request for `PLAYER_ID`
 * finds nothing while `player_id` finds its links.
 */
export function lineageField(column: string): string[] {
    return [column.toLowerCase()];
}

export function lineageFqn(table: string): string {
    return `${BIGQUERY_PREFIX}${table}`;
}

/**
 * Tables a script creates and drops while it runs: BigQuery's hidden `_script…` datasets, and Dataform's
 * `df_<hash>_table_temp` and `df_<hash>_table_empty`. Dataplex records links to them, but they're gone by the
 * time anyone looks.
 */
export function isTempTable(table: string): boolean {
    const [, dataset = '', name = ''] = table.split('.');
    return dataset.startsWith('_script') || /^df_[0-9a-f]+_table_(temp|empty)$/i.test(name);
}

/** `project.dataset.table` of a BigQuery entity, or undefined for anything else, including temp tables */
function bigQueryTable(fqn: string | null | undefined): string | undefined {
    if (!fqn?.startsWith(BIGQUERY_PREFIX)) {
        return undefined;
    }
    const table = fqn.slice(BIGQUERY_PREFIX.length);
    return isTempTable(table) ? undefined : table;
}

/** EXACT_COPY when any part of the link is a straight copy; anything else (OTHER, unspecified) is a transformation */
function dependencyOf(link: LineageApiLink): DependencyType {
    return (link.dependencyInfo ?? []).some((info) => info.dependencyType === 'EXACT_COPY' || info.dependencyType === 1)
        ? 'EXACT_COPY'
        : 'OTHER';
}

/**
 * The column at the far end of each link, one entry per column. A column reached by several links (e.g. once as
 * a copy and once through a filter) keeps the strongest dependency.
 */
export function columnLinksFromApi(links: LineageApiLink[], direction: LineageDirection): ColumnLink[] {
    const byColumn = new Map<string, ColumnLink>();
    for (const link of links) {
        const end = direction === 'downstream' ? link.target : link.source;
        const table = bigQueryTable(end?.fullyQualifiedName);
        const column = end?.field?.[0];
        if (!table || !column) {
            continue;
        }
        const key = `${table}#${column}`;
        const dependencyType = dependencyOf(link);
        const existing = byColumn.get(key);
        if (!existing || (dependencyType === 'EXACT_COPY' && existing.dependencyType !== 'EXACT_COPY')) {
            byColumn.set(key, { table, column, dependencyType });
        }
    }
    return [...byColumn.values()];
}

/** Tables at the far end of table-level links */
export function tablesFromApi(links: LineageApiLink[], direction: LineageDirection): string[] {
    const tables = links
        .map((link) => bigQueryTable((direction === 'downstream' ? link.target : link.source)?.fullyQualifiedName))
        .filter((table): table is string => !!table);
    return [...new Set(tables)];
}

/**
 * Readers that read the table but whose columns Dataplex doesn't track, e.g. a job past its 1,500 column-link
 * limit, which keeps only table-level lineage. A reader Dataplex does track, but that has no link for this
 * column, doesn't read the column and is left out. So is a dev run of an action whose prod run has a link, and the
 * other way round: `toProd` folds each into its action's Prod Target.
 */
export async function untrackedReaders(
    readers: string[],
    readersWithLink: Set<string>,
    hasColumnLineage: (table: string) => Promise<boolean>,
    toProd: (table: string) => string = (table) => table,
): Promise<string[]> {
    const linked = new Set([...readersWithLink].map(toProd));
    const candidates = readers.filter((reader) => !linked.has(toProd(reader)));
    const tracked = await Promise.all(candidates.map(hasColumnLineage));
    return candidates.filter((_, i) => !tracked[i]);
}
