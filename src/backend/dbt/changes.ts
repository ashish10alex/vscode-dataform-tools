import path from 'path';
import { ActionId, isRunnable } from '../../shared/compiledGraph';
import type { BackendRequest, ChangeReason, ChangedAction, ChangedActions } from '../backend';
import { invocationErrors } from './errors';
import { DbtManifest, DbtName, buildDbtGraph, dbtActionIds } from './graph';
import { DbtRunOptions, invokeDbt } from './invoke';
import { readManifestChanges } from './manifest';

/*
 * Changed Actions of a dbt Project. dbt decides which actions changed: `dbt ls --select state:modified` against the
 * manifest of the Project at the base (`--state`), which a `dbt parse` of a copy of the base wrote. Why each one
 * changed is read from the two manifests, so that the listing is one dbt command.
 *
 * Both engines were checked (dbt-core 1.12, dbt v2 2.0): they list the same actions, and with a JSON log each row of
 * the listing is a `PrintEvent` whose message is the row.
 */

/** The directory `--state` takes for a base that was parsed into `artifactDir` */
export function stateDirIn(artifactDir: string): string {
    return path.join(artifactDir, 'target');
}

/**
 * The arguments, after dbt's own, that list what changed since the manifest in `stateDir`. Without tests that did
 * not change themselves: dbt adds the tests of every action it selects (`--indirect-selection eager`), which a run
 * wants and a list of what changed does not.
 */
export function dbtChangesArguments(stateDir: string): string[] {
    return ['--select', 'state:modified', '--state', stateDir, '--indirect-selection', 'empty', '--output', 'json', '--output-keys', 'unique_id'];
}

/** dbt's IDs of the resources a `dbt ls` listed, from its JSON log */
export function listedIds(stdout: string): string[] {
    const ids: string[] = [];
    for (const line of stdout.split('\n')) {
        if (!line.includes('PrintEvent')) {
            continue;
        }
        try {
            const event = JSON.parse(line) as { info?: { name?: string }; data?: { msg?: string } };
            const id = event.info?.name === 'PrintEvent' && event.data?.msg ? (JSON.parse(event.data.msg) as { unique_id?: unknown }).unique_id : undefined;
            if (typeof id === 'string') {
                ids.push(id);
            }
        } catch {
            // Not a row of the listing
        }
    }
    return ids;
}

/** The Changed Actions of a dbt Project, with what dbt calls each changed one, for a run that selects some of them */
export interface DbtChangedActions extends ChangedActions {
    names: Record<ActionId, DbtName>;
}

/** The part of a manifest's resource that says why dbt finds it changed */
interface Compared {
    checksum?: unknown;
    config?: unknown;
    unrendered_config?: unknown;
    depends_on?: { macros?: string[] | null } | null;
}

interface ComparedMacro {
    macro_sql?: string | null;
    depends_on?: { macros?: string[] | null } | null;
}

/** JSON with the keys of every object sorted, so that two values are equal when their text is */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, inner: unknown) =>
        inner && typeof inner === 'object' && !Array.isArray(inner)
            ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
            : inner) ?? '';
}

/** The settings dbt compares: as the Project wrote them, where the manifest keeps that, so that a dbt target's own values never count */
function settingsOf(resource: Compared): string {
    return canonical(resource.unrendered_config ?? resource.config ?? null);
}

/**
 * Says of each macro whether it differs from the base: its own text, or that of a macro it calls. A macro the base
 * does not have differs.
 */
function macroDiffers(base: DbtManifest, head: DbtManifest): (id: string) => boolean {
    const baseMacros = (base.macros ?? {}) as Record<string, ComparedMacro | undefined>;
    const headMacros = (head.macros ?? {}) as Record<string, ComparedMacro | undefined>;
    // Those whose own text differs, then every macro that calls one that differs: macros that call each other end
    const differing = new Set<string>();
    const callers = new Map<string, string[]>();
    for (const [id, macro] of Object.entries(headMacros)) {
        if (!macro) {
            continue;
        }
        if (baseMacros[id]?.macro_sql !== macro.macro_sql) {
            differing.add(id);
        }
        for (const called of macro.depends_on?.macros ?? []) {
            callers.set(called, [...(callers.get(called) ?? []), id]);
        }
    }
    const reached = [...differing];
    for (let id = reached.pop(); id !== undefined; id = reached.pop()) {
        for (const caller of callers.get(id) ?? []) {
            if (!differing.has(caller)) {
                differing.add(caller);
                reached.push(caller);
            }
        }
    }
    return (id) => differing.has(id);
}

/**
 * The Changed Actions of `head` against `base`, given the resources dbt listed as changed (`selected`, dbt's IDs).
 * Only what a run can execute is kept: dbt also lists a changed source or exposure, which a run builds nothing of.
 *
 * Why an action changed: it is not in the base (new), its checksum differs (sql), a macro it calls differs (macro),
 * or its settings differ (config). dbt compares more than these, such as a contract or a description that is
 * persisted, so an action it listed for none of them is given `config`.
 */
