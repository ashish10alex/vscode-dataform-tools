import * as vscode from 'vscode';
import crypto from 'crypto';
import { logger } from '../logger';
import { queryDryRun } from '../bigqueryDryRun';
import { ChangedActionsResult } from '../changedActions';
import { resolveDeferralForActions } from '../defer';
import { rewriteSql } from '../defer/deferRules';
import { DataformCompiledJson, Target } from '../types';
import { targetKey } from '../utils/compiledGraphDiff';
import { GraphAction, indexGraph } from '../shared/columnLineage/graphLinks';
import { inBatches } from '../shared/columnLineage/traceController';
import { SchemaField } from '../shared/columnLineage/impactRules';
import { CachedTraceSource } from '../shared/columnLineage/cachedSource';
import { ImpactCandidate, ImpactView, buildImpactSummary } from '../shared/columnLineage/impactSummary';
import { tableActions } from '../shared/columnLineage/tableActions';
import { DataplexTraceSource } from './dataplexSource';
import { indexByProdTarget } from './prodIndex';
import { SchemaCache } from './schemaCache';

/*
 * The column impact of a branch: every table, view and incremental table it changes is dry run and compared with its
 * Prod Target, and Dataplex is asked who reads the columns it drops or retypes and the tables it deletes.
 */

/** Dry runs started at once; queryDryRun also caps them across the extension */
const DRY_RUN_BATCH = 6;
const TABLE_TYPES = new Set(['table', 'view', 'incremental']);

interface CompiledAction {
    target?: Target;
    type?: string;
    fileName?: string;
    hasOutput?: boolean;
    query?: string;
    preOps?: string[];
    queries?: string[];
    dependencyTargets?: Target[];
}

function compiledActions(graph: DataformCompiledJson): Map<string, CompiledAction> {
    const actions = new Map<string, CompiledAction>();
    for (const action of [...(graph.tables ?? []), ...(graph.operations ?? [])] as CompiledAction[]) {
        if (action.target) {
            actions.set(targetKey(action.target), action);
        }
    }
    return actions;
}

/** Everything the action runs, for checking whether it still names a column */
function actionSql(action: CompiledAction): string {
    return [...(action.preOps ?? []), action.query ?? '', ...(action.queries ?? [])].join('\n');
}

/** The query whose schema the table gets: an incremental table's is its non-incremental query */
function dryRunQuery(action: CompiledAction, skipPreOps: boolean): string {
    const preOps = (action.preOps ?? []).join('\n').trim();
    const query = action.query ?? '';
    if (skipPreOps || !preOps) {
        return query;
    }
    return `${/;\s*$/.test(preOps) ? preOps : `${preOps};`}\n${query}`;
}

/**
 * A deleted action has no Prod Target, since prod is compiled from this branch. Its prod dataset is taken from
 * another action that shared its dev dataset, which covers schema suffixes and dev databases.
 */
export function guessProdTarget(deleted: string, devToProd: [string, string][]): string {
    const [database, schema, name] = deleted.split('.');
    const sibling = devToProd.find(([dev]) => {
        const [devDatabase, devSchema] = dev.split('.');
        return devDatabase === database && devSchema === schema;
    });
    if (!sibling) {
        return deleted;
    }
    const [prodDatabase, prodSchema] = sibling[1].split('.');
    return `${prodDatabase}.${prodSchema}.${name}`;
}

/** Changes when the branch's changed actions or their compiled SQL do, so a summary can tell it's out of date */
export function changeSignature(result: Pick<ChangedActionsResult, 'changed' | 'deleted'>, head: DataformCompiledJson): string {
    const actions = compiledActions(head);
    const hash = crypto.createHash('sha1');
    for (const change of result.changed) {
        const action = actions.get(change.target);
        hash.update(`${change.target}\n${action ? actionSql(action) : ''}\n${JSON.stringify(change.reasons)}\n`);
    }
    result.deleted.forEach((action) => hash.update(`-${action.target}\n`));
    return hash.digest('hex');
}

export interface ImpactRunResult {
    view: ImpactView;
    source?: CachedTraceSource;
    resolveFile: (table: string) => string | undefined;
}

/**
 * Works out the impact of `result`, a diff of `head` against the merge-base. `emit` is told how far it got;
 * once `cancelled` returns true nothing more starts and the view is returned as cancelled.
 */
