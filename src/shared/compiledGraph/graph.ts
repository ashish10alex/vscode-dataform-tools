import type { SqlSection } from './sql';

/*
 * The Compiled Graph: the Backend-neutral result of compiling a Project (see CONTEXT.md and ADR 0002). Plain data
 * with helper functions beside it, so it can be posted from a worker or sent to a webview as it is. Each Backend
 * builds one from its own tool's output; nothing here knows Dataform or dbt, and nothing imports `vscode`.
 */

/** The table or view an action builds or stands for */
export interface Target {
    /** GCP project. Empty for a made-up Target, see `madeUpTarget` */
    database: string;
    /** Dataset */
    schema: string;
    name: string;
}

/**
 * An action's ID is its Target written `database.schema.name`, or `schema.name` without a database. For Dataform it
 * is what the CLI's `--actions` takes.
 */
export type ActionId = string;

export function targetId(target: Target): ActionId {
    return target.database ? `${target.database}.${target.schema}.${target.name}` : `${target.schema}.${target.name}`;
}

/**
 * Every Kind, in display order: a file's table, view or operation comes before the assertions and tests of it. Each
 * Backend uses the Kinds its tool has: Dataform never makes a seed, dbt never a notebook.
 */
export const KINDS = [
    'table',
    'view',
    'incremental',
    'materialized view',
    // A dbt model that is never built: it is inlined as a CTE into the models that use it
    'ephemeral',
    'seed',
    'snapshot',
    'operation',
    'assertion',
    // A dbt data test
    'test',
    // A unit test of either Backend, pointing at the action it tests with `parent`
    'unit test',
    // A dbt analysis: SQL that is compiled, never built
    'analysis',
    'notebook',
    'property graph',
    'declaration',
    // A dbt source: a table loaded outside the Project, as a Dataform declaration is
    'source',
    // A dbt exposure: a dashboard or application downstream of the Project, with no table of its own
    'exposure',
    // A placeholder for a dependency that no action in the graph defines
    'unknown',
] as const;

export type Kind = (typeof KINDS)[number];

const KIND_ORDER = new Map<Kind, number>(KINDS.map((kind, index) => [kind, index]));

/** Whether actions of the Kind are defined outside the Project: a Dataform declaration or a dbt source */
export function isExternalKind(kind: Kind): boolean {
    return kind === 'declaration' || kind === 'source';
}

/** Whether the Kind is a dbt data test or a unit test: what is shown with the action it tests */
export function isTestKind(kind: Kind): boolean {
    return kind === 'test' || kind === 'unit test';
}

/**
 * Whether an action of the Kind always builds a table or view of its own name. An operation, notebook or property
 * graph may not (see `buildsTable`), and an ephemeral model, analysis, test, unit test or exposure never does.
 */
export function kindHasTable(kind: Kind): boolean {
    switch (kind) {
        case 'operation':
        case 'notebook':
        case 'property graph':
        case 'ephemeral':
        case 'analysis':
        case 'test':
        case 'unit test':
        case 'exposure':
        case 'unknown':
            return false;
        default:
            return true;
    }
}

/**
 * The Target of an action that builds nothing (an exposure, a unit test, an analysis): named after its Kind and
 * without a database, so it still gives the action an ID. It must never be shown as a BigQuery link.
 */
export function madeUpTarget(kind: Kind, name: string): Target {
    return { database: '', schema: kind, name };
}

export function isMadeUpTarget(target: Target): boolean {
    return target.database === '';
}

/** Documents one column in an action's config. `path` has more than one element for a field nested in a RECORD */
export interface ColumnDescription {
    path: string[];
    description: string;
}

/** One thing a Project defines */
export interface Action {
    id: ActionId;
    target: Target;
    kind: Kind;
    /** Relative to the Project root with forward slashes (see `slashPath`); empty when the action has no file */
    fileName: string;
    tags: string[];
    disabled?: boolean;

    /** The action's SQL in execution order */
    sections: SqlSection[];
    /**
     * False when this compile left the action's SQL out (a dbt Project that was only parsed, or an action dbt-core
     * was not asked to compile), which is not the same as an action that has no SQL: a seed has `sqlPresent` true
     * and no sections.
     */
    sqlPresent: boolean;
    /** Set on an operation that creates the table it names */
    hasOutput?: boolean;

    description?: string;
    columns?: ColumnDescription[];

    dependencyTargets: Target[];
    /**
     * The action this one was made for: the table of an assertion Dataform generates from its config, the model of
     * a dbt test, the action a unit test tests.
     */
    parent?: Target;
    /** Its tool cannot run the action on its own, whatever its Kind: a dbt on-run hook, a disabled dbt action */
    noRun?: boolean;
}

/** Whether the action builds a table or view at its Target */
export function buildsTable(action: Action): boolean {
    if (isMadeUpTarget(action.target)) {
        return false;
    }
    return action.kind === 'operation' ? action.hasOutput === true : kindHasTable(action.kind);
}

/** Whether a run can execute the action */
export function isRunnable(action: Action): boolean {
    if (action.noRun) {
        return false;
    }
    switch (action.kind) {
        case 'declaration':
        case 'source':
        case 'exposure':
        case 'ephemeral':
        case 'analysis':
        case 'unknown':
            return false;
        default:
            return true;
    }
}

