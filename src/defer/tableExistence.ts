import { checkAuthentication, getBigQueryClient } from '../bigqueryClient';
import { logger } from '../logger';
import { Target } from '../types';
import { PROXY_VIEW_LABEL, ProdStatus, targetId } from './deferRules';

/*
 * Which Dev Targets and Prod Targets exist, cached for a short while so a dry run on every save does not
 * add BigQuery calls. Dev datasets are listed whole (one call per dataset); Prod Targets are looked up one by one
 * because only deferral candidates need them.
 */

const TTL_MS = 2 * 60 * 1000;

/** `tables` holds real tables and views; Proxy Views are kept apart in `proxies` */
type DatasetListing = { fetchedAt: number, tables: Set<string> | "missing" | "unknown", proxies: Set<string> };

const devDatasets = new Map<string, DatasetListing>();
const prodTables = new Map<string, { fetchedAt: number, status: ProdStatus }>();
/** Prod Targets a query was denied access to. Kept for the session, as access rarely changes. */
const unreadable = new Set<string>();

function isFresh(fetchedAt: number): boolean {
    return Date.now() - fetchedAt < TTL_MS;
}

function errorCode(error: any): number | undefined {
    return error?.code ?? error?.response?.statusCode;
}

async function listDevDataset(database: string, schema: string): Promise<DatasetListing> {
    const key = `${database}.${schema}`;
    const cached = devDatasets.get(key);
    if (cached && isFresh(cached.fetchedAt)) {
        return cached;
    }
    const bigquery = getBigQueryClient();
    let listing: DatasetListing;
    try {
        if (!bigquery) {
            throw new Error("BigQuery client not available");
        }
        const [tables] = await bigquery.dataset(schema, { projectId: database }).getTables({ autoPaginate: true });
        const names = new Set<string>();
        const proxies = new Set<string>();
        for (const table of tables) {
            if (!table.id) {
                continue;
            }
            // A Proxy View reads prod through the dev name, so it does not count as built in dev
            if (table.metadata?.labels?.[PROXY_VIEW_LABEL] === "true") {
                proxies.add(table.id);
            } else {
                names.add(table.id);
            }
        }
        listing = { fetchedAt: Date.now(), tables: names, proxies };
    } catch (error: any) {
        if (errorCode(error) === 404) {
            listing = { fetchedAt: Date.now(), tables: "missing", proxies: new Set() };
        } else {
            // Without a listing we cannot tell, so assume the table exists and leave the query as compiled.
            // Not cached, as the error may be transient.
            logger.error(`Defer to prod: could not list ${key}: ${error?.message}`);
            return { fetchedAt: Date.now(), tables: "unknown", proxies: new Set() };
        }
    }
    devDatasets.set(key, listing);
    return listing;
}

/** Ids of the given Dev Targets that exist in BigQuery and are not Proxy Views */
export async function findExistingDevTargets(targets: Target[]): Promise<Set<string>> {
    await checkAuthentication();
    const datasets = new Map<string, Target>();
    targets.forEach((target) => datasets.set(`${target.database}.${target.schema}`, target));
    const listings = new Map<string, DatasetListing>();
    await Promise.all([...datasets.entries()].map(async ([key, target]) => {
        listings.set(key, await listDevDataset(target.database, target.schema));
    }));

    const existing = new Set<string>();
    for (const target of targets) {
        const tables = listings.get(`${target.database}.${target.schema}`)?.tables;
        if (tables === "unknown" || (tables instanceof Set && tables.has(target.name))) {
            existing.add(targetId(target));
        }
    }
    return existing;
}

/** The given Dev Targets that are Proxy Views, i.e. read prod whether or not defer to prod is on */
export async function findProxyViews(targets: Target[]): Promise<Target[]> {
    await checkAuthentication();
    const listings = new Map<string, DatasetListing>();
    await Promise.all([...new Map(targets.map((target) => [`${target.database}.${target.schema}`, target])).entries()].map(async ([key, target]) => {
        listings.set(key, await listDevDataset(target.database, target.schema));
    }));
    return targets.filter((target) => listings.get(`${target.database}.${target.schema}`)?.proxies.has(target.name));
}

/** `database.schema` of the given Dev Targets whose dataset does not exist. Proxy Views are never created in them. */
export async function findMissingDevDatasets(targets: Target[]): Promise<Set<string>> {
    await checkAuthentication();
    const datasets = new Map<string, Target>();
    targets.forEach((target) => datasets.set(`${target.database}.${target.schema}`, target));
    const missing = new Set<string>();
    await Promise.all([...datasets.entries()].map(async ([key, target]) => {
        if ((await listDevDataset(target.database, target.schema)).tables === "missing") {
            missing.add(key);
        }
    }));
    return missing;
}

async function lookupProdTable(target: Target): Promise<ProdStatus> {
    const id = targetId(target);
    if (unreadable.has(id)) {
        return "unreadable";
    }
    const cached = prodTables.get(id);
    if (cached && isFresh(cached.fetchedAt)) {
        return cached.status;
    }
    const bigquery = getBigQueryClient();
    let status: ProdStatus;
    try {
        if (!bigquery) {
            throw new Error("BigQuery client not available");
        }
        await bigquery.dataset(target.schema, { projectId: target.database }).table(target.name).getMetadata();
        status = "exists";
    } catch (error: any) {
        if (errorCode(error) === 403) {
            status = "unreadable";
            unreadable.add(id);
        } else if (errorCode(error) === 404) {
            status = "missing";
        } else {
            // Not cached, as the error may be transient
            logger.error(`Defer to prod: could not look up ${id}: ${error?.message}`);
            return "missing";
        }
    }
    prodTables.set(id, { fetchedAt: Date.now(), status });
    return status;
}

export async function getProdStatuses(targets: Target[]): Promise<Map<string, ProdStatus>> {
    await checkAuthentication();
    const statuses = new Map<string, ProdStatus>();
    await Promise.all(targets.map(async (target) => {
        statuses.set(targetId(target), await lookupProdTable(target));
    }));
    return statuses;
}

/** Records Prod Targets that a query was denied access to. Returns true when any of them is new. */
export function markProdUnreadable(targets: Target[]): boolean {
    let added = false;
    for (const target of targets) {
        const id = targetId(target);
        if (!unreadable.has(id)) {
            unreadable.add(id);
            added = true;
        }
    }
    return added;
}

export function clearTableExistenceCache(options: { includeUnreadable: boolean }) {
    devDatasets.clear();
    prodTables.clear();
    if (options.includeUnreadable) {
        unreadable.clear();
    }
}
