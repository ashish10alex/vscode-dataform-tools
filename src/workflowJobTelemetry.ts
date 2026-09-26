import * as vscode from 'vscode';
import { DataformTools } from "@ashishalex/dataform-tools";
import { checkAuthentication, getBigQueryClient } from './bigqueryClient';
import { bigQueryDryRunCostOneGiBByCurrency, currencySymbolMapping } from './constants';
import { logger } from './logger';
import { SupportedCurrency, WorkflowAction, WorkflowActionJobStats, WorkflowUrlEntry } from './types';
import { formatBytes } from './utils';

/*
 * Telemetry for the BigQuery jobs behind a workflow invocation: bytes billed and the SQL Dataform
 * executed, looked up from `WorkflowInvocationAction.bigqueryAction`.
 */

export const EXECUTED_SQL_SCHEME = 'dataform-executed-sql';
const JOB_STATS_CONCURRENCY = 5;

export type BigQueryJobRef = { projectId: string, location?: string, jobId: string };

/** Accepts a bare job ID or the fully qualified `project:location.jobId` form. */
export function parseBigQueryJobId(rawJobId: string, defaultProjectId: string): BigQueryJobRef {
    const match = /^([^:]+):([^.]+)\.(.+)$/.exec(rawJobId);
    if (match) {
        return { projectId: match[1], location: match[2], jobId: match[3] };
    }
    return { projectId: defaultProjectId, jobId: rawJobId };
}

export function bigQueryJobConsoleUrl(ref: BigQueryJobRef): string {
    const location = ref.location ?? 'US';
    return `https://console.cloud.google.com/bigquery?project=${ref.projectId}&j=bq:${location}:${ref.jobId}&page=queryresults`;
}

/** Builds display-ready stats from the `statistics` block of BigQuery job metadata. */
export function toJobStats(statistics: any, location: string | undefined, currency: SupportedCurrency): WorkflowActionJobStats {
    const toNumber = (value: unknown) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    };
    const totalBytesBilled = toNumber(statistics?.query?.totalBytesBilled);
    const totalBytesProcessed = toNumber(statistics?.totalBytesProcessed ?? statistics?.query?.totalBytesProcessed);
    const cost = totalBytesBilled === undefined
        ? undefined
        : (totalBytesBilled / (1024 ** 3)) * bigQueryDryRunCostOneGiBByCurrency[currency];
    return {
        location,
        totalBytesBilled,
        totalBytesProcessed,
        cost,
        bytesBilledLabel: totalBytesBilled === undefined ? undefined : formatBytes(totalBytesBilled),
        costLabel: cost === undefined ? undefined : `${currencySymbolMapping[currency]}${cost.toFixed(4)}`,
    };
}

/** Totals over the actions whose job stats have loaded. */
export function summariseJobStats(actions: WorkflowAction[], currency: SupportedCurrency): WorkflowActionJobStats | undefined {
    const loaded = actions.map((action) => action.jobStats).filter((stats) => stats && !stats.error) as WorkflowActionJobStats[];
    if (loaded.length === 0) {
        return undefined;
    }
    const sum = (key: 'totalBytesBilled' | 'totalBytesProcessed') => loaded.reduce((total, stats) => total + (stats[key] ?? 0), 0);
    return toJobStats(
        { totalBytesProcessed: sum('totalBytesProcessed'), query: { totalBytesBilled: sum('totalBytesBilled') } },
        undefined,
        currency,
    );
}

function getCurrency(): SupportedCurrency {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<SupportedCurrency>('currencyFoDryRunCost') || "USD";
}

/** BigQuery requires the job location for jobs outside the US / EU multi-regions; the project's default location is the best guess. */
function defaultJobLocation(): string | undefined {
    return CACHED_COMPILED_DATAFORM_JSON?.projectConfig?.defaultLocation || undefined;
}

async function fetchJobStats(ref: BigQueryJobRef, currency: SupportedCurrency): Promise<WorkflowActionJobStats | undefined> {
    const bigquery = getBigQueryClient();
    if (!bigquery) {
        return undefined;
    }
    const location = ref.location ?? defaultJobLocation();
    const [metadata] = await bigquery.job(ref.jobId, { projectId: ref.projectId, location }).getMetadata();
    return toJobStats(metadata?.statistics, metadata?.jobReference?.location ?? location, currency);
}

