import * as vscode from 'vscode';
import { checkAuthentication, getBigQueryClient } from '../bigqueryClient';
import { logger } from '../logger';
import { DataformCompiledJson } from '../types';
import { getLastRunContext } from '../lastRun';
import { DeferralEntry, PROXY_VIEW_LABEL, proxyViewAction, proxyViewSpec, targetId } from './deferRules';
import { clearTableExistenceCache } from './tableExistence';

/*
 * Proxy Views let a Dataform run defer to prod: Dataform only reads the Dev Target, so a view there reading
 * the Prod Target makes the run read prod. They are labelled so they can be told apart from real dev tables,
 * which are never replaced, and removed later.
 */

const PROXY_VIEWS_CREATED_KEY = "defer_to_prod_proxy_views_created";

/**
 * True once this workspace has created Proxy Views that have not all been removed since. Until then nothing
 * looks for leftover proxies, so users who never ran with defer to prod make no extra BigQuery calls.
 */
export function proxyViewsMayExist(): boolean {
    return getLastRunContext()?.workspaceState.get<boolean>(PROXY_VIEWS_CREATED_KEY) === true;
}

async function setProxyViewsMayExist(value: boolean) {
    await getLastRunContext()?.workspaceState.update(PROXY_VIEWS_CREATED_KEY, value);
}

function bigQuery() {
    const client = getBigQueryClient();
    if (!client) {
        throw new Error("BigQuery client not available");
    }
    return client;
}

function errorCode(error: any): number | undefined {
    return error?.code ?? error?.response?.statusCode;
}

/**
 * Makes sure each deferred entry has a Proxy View reading its Prod Target. Proxy Views still count as not
 * built in dev, so the same entries come back on every run: one that already reads the right table is left
 * alone. Returns how many views were created and how many were repointed.
 */
export async function ensureProxyViews(entries: DeferralEntry[]): Promise<{ created: number, updated: number }> {
    await checkAuthentication();
    const client = bigQuery();
    const counts = { created: 0, updated: 0 };
    // A view cannot stand in for a function or procedure: a run builds those in dev instead
    await Promise.all(entries.filter((e) => e.status === "deferred" && !e.routine).map(async (entry) => {
        const spec = proxyViewSpec(entry);
        const dataset = client.dataset(spec.datasetId, { projectId: spec.projectId });
        const table = dataset.table(spec.tableId);
        const view = { query: spec.query, useLegacySql: false };
        let existing: any;
        try {
            [existing] = await table.getMetadata();
        } catch (error: any) {
            if (errorCode(error) !== 404) {
                throw error;
            }
        }
        switch (proxyViewAction(existing, spec)) {
            case "create":
                await dataset.createTable(spec.tableId, { view, labels: spec.labels, description: spec.description });
                counts.created++;
                break;
            case "update":
                // e.g. the prod options changed since the view was created
                await table.setMetadata({ view, labels: spec.labels, description: spec.description });
                counts.updated++;
                break;
            case "leaveRealTable":
                // Built in dev since the deferral was worked out, so the run reads it as it is
                logger.info(`Defer to prod: ${targetId(entry.dev)} now exists in dev, no proxy view created`);
                break;
            case "keep":
                break;
        }
    }));
    if (counts.created + counts.updated > 0) {
        await setProxyViewsMayExist(true);
        clearTableExistenceCache({ includeUnreadable: false });
    }
    return counts;
}

function isProxyView(metadata: any): boolean {
    return metadata?.type === "VIEW" && metadata?.labels?.[PROXY_VIEW_LABEL] === "true";
}

/** Every labelled Proxy View in the dev datasets of the project. Lists each dataset, so it takes a few seconds. */
async function findAllProxyViews(graph: DataformCompiledJson): Promise<string[]> {
    const client = bigQuery();
    const datasets = new Map<string, { projectId: string, datasetId: string }>();
    for (const action of [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.assertions ?? []), ...(graph.declarations ?? [])]) {
        if (action?.target) {
            datasets.set(`${action.target.database}.${action.target.schema}`, { projectId: action.target.database, datasetId: action.target.schema });
        }
    }
    const ids: string[] = [];
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Defer to prod: looking for proxy views in ${datasets.size} dev dataset${datasets.size === 1 ? "" : "s"}…` },
        () => Promise.all([...datasets.values()].map(async ({ projectId, datasetId }) => {
            try {
                const [tables] = await client.dataset(datasetId, { projectId }).getTables({ autoPaginate: true });
                tables.filter((table) => isProxyView(table.metadata) && table.id).forEach((table) => ids.push(`${projectId}.${datasetId}.${table.id}`));
            } catch (error: any) {
                if (errorCode(error) !== 404) {
                    logger.error(`Defer to prod: could not list ${projectId}.${datasetId}: ${error?.message}`);
                }
            }
        })),
    );
    return ids.sort();
}

/**
 * Deletes Proxy Views after asking: the given `database.schema.name` ids, e.g. the ones the compiled query panel
 * lists, or else every one in the project's dev datasets. Each is checked to still be a labelled proxy view just
 * before it is deleted, so a table built in dev since is never removed.
 */
export async function removeProxyViews(graph: DataformCompiledJson | undefined, knownIds?: string[]) {
    const wholeProject = !knownIds || knownIds.length === 0;
    if (wholeProject && !graph) {
        vscode.window.showWarningMessage("Compile the Dataform project first, so its dev datasets are known.");
        return;
    }
    await checkAuthentication();
    const client = bigQuery();
    const ids = wholeProject ? await findAllProxyViews(graph!) : [...knownIds].sort();

    if (ids.length === 0) {
        await setProxyViewsMayExist(false);
        vscode.window.showInformationMessage("No proxy views found in the project's dev datasets.");
        return;
    }
    const choice = await vscode.window.showWarningMessage(
        `Delete ${ids.length} proxy view${ids.length === 1 ? "" : "s"} created by defer to prod?`,
        { modal: true, detail: ids.join("\n") },
        "Delete",
    );
    if (choice !== "Delete") {
        return;
    }

    const results = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Defer to prod: deleting ${ids.length} proxy view${ids.length === 1 ? "" : "s"}…` },
        () => Promise.allSettled(ids.map(async (id) => {
            const [projectId, datasetId, tableId] = id.split(".");
            const table = client.dataset(datasetId, { projectId }).table(tableId);
            const [metadata] = await table.getMetadata();
            if (!isProxyView(metadata)) {
                return false; // Replaced by a real dev build since it was listed
            }
            await table.delete();
            return true;
        })),
    );
    clearTableExistenceCache({ includeUnreadable: false });

    const failed = results.filter((result) => result.status === "rejected").length;
    const deleted = results.filter((result) => result.status === "fulfilled" && result.value).length;
    results.forEach((result, i) => {
        if (result.status === "rejected") {
            logger.error(`Defer to prod: could not delete ${ids[i]}: ${result.reason}`);
        }
    });
    // Only a full scan knows no proxy view is left anywhere in the project
    if (wholeProject && failed === 0) {
        await setProxyViewsMayExist(false);
    }
    if (failed > 0) {
        vscode.window.showErrorMessage(`Deleted ${deleted} proxy view${deleted === 1 ? "" : "s"}; ${failed} could not be deleted. See the Dataform Tools log.`);
    } else {
        vscode.window.showInformationMessage(`Deleted ${deleted} proxy view${deleted === 1 ? "" : "s"}.`);
    }
}
