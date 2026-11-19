import crypto from 'crypto';
import { logger } from '../logger';
import { queryDryRun } from '../bigqueryDryRun';
import { ChangedActionsResult, baseGraphOf } from '../changedActions';
import { resolveDeferralForActions } from '../defer';
import { rewriteSql } from '../defer/deferRules';
import { DataformCompiledJson, Target } from '../types';
import { targetKey } from '../utils/compiledGraphDiff';
import { GraphAction, indexGraph } from '../shared/columnLineage/graphLinks';
import { inBatches } from '../shared/columnLineage/traceController';
import { SchemaField, diffSchemas } from '../shared/columnLineage/impactRules';
import { CachedTraceSource } from '../shared/columnLineage/cachedSource';
import { ImpactCandidate, ImpactView, buildImpactSummary, projectsOf, sortTables } from '../shared/columnLineage/impactSummary';
import { verifyReaders } from './verifyReaders';
import { tableActions } from '../shared/columnLineage/tableActions';
import { DataplexTraceSource } from './dataplexSource';
import { resolveProdIndex } from './prodIndex';
import { isProdCompilerOptionsSet } from '../defer/prodTargets';
import { SchemaCache } from './schemaCache';
import { extensionConfiguration } from '../project/settings';

/*
 * The column impact of a branch: every table, view and incremental table it changes is dry run and compared with its
 * Prod Target, and Dataplex is asked who reads the columns it drops or retypes and the tables it deletes.
 */

/** Dry runs started at once; queryDryRun also caps them across the extension */
const DRY_RUN_BATCH = 6;
const TABLE_TYPES = new Set(['table', 'view', 'incremental']);

