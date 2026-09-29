import * as vscode from 'vscode';
import { checkAuthentication, getBigQueryClient } from '../bigqueryClient';
import { logger } from '../logger';
import { DataformCompiledJson } from '../types';
import { getLastRunContext } from '../lastRun';
import { DeferralEntry, PROXY_VIEW_LABEL, proxyViewSpec, targetId } from './deferRules';
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

/** Creates or updates the Proxy View of each deferred entry. Returns how many were created or updated. */
export async function ensureProxyViews(entries: DeferralEntry[]): Promise<number> {
    await checkAuthentication();
    const client = bigQuery();
    let written = 0;
    // A view cannot stand in for a function or procedure: a run builds those in dev instead
    for (const entry of entries.filter((e) => e.status === "deferred" && !e.routine)) {
        const spec = proxyViewSpec(entry);
        const table = client.dataset(spec.datasetId, { projectId: spec.projectId }).table(spec.tableId);
        const view = { query: spec.query, useLegacySql: false };
        let existing: any;
        try {
            [existing] = await table.getMetadata();
        } catch (error: any) {
            if (errorCode(error) !== 404) {
                throw error;
            }
        }
        if (!existing) {
            await client.dataset(spec.datasetId, { projectId: spec.projectId }).createTable(spec.tableId, { view, labels: spec.labels, description: spec.description });
            written++;
        } else if (existing.labels?.[PROXY_VIEW_LABEL] === "true") {
            await table.setMetadata({ view, labels: spec.labels, description: spec.description });
            written++;
        } else {
            // Built in dev since the deferral was worked out, so the run reads it as it is
            logger.info(`Defer to prod: ${targetId(entry.dev)} now exists in dev, no proxy view created`);
        }
    }
    if (written > 0) {
        await setProxyViewsMayExist(true);
        clearTableExistenceCache({ includeUnreadable: false });
    }
    return written;
}

/** Deletes every labelled Proxy View in the dev datasets of the project, after asking. */
export async function removeProxyViews(graph: DataformCompiledJson | undefined) {
    if (!graph) {
        vscode.window.showWarningMessage("Compile the Dataform project first, so its dev datasets are known.");
        return;
    }
    await checkAuthentication();
    const client = bigQuery();
    const datasets = new Map<string, { projectId: string, datasetId: string }>();
    for (const action of [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.assertions ?? []), ...(graph.declarations ?? [])]) {
        if (action?.target) {
            datasets.set(`${action.target.database}.${action.target.schema}`, { projectId: action.target.database, datasetId: action.target.schema });
        }
    }

    const proxies: { id: string, remove: () => Promise<unknown> }[] = [];
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Looking for proxy views" }, async () => {
        await Promise.all([...datasets.values()].map(async ({ projectId, datasetId }) => {
            try {
                const [tables] = await client.dataset(datasetId, { projectId }).getTables({ autoPaginate: true });
                for (const table of tables) {
                    if (table.metadata?.type === "VIEW" && table.metadata?.labels?.[PROXY_VIEW_LABEL] === "true") {
                        proxies.push({ id: `${projectId}.${datasetId}.${table.id}`, remove: () => table.delete() });
                    }
                }
            } catch (error: any) {
                if (errorCode(error) !== 404) {
                    logger.error(`Defer to prod: could not list ${projectId}.${datasetId}: ${error?.message}`);
                }
            }
        }));
    });

    if (proxies.length === 0) {
        await setProxyViewsMayExist(false);
        vscode.window.showInformationMessage("No proxy views found in the project's dev datasets.");
        return;
    }
    const ids = proxies.map((proxy) => proxy.id).sort();
    const choice = await vscode.window.showWarningMessage(
        `Delete ${proxies.length} proxy view${proxies.length === 1 ? "" : "s"} created by defer to prod?`,
        { modal: true, detail: ids.join("\n") },
        "Delete",
    );
    if (choice !== "Delete") {
        return;
    }
    const results = await Promise.allSettled(proxies.map((proxy) => proxy.remove()));
    const failed = results.filter((result) => result.status === "rejected").length;
    clearTableExistenceCache({ includeUnreadable: false });
    if (failed === 0) {
        await setProxyViewsMayExist(false);
    }
    if (failed > 0) {
        vscode.window.showErrorMessage(`Deleted ${proxies.length - failed} proxy views; ${failed} could not be deleted. See the Dataform Tools log.`);
        results.forEach((result, i) => {
            if (result.status === "rejected") {
                logger.error(`Defer to prod: could not delete ${proxies[i].id}: ${result.reason}`);
            }
        });
    } else {
        vscode.window.showInformationMessage(`Deleted ${proxies.length} proxy view${proxies.length === 1 ? "" : "s"}.`);
    }
}