export async function computeColumnImpact(
    workspaceFolder: string,
    result: ChangedActionsResult,
    head: DataformCompiledJson,
    emit: (view: ImpactView) => void,
    cancelled: () => boolean,
): Promise<ImpactRunResult> {
    const comparison = { headRef: result.headRef, baseRef: result.baseRef, mergeBaseSha: result.mergeBaseSha, headLabel: result.headLabel };
    const base: Omit<ImpactView, 'status'> = { comparison, changedCount: 0, atRisk: [], safe: [], unchecked: [] };
    const devIndex = indexGraph(head);
    const { index, toProd } = await indexByProdTarget(devIndex);
    const resolveFile = (table: string) => index.get(table)?.fileName;
    const actions = compiledActions(head);

    const changed = result.changed.filter((change) => {
        const action = devIndex.get(change.target);
        return !!action && tableActions([action as GraphAction & { hasOutput?: boolean }]).length > 0;
    });
    const deleted = result.deleted.filter((action) => TABLE_TYPES.has(action.type));
    const total = changed.length + deleted.length;
    const view = (status: ImpactView['status'], extra: Partial<ImpactView> = {}): ImpactView => ({ ...base, changedCount: total, status, ...extra });

    const schemas = new SchemaCache();
    const skipPreOps = vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('skipPreOpsInDryRun') === true;
    // Read upstream tables the way a dry run of the file would, so a dev table that was never built doesn't fail it
    const selected = changed.map((change) => actions.get(change.target)).filter((action): action is CompiledAction => !!action);
    let deferral: Awaited<ReturnType<typeof resolveDeferralForActions>>;
    try {
        deferral = await resolveDeferralForActions(selected, head, workspaceFolder);
    } catch (error: any) {
        logger.error(`Column impact: defer to prod not applied: ${error?.message ?? error}`);
    }

    const candidates: ImpactCandidate[] = [];
    let done = 0;
    emit(view('running', { progress: { phase: 'Dry running', done, total: changed.length } }));
    await inBatches(changed, DRY_RUN_BATCH, async (change) => {
        if (cancelled()) {
            return;
        }
        const table = toProd(change.target);
        const action = actions.get(change.target);
        const type = action?.type ?? change.type;
        const candidate: ImpactCandidate = { table, fileName: change.fileName, type };
        const prod = await schemas.schema(table);
        if (!prod?.length) {
            candidate.uncheckedReason = 'no prod table yet';
        } else if (type === 'operations' || type === 'operation') {
            candidate.uncheckedReason = 'operation: a dry run of a script has no schema';
        } else if (!action) {
            candidate.uncheckedReason = 'not in the compiled project';
        } else {
            const query = rewriteSql(dryRunQuery(action, skipPreOps), deferral?.entries ?? []);
            const dryRun = await queryDryRun(query);
            const fields: SchemaField[] = (dryRun.schema?.fields ?? []).filter((field: SchemaField) => field.name);
            if (dryRun.error?.hasError) {
                candidate.uncheckedReason = `dry run failed: ${dryRun.error.message}`;
            } else if (!fields.length) {
                candidate.uncheckedReason = 'the dry run returned no schema';
            } else {
                candidate.prod = prod;
                candidate.dev = fields;
            }
        }
        candidates.push(candidate);
        emit(view('running', { progress: { phase: 'Dry running', done: ++done, total: changed.length } }));
    });
    if (cancelled()) {
        return { view: view('cancelled'), resolveFile };
    }

    const devToProd: [string, string][] = [...devIndex.keys()].map((dev) => [dev, toProd(dev)]);
    for (const action of deleted) {
        const table = guessProdTarget(action.target, devToProd);
        const prod = await schemas.schema(table);
        candidates.push(prod?.length
            ? { table, fileName: action.fileName, type: action.type, deleted: true }
            : { table, fileName: action.fileName, type: action.type, uncheckedReason: 'deleted, and no prod table found' });
    }

    const changedProd = new Set(changed.map((change) => toProd(change.target)));
    const sqlByProd = new Map(changed.map((change) => {
        const action = actions.get(change.target);
        return [toProd(change.target), action ? actionSql(action) : undefined] as const;
    }));
    const source = new CachedTraceSource(new DataplexTraceSource(schemas, index));
    const summary = await buildImpactSummary(
        candidates,
        source,
        { resolveFile, changed: changedProd, sqlOf: (table) => sqlByProd.get(table) },
        (lookups, of) => emit(view('running', { progress: { phase: 'Looking up readers', done: lookups, total: of } })),
        cancelled,
    );
    if (!summary) {
        return { view: view('cancelled'), resolveFile };
    }
    return { view: view('ready', { ...summary, checkedAt: Date.now() }), source, resolveFile };
}