/**
 * Fills in `jobStats` for finished actions of an invocation that ran a BigQuery job and have no
 * stats yet. Returns true when any action was updated.
 */
export async function loadJobStatsForInvocation(entry: WorkflowUrlEntry): Promise<boolean> {
    const pending = (entry.actions ?? []).filter((action) =>
        action.jobId && !action.jobStats && (action.state === 'SUCCEEDED' || action.state === 'FAILED')
    );
    if (pending.length === 0 || !entry.projectId) {
        return false;
    }
    await checkAuthentication();
    const currency = getCurrency();
    let updated = false;
    for (let i = 0; i < pending.length; i += JOB_STATS_CONCURRENCY) {
        await Promise.all(pending.slice(i, i + JOB_STATS_CONCURRENCY).map(async (action: WorkflowAction) => {
            try {
                const stats = await fetchJobStats(parseBigQueryJobId(action.jobId!, entry.projectId!), currency);
                if (stats) {
                    action.jobStats = stats;
                    updated = true;
                }
            } catch (error: any) {
                logger.error(`Unable to read BigQuery job ${action.jobId}: ${error.message}`);
                action.jobStats = { error: error.message };
                updated = true;
            }
        }));
    }
    if (updated) {
        entry.jobStatsSummary = summariseJobStats(entry.actions ?? [], currency);
    }
    return updated;
}

export function openBigQueryJobInConsole(entry: WorkflowUrlEntry, action: WorkflowAction) {
    if (!action.jobId || !entry.projectId) {
        return;
    }
    const ref = parseBigQueryJobId(action.jobId, entry.projectId);
    const location = ref.location ?? action.jobStats?.location ?? defaultJobLocation();
    vscode.env.openExternal(vscode.Uri.parse(bigQueryJobConsoleUrl({ ...ref, location })));
}

/** Opens the SQL Dataform executed for an action in a read-only editor beside the current one. */
export async function openExecutedSql(entry: WorkflowUrlEntry, target: string) {
    if (!entry.workflowInvocationId || !entry.projectId || !entry.location || !entry.repositoryName) {
        return;
    }
    try {
        const dataformClient = new DataformTools(entry.projectId, entry.location);
        const actions = await dataformClient.queryWorkflowInvocationActions(entry.repositoryName, entry.workflowInvocationId);
        // History saved before targets included compiler overrides stores the canonical name.
        const action = (actions ?? []).find((a) => workflowActionTarget(a) === target || workflowActionTarget({ canonicalTarget: a.canonicalTarget }) === target);
        const sqlScript = action?.bigqueryAction?.sqlScript;
        if (!sqlScript) {
            vscode.window.showInformationMessage(`No executed SQL found for ${target}`);
            return;
        }
        const uri = vscode.Uri.from({
            scheme: EXECUTED_SQL_SCHEME,
            path: `/${target}.sql`,
            query: new URLSearchParams({ invocation: entry.workflowInvocationId }).toString(),
        });
        executedSqlContents.set(uri.toString(), sqlScript);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'sql');
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch (error: any) {
        vscode.window.showErrorMessage(`Unable to fetch executed SQL: ${error.message}`);
    }
}

/**
 * `target` is the table the action actually wrote to, with compiler overrides (table prefix, schema/database
 * suffix) applied. `canonicalTarget` is the name the project would have without overrides, so it is only a fallback.
 */
export function workflowActionTarget(action: { canonicalTarget?: any, target?: any }): string {
    const tgt = action?.target || action?.canonicalTarget || {};
    const parts = [tgt.database, tgt.schema, tgt.name].filter(Boolean);
    return parts.join('.') || '(unknown)';
}

const executedSqlContents = new Map<string, string>();

export function registerExecutedSqlProvider(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EXECUTED_SQL_SCHEME, {
        provideTextDocumentContent: (uri) => executedSqlContents.get(uri.toString()) ?? '',
    }));
}