export interface CompiledAction {
    target?: Target;
    type?: string;
    fileName?: string;
    hasOutput?: boolean;
    query?: string;
    incrementalQuery?: string;
    preOps?: string[];
    postOps?: string[];
    incrementalPreOps?: string[];
    incrementalPostOps?: string[];
    queries?: string[];
    dependencyTargets?: Target[];
    uniqueKey?: string[];
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

/** Everything the action runs, incremental runs included, for checking whether it still names a column */
function actionSql(action: CompiledAction): string {
    return [
        ...(action.preOps ?? []),
        action.query ?? '',
        ...(action.postOps ?? []),
        ...(action.incrementalPreOps ?? []),
        action.incrementalQuery ?? '',
        ...(action.incrementalPostOps ?? []),
        ...(action.queries ?? []),
    ].join('\n');
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
 * another action that shared its dev dataset, which covers schema suffixes and dev databases. Undefined when no
 * action did.
 */
export function guessProdTarget(deleted: string, devToProd: [string, string][]): string | undefined {
    const [database, schema, name] = deleted.split('.');
    const sibling = devToProd.find(([dev]) => {
        const [devDatabase, devSchema] = dev.split('.');
        return devDatabase === database && devSchema === schema;
    });
    if (!sibling) {
        return undefined;
    }
    const [prodDatabase, prodSchema] = sibling[1].split('.');
    return `${prodDatabase}.${prodSchema}.${name}`;
}

/** Why an action with no Prod Target isn't compared */
export const UNKNOWN_PROD_TARGET = 'its prod table is unknown: nothing in the compile with prodCompilerOptions matches it';

function project(table: string): string {
    return table.split('.')[0];
}

/** A table's columns in BigQuery, or why it couldn't be read; neither when there is no such table */
export type TableRead = { columns?: SchemaField[]; error?: string };

export interface CheckDeps {
    /** The Prod Target of a dev target; undefined when it has none */
    prodTarget: (dev: string) => string | undefined;
    read: (table: string) => Promise<TableRead>;
    /** The dry run's columns, or why it failed */
    dryRun: (action: CompiledAction) => Promise<{ fields: SchemaField[]; error?: string }>;
    /** The action with dev target `target` as it is at the merge-base; undefined when there is no base, or it has no such action */
    baseAction?: (target: string) => CompiledAction | undefined;
}

/** A Dataform incremental table, whose incremental run names every column its table has, and its uniqueKey */
function incrementalRun(action: CompiledAction | undefined): { ownRun?: boolean; uniqueKey?: string[] } {
    return action?.type === 'incremental' ? { ownRun: true, ...(action.uniqueKey?.length ? { uniqueKey: action.uniqueKey } : {}) } : {};
}

/**
 * The schema of a dry run of the action with dev target `target` as it is at the merge-base, with its incremental
 * run; undefined when there is no telling: no base, an action it doesn't have or can't dry run, or a failed dry run.
 */
async function baseSchema(target: string, deps: CheckDeps): Promise<Pick<ImpactCandidate, 'base' | 'baseOwnRun' | 'baseUniqueKey'> | undefined> {
    const action = deps.baseAction?.(target);
    if (!action || action.type === 'operations' || action.type === 'operation') {
        return undefined;
    }
    const dryRun = await deps.dryRun(action);
    if (dryRun.error || !dryRun.fields.length) {
        return undefined;
    }
    const { ownRun, uniqueKey } = incrementalRun(action);
    return { base: dryRun.fields, ...(ownRun ? { baseOwnRun: true } : {}), ...(uniqueKey ? { baseUniqueKey: uniqueKey } : {}) };
}

type ActionRef = { target: string; fileName?: string; type: string; reasons?: string[]; renamedFrom?: string; renamedTo?: string };

/**
 * Reads a changed table's Prod Target and dry runs it. `action`: the changed action in the head compile. An
 * action the base doesn't have, with no table yet, has nothing to compare and isn't dry run. `oldTable`: the Prod
 * Target of the deleted action a renamed one was, which it is compared with while its own table isn't built yet.
 */
export async function checkChanged(change: ActionRef, action: CompiledAction | undefined, deps: CheckDeps, oldTable?: string): Promise<ImpactCandidate> {
    const type = action?.type ?? change.type;
    const table = deps.prodTarget(change.target);
    const renamedFrom = change.renamedFrom ? { renamedFrom: oldTable ?? change.renamedFrom } : {};
    if (!table) {
        return { table: change.target, fileName: change.fileName, type, uncheckedReason: UNKNOWN_PROD_TARGET, ...renamedFrom };
    }
    const candidate: ImpactCandidate = { table, fileName: change.fileName, type, ...renamedFrom, ...incrementalRun(action) };
    if (change.reasons?.includes('new')) {
        candidate.new = true;
    }
    let prod = await deps.read(table);
    if (!prod.error && !prod.columns?.length && candidate.new && change.renamedFrom && oldTable) {
        // Its table is yet to be built: what it replaces is the table of the action it was renamed from
        const old = await deps.read(oldTable);
        if (old.error) {
            return { ...candidate, uncheckedReason: `renamed from ${oldTable}, and ${oldTable} could not be read: ${old.error}` };
        }
        if (old.columns?.length) {
            prod = old;
            candidate.target = oldTable;
            candidate.fromOld = true;
        }
    }
    if (prod.error) {
        candidate.uncheckedReason = `${table} could not be read: ${prod.error}`;
    } else if (!prod.columns?.length) {
        if (candidate.new) {
            candidate.noTable = true;
        } else {
            candidate.uncheckedReason = `no table in ${project(table)} yet`;
        }
    } else if (type === 'operations' || type === 'operation') {
        candidate.uncheckedReason = 'operation: a dry run of a script has no schema';
    } else if (!action) {
        candidate.uncheckedReason = 'not in the compiled project';
    } else {
        const dryRun = await deps.dryRun(action);
        if (dryRun.error) {
            candidate.uncheckedReason = `dry run failed: ${dryRun.error}`;
        } else if (!dryRun.fields.length) {
            candidate.uncheckedReason = 'the dry run returned no schema';
        } else {
            candidate.prod = prod.columns;
            candidate.dev = dryRun.fields;
            // A change the action at the merge-base makes too is the base branch's, not this one's
            if (diffSchemas(dryRun.fields, prod.columns).length && (candidate.fromOld || !candidate.new)) {
                Object.assign(candidate, await baseSchema(candidate.fromOld ? change.renamedFrom! : change.target, deps));
            }
        }
    }
    return candidate;
}

/**
 * Reads a deleted table's guessed Prod Target, `table`; undefined when it has none. `renamedTo`: the Prod Target
 * of the new action a renamed one became.
 */
export async function checkDeleted(action: ActionRef, table: string | undefined, read: CheckDeps['read'], renamedTo?: string): Promise<ImpactCandidate> {
    const { fileName, type } = action;
    const to = action.renamedTo ? { renamedTo: renamedTo ?? action.renamedTo } : {};
    const gone = to.renamedTo ? `renamed to ${to.renamedTo}` : 'deleted';
    if (!table) {
        return { table: action.target, fileName, type, uncheckedReason: `${gone}, and ${UNKNOWN_PROD_TARGET}`, ...to };
    }
    const prod = await read(table);
    if (prod.error) {
        return { table, fileName, type, uncheckedReason: `${gone}, and ${table} could not be read: ${prod.error}`, ...to };
    }
    return prod.columns?.length
        ? { table, fileName, type, deleted: true, ...(action.target !== table ? { named: action.target } : {}), ...to }
        : { table, fileName, type, uncheckedReason: `${gone}, and no table in ${project(table)}`, ...to };
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
    const base: Omit<ImpactView, 'status'> = { comparison, changedCount: 0, atRisk: [], safe: [], new: [], unchecked: [] };
    const devIndex = indexGraph(head);
    const actions = compiledActions(head);
    const changed = result.changed.filter((change) => {
        const action = devIndex.get(change.target);
        return !!action && tableActions([action as GraphAction & { hasOutput?: boolean }]).length > 0;
    });
    const deleted = result.deleted.filter((action) => TABLE_TYPES.has(action.type));
    const total = changed.length + deleted.length;
    const view = (status: ImpactView['status'], extra: Partial<ImpactView> = {}): ImpactView => ({ ...base, changedCount: total, status, ...extra });

    let prodIndex: Awaited<ReturnType<typeof resolveProdIndex>>;
    try {
        prodIndex = await resolveProdIndex(devIndex);
    } catch (error: any) {
        // Comparing with the dev tables instead would pass them off as prod
        const message = error?.message ?? String(error);
        logger.error(`Column impact: could not resolve Prod Targets: ${message}`);
        return { view: view('error', { message: `Nothing was checked: the prod tables to compare with are unknown. ${message}` }), resolveFile: () => undefined };
    }
    const { index, toProd, prodTarget } = prodIndex;
    const resolveFile = (table: string) => index.get(table)?.fileName;

    const schemas = new SchemaCache();
    const skipPreOps = extensionConfiguration().get<boolean>('skipPreOpsInDryRun') === true;
    // Read upstream tables the way a dry run of the file would, so a dev table that was never built doesn't fail it
    const selected = changed.map((change) => actions.get(change.target)).filter((action): action is CompiledAction => !!action);
    let deferral: Awaited<ReturnType<typeof resolveDeferralForActions>>;
    try {
        deferral = await resolveDeferralForActions(selected, head, workspaceFolder);
    } catch (error: any) {
        logger.error(`Column impact: defer to prod not applied: ${error?.message ?? error}`);
    }
    const baseActions = (() => {
        const graph = baseGraphOf(result);
        return graph ? compiledActions(graph) : undefined;
    })();
    const deps: CheckDeps = {
        baseAction: (target) => baseActions?.get(target),
        prodTarget,
        read: (table) => schemas.read(table),
        dryRun: async (action) => {
            const dryRun = await queryDryRun(rewriteSql(dryRunQuery(action, skipPreOps), deferral?.entries ?? []));
            const fields: SchemaField[] = (dryRun.schema?.fields ?? []).filter((field: SchemaField) => field.name);
            return dryRun.error?.hasError ? { fields, error: dryRun.error.message } : { fields };
        },
    };

    const devToProd = [...devIndex.keys()].flatMap((dev): [string, string][] => {
        const prod = prodTarget(dev);
        return prod ? [[dev, prod]] : [];
    });
    // Every deleted action, assertions and operations too, by dev target: readers may be any of them, in prod or a dev run
    const deletedToProd = new Map(result.deleted.map((action) => [action.target, guessProdTarget(action.target, devToProd) ?? prodTarget(action.target)]));

    const candidates: ImpactCandidate[] = [];
    let done = 0;
    emit(view('running', { progress: { phase: 'Dry running', done, total: changed.length } }));
    await inBatches(changed, DRY_RUN_BATCH, async (change) => {
        if (cancelled()) {
            return;
        }
        const oldTable = change.renamedFrom ? deletedToProd.get(change.renamedFrom) : undefined;
        candidates.push(await checkChanged(change, actions.get(change.target), deps, oldTable));
        emit(view('running', { progress: { phase: 'Dry running', done: ++done, total: changed.length } }));
    });
    if (cancelled()) {
        return { view: view('cancelled'), resolveFile };
    }

    for (const action of deleted) {
        const renamedTo = action.renamedTo ? prodTarget(action.renamedTo) : undefined;
        candidates.push(await checkDeleted(action, deletedToProd.get(action.target), deps.read, renamedTo));
    }
    // What the candidates were compared with: those with no Prod Target weren't
    const compared = [...changed.map((change) => prodTarget(change.target)), ...deleted.map((action) => deletedToProd.get(action.target))]
        .filter((table): table is string => !!table);

    // Readers may be dev runs of any action, deleted ones too
    const readerToProd = (table: string) => deletedToProd.get(table) ?? toProd(table);
    const deletedTables = new Set(result.deleted.map((action) => deletedToProd.get(action.target) ?? action.target));
    const changedProd = new Set(changed.map((change) => toProd(change.target)));
    // A renamed reader is judged by its new SQL, under its new name
    const renamed = new Map(result.deleted.flatMap((action): [string, string][] => {
        const from = deletedToProd.get(action.target);
        const to = action.renamedTo ? toProd(action.renamedTo) : undefined;
        return from && to && changedProd.has(to) ? [[from, to]] : [];
    }));
    const sqlByProd = new Map(changed.map((change) => {
        const action = actions.get(change.target);
        return [toProd(change.target), action ? actionSql(action) : undefined] as const;
    }));
    const source = new CachedTraceSource(new DataplexTraceSource(schemas, index, readerToProd));
    const summary = await buildImpactSummary(
        candidates,
        source,
        {
            resolveFile,
            changed: changedProd,
            sqlOf: (table) => sqlByProd.get(table),
            toProd: readerToProd,
            deleted: deletedTables,
            isAssertion: (table) => index.get(table)?.type === 'assertion',
            renamed,
        },
        (lookups, of) => emit(view('running', { progress: { phase: 'Looking up readers', done: lookups, total: of } })),
        cancelled,
    );
    if (!summary) {
        return { view: view('cancelled'), resolveFile };
    }

    // A changed reader that still names a dropped column is dry run with the changed table's query swapped in
    const prodToDev = new Map(devToProd.map(([dev, prod]) => [prod, dev]));
    const actionOf = (prod: string) => actions.get(prodToDev.get(prod) ?? prod);
    const readers = summary.atRisk.flatMap((table) => table.columns.flatMap((column) => column.readers.filter((reader) => reader.stillNamed)));
    let readerEntries = deferral?.entries ?? [];
    if (readers.length) {
        try {
            const readerActions = readers.map((reader) => actionOf(reader.table)).filter((action): action is CompiledAction => !!action);
            readerEntries = [...readerEntries, ...((await resolveDeferralForActions(readerActions, head, workspaceFolder))?.entries ?? [])];
        } catch (error: any) {
            logger.error(`Column impact: defer to prod not applied to readers: ${error?.message ?? error}`);
        }
    }
    await verifyReaders(summary.atRisk, {
        readerSql: (reader) => {
            const action = actionOf(reader);
            return action && action.type !== 'operations' && action.type !== 'operation' ? dryRunQuery(action, skipPreOps) : undefined;
        },
        changedTable: (table) => {
            const action = actionOf(table);
            return action?.target && action.query ? { target: action.target, query: action.query } : undefined;
        },
        dryRun: async (_reader, sql) => {
            const dryRun = await queryDryRun(rewriteSql(sql, readerEntries));
            return dryRun.error?.hasError ? dryRun.error.message ?? 'the dry run failed' : undefined;
        },
    }, (done, of) => emit(view('running', { progress: { phase: 'Dry running readers', done, total: of } })), cancelled);
    if (cancelled()) {
        return { view: view('cancelled'), resolveFile };
    }
    summary.atRisk = sortTables(summary.atRisk);

    // Nothing sets prodCompilerOptions: the summary says it compared with the default targets
    const unset = isProdCompilerOptionsSet(workspaceFolder) ? {} : { unset: 'prodCompilerOptions' };
    return { view: view('ready', { ...summary, ...unset, against: projectsOf(compared), checkedAt: Date.now() }), source, resolveFile };
}