export interface CompiledGraph {
    actions: Record<ActionId, Action>;
    /** For each action, what it reads from. Sorted for display */
    dependencies: Record<ActionId, ActionId[]>;
    /** For each action, what reads from it. Sorted for display */
    dependents: Record<ActionId, ActionId[]>;
    /** For each file, the actions defined in it, in display order */
    files: Record<string, ActionId[]>;
}

/** Orders by schema.name, then database */
function compareActions(a: Action, b: Action): number {
    return compare(a.target.schema, b.target.schema) || compare(a.target.name, b.target.name) || compare(a.target.database, b.target.database);
}

/** Display order: by Kind, then as `compareActions` */
function compareForDisplay(a: Action, b: Action): number {
    return KIND_ORDER.get(a.kind)! - KIND_ORDER.get(b.kind)! || compareActions(a, b);
}

// By code unit, not by locale, so the order is the same on every machine
function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds a Compiled Graph from a Backend's actions. The first action with an ID wins. A dependency that no action
 * defines gets a placeholder of Kind "unknown".
 */
export function buildCompiledGraph(actions: Action[]): CompiledGraph {
    const graph: CompiledGraph = { actions: {}, dependencies: {}, dependents: {}, files: {} };
    const defined: Action[] = [];
    for (const action of actions) {
        if (!Object.hasOwn(graph.actions, action.id)) {
            graph.actions[action.id] = action;
            defined.push(action);
        }
    }
    for (const action of defined) {
        if (action.fileName) {
            (graph.files[action.fileName] ??= []).push(action.id);
        }
        const seen = new Set<ActionId>();
        for (const target of action.dependencyTargets) {
            const dependency = targetId(target);
            if (seen.has(dependency)) {
                continue;
            }
            seen.add(dependency);
            if (!Object.hasOwn(graph.actions, dependency)) {
                graph.actions[dependency] = { id: dependency, target, kind: 'unknown', fileName: '', tags: [], sections: [], sqlPresent: true, dependencyTargets: [] };
            }
            (graph.dependencies[action.id] ??= []).push(dependency);
            (graph.dependents[dependency] ??= []).push(action.id);
        }
    }
    const sortIds = (ids: ActionId[], order: (a: Action, b: Action) => number) => ids.sort((a, b) => order(graph.actions[a], graph.actions[b]));
    for (const ids of Object.values(graph.dependencies)) {
        sortIds(ids, compareActions);
    }
    for (const ids of Object.values(graph.dependents)) {
        sortIds(ids, compareActions);
    }
    for (const ids of Object.values(graph.files)) {
        sortIds(ids, compareForDisplay);
    }
    return graph;
}

function lookup(graph: CompiledGraph, ids: ActionId[] | undefined): Action[] {
    return (ids ?? []).map((id) => graph.actions[id]);
}

/** The actions the given action reads from */
export function dependenciesOf(graph: CompiledGraph, id: ActionId): Action[] {
    return lookup(graph, graph.dependencies[id]);
}

/** The actions that read from the given action */
export function dependentsOf(graph: CompiledGraph, id: ActionId): Action[] {
    return lookup(graph, graph.dependents[id]);
}

/**
 * The actions defined in `fileName` (relative to the Project root, with forward slashes), in display order: the
 * file's main table, view or operation comes before the assertions generated from it.
 */
export function actionsInFile(graph: CompiledGraph, fileName: string): Action[] {
    return lookup(graph, graph.files[fileName]);
}

/**
 * The action a dbt test or a unit test is shown with: the one it is attached to (`parent`), else the only one it
 * reads that the Project builds. Undefined when there is no single one, or when `action` is not a test.
 */
export function homeAction(graph: CompiledGraph, action: Action): Action | undefined {
    if (!isTestKind(action.kind)) {
        return undefined;
    }
    if (action.parent) {
        const parent = graph.actions[targetId(action.parent)];
        if (parent && parent.kind !== 'unknown') {
            return parent;
        }
    }
    let home: Action | undefined;
    for (const dependency of dependenciesOf(graph, action.id)) {
        if (dependency.kind === 'unknown' || isExternalKind(dependency.kind) || isTestKind(dependency.kind)) {
            continue;
        }
        if (home) {
            return undefined;
        }
        home = dependency;
    }
    return home;
}

/**
 * What is shown together with `action`: the actions defined in its file and the tests that read any of them (a dbt
 * model's generic, singular and unit tests, which live in other files), in display order. A test is shown with its
 * `homeAction` when it has one. An action with no file is alone.
 */
export function siblingsOf(graph: CompiledGraph, action: Action): Action[] {
    if (isTestKind(action.kind)) {
        const home = homeAction(graph, action);
        if (home) {
            action = home;
        } else if (action.fileName) {
            return actionsInFile(graph, action.fileName);
        }
    }
    if (!action.fileName) {
        return [action];
    }
    const siblings = actionsInFile(graph, action.fileName);
    const shown = new Set(siblings);
    for (const sibling of [...siblings]) {
        if (isTestKind(sibling.kind)) {
            continue;
        }
        for (const dependent of dependentsOf(graph, sibling.id)) {
            if (isTestKind(dependent.kind) && !shown.has(dependent)) {
                shown.add(dependent);
                siblings.push(dependent);
            }
        }
    }
    return siblings.sort(compareForDisplay);
}