export function manifestChanges(base: DbtManifest, head: DbtManifest, selected: string[]): DbtChangedActions {
    const { graph, dbt } = buildDbtGraph(head);
    const ids = dbtActionIds(head);
    const baseResources = { ...(base.nodes ?? {}), ...(base.unit_tests ?? {}) } as Record<string, Compared | undefined>;
    const headResources = { ...(head.nodes ?? {}), ...(head.unit_tests ?? {}) } as Record<string, Compared | undefined>;
    const differs = macroDiffers(base, head);
    const describe = (action: { id: ActionId; target: ChangedAction['target']; kind: ChangedAction['kind']; fileName: string }): ChangedAction =>
        ({ id: action.id, target: action.target, kind: action.kind, fileName: action.fileName });

    const result: DbtChangedActions = { changed: [], deleted: [], names: {} };
    const seen = new Set<ActionId>();
    for (const uniqueId of selected) {
        const id = ids.get(uniqueId);
        const action = id === undefined ? undefined : graph.actions[id];
        const name = id === undefined ? undefined : dbt.names[id];
        const resource = headResources[uniqueId];
        if (!action || !name?.qualifiedName || !resource || !isRunnable(action) || seen.has(action.id)) {
            continue;
        }
        seen.add(action.id);
        const before = baseResources[uniqueId];
        const reasons: ChangeReason[] = [];
        if (!before) {
            reasons.push('new');
        } else {
            if (canonical(resource.checksum ?? null) !== canonical(before.checksum ?? null)) {
                reasons.push('sql');
            }
            if (settingsOf(resource) !== settingsOf(before)) {
                reasons.push('config');
            }
            if ((resource.depends_on?.macros ?? []).some(differs)) {
                reasons.push('macro');
            }
            if (reasons.length === 0) {
                reasons.push('config');
            }
        }
        result.changed.push({ ...describe(action), reasons });
        result.names[action.id] = name;
    }

    const baseGraph = buildDbtGraph(base).graph;
    for (const action of Object.values(baseGraph.actions)) {
        if (isRunnable(action) && !Object.hasOwn(graph.actions, action.id)) {
            result.deleted.push(describe(action));
        }
    }
    const byFile = (a: ChangedAction, b: ChangedAction) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    result.changed.sort(byFile);
    result.deleted.sort(byFile);
    return result;
}

function failure(what: string, errors: Array<{ fileName?: string; message: string }>): Error {
    const details = errors.slice(0, 3).map((error) => (error.fileName ? `${error.fileName}: ${error.message}` : error.message)).join('\n');
    return new Error(`${what}: ${details || 'dbt reported no error'}`);
}

/**
 * Parses a copy of the Project as it is at the base, at `request.root`, into `options.artifactDir`, and gives the
 * directory `--state` takes for it. Rejects with what dbt reported when the base does not parse.
 */
export async function parseDbtBase(request: Pick<BackendRequest<DbtRunOptions>, 'root' | 'options' | 'logger' | 'signal'>): Promise<string> {
    const invocation = await invokeDbt(request, 'parse');
    if (invocation.exitCode !== 0 || !invocation.manifestPath) {
        throw failure('dbt could not parse the Project at the base', invocationErrors(invocation));
    }
    return stateDirIn(request.options.artifactDir);
}

/** Installs the packages of the copy of the Project at `request.root` (`dbt deps`). Rejects with what dbt reported when it fails */
export async function installDbtPackages(request: Pick<BackendRequest<DbtRunOptions>, 'root' | 'options' | 'logger' | 'signal'>): Promise<void> {
    const invocation = await invokeDbt(request, 'deps');
    if (invocation.exitCode !== 0) {
        throw failure('dbt could not install the packages of the Project at the base', invocationErrors(invocation));
    }
}

/**
 * Lists the Changed Actions of the Project at `request.root` against the base parsed into `base` (`parseDbtBase`).
 * dbt parses the Project as its files are now, into `options.artifactDir`, which must not be where compiles write:
 * the two would run over each other.
 */
export async function listDbtChanges(request: Pick<BackendRequest<DbtRunOptions>, 'root' | 'options' | 'logger' | 'signal'> & { base: string }): Promise<DbtChangedActions> {
    const invocation = await invokeDbt(request, 'ls', dbtChangesArguments(request.base));
    if (invocation.exitCode !== 0 || !invocation.manifestPath) {
        throw failure('dbt could not list what changed', invocationErrors(invocation));
    }
    return readManifestChanges(invocation.manifestPath, path.join(request.base, 'manifest.json'), listedIds(invocation.stdout), request.signal);
}
