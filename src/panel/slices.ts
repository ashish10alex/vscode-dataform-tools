import { Backend, CompileError, affectsCompile, backendParts } from '../backend';
import type { DbtProjectData } from '../backend/dbt';
import type { DryRunResult } from '../bigquery/dryRunService';
import { SETTINGS_FILES } from '../project/detection';
import type { Tool } from '../project/tools';
import {
    Action,
    ActionId,
    CompiledGraph,
    Kind,
    RunOptions,
    actionsInFile,
    buildsTable,
    dependenciesOf,
    dependentsOf,
    homeAction,
    isMadeUpTarget,
    isRunnable,
    siblingsOf,
    targetId,
} from '../shared/compiledGraph';
import type {
    ActionReference,
    BigQuerySlice,
    CompileNumber,
    CompileStatus,
    DbtBlock,
    DryRunKey,
    FileRole,
    FileSlice,
    PanelAction,
    ProjectSlice,
    RunStatusSlice,
    TableState,
} from '../shared/panelContract';

/*
 * One function for each Backend-neutral slice the host sends the compiled-query panel (see
 * src/shared/panelContract.ts). Each takes what it needs as plain data and gives the slice: nothing here reads a
 * setting, calls BigQuery or imports `vscode`.
 */

/** The Project slice: where it is, which Backend compiles it and what that Backend can do */
export function projectSlice(project: { root: string }, backend: Backend<never>, graph: CompiledGraph | undefined, compile: CompileNumber): ProjectSlice {
    const tags = new Set<string>();
    for (const action of Object.values(graph?.actions ?? {})) {
        action.tags.forEach((tag) => tags.add(tag));
    }
    return { compile, root: project.root, backend: backend.name, parts: backendParts(backend), tags: [...tags].sort() };
}

const reference = (action: Action): ActionReference => ({ target: action.target, kind: action.kind, fileName: action.fileName });

function panelAction(graph: CompiledGraph, action: Action): PanelAction {
    const shown: PanelAction = {
        ...reference(action),
        id: action.id,
        buildsNothing: isMadeUpTarget(action.target),
        buildsTable: buildsTable(action),
        tags: action.tags,
        disabled: action.disabled === true,
        sections: action.sections,
        sqlPresent: action.sqlPresent,
        runnable: isRunnable(action),
        dependencies: dependenciesOf(graph, action.id).map(reference),
        dependents: dependentsOf(graph, action.id).map(reference),
    };
    const home = homeAction(graph, action);
    if (home) {
        shown.home = home.target;
    }
    if (action.description) {
        shown.description = action.description;
    }
    if (action.columns) {
        shown.columns = action.columns;
    }
    return shown;
}

/** What `file` is to its Project, when no action comes from it */
function roleWithoutActions(backend: Backend<never>, file: string): FileRole {
    if (!file.includes('/') && SETTINGS_FILES[backend.name].includes(file)) {
        return 'project settings';
    }
    return affectsCompile(backend.compileFiles, file) ? 'helper' : 'not compiled';
}

/**
 * The file slice: the actions `file` defines and the tests shown with them, each with its SQL and its neighbours.
 * Nothing else of the Compiled Graph is in it, so its size does not grow with the Project.
 *
 * @param file Relative to the Project root with forward slashes
 * @param registered Actions the file brings into the Project though the graph gives them another file: the notebooks
 * a Dataform JavaScript file registers. They are shown after the file's own
 */
export function fileSlice(graph: CompiledGraph | undefined, backend: Backend<never>, file: string, compile: CompileNumber, registered: ActionId[] = []): FileSlice {
    const also = graph ? registered.map((id) => graph.actions[id]).filter((action): action is Action => action !== undefined) : [];
    const defined = graph ? actionsInFile(graph, file) : [];
    if (!graph || defined.length + also.length === 0) {
        return { compile, file, role: roleWithoutActions(backend, file), actions: [] };
    }
    // An action's siblings are its file's actions and the tests that read them, already in display order
    const shown: Action[] = [];
    for (const action of defined) {
        for (const sibling of siblingsOf(graph, action)) {
            if (!shown.includes(sibling)) {
                shown.push(sibling);
            }
        }
    }
    shown.push(...also.filter((action) => !shown.includes(action)));
    return { compile, file, role: 'actions', actions: shown.map((action) => panelAction(graph, action)) };
}

/** The actions the panel names for a file: those it shows and their neighbours, which its Data Lineage lists */
export function actionsNamed(file: FileSlice): ActionId[] {
    return [...new Set(file.actions.flatMap((action) => [action.id, ...[...action.dependencies, ...action.dependents].map((neighbour) => targetId(neighbour.target))]))];
}

/** What the host knows of a Project's compile, from which its one status is worked out */
export interface CompileState {
    /** False when the file is in no Project */
    inProject: boolean;
    /** The Backend's tool could not be found */
    missingTool?: { tool: Tool; lookedIn: string[] };
    /** The tool was found and is a version the extension does not work with */
    unsupportedVersion?: { tool: Tool; version: string; message: string };
    /** A compile is running */
    compiling?: { showingPrevious: boolean; startedAt: number; command?: string; file?: string };
    /** The last compile that finished with a graph. `notice` is set when the Project was only parsed */
    compiled?: { compiledAt: number; durationMs?: number; notice?: string };
    /** The errors of the last compile that finished */
    errors: CompileError[];
}

/**
 * The compile status slice: exactly one of seven values. Where several things are true the first of these wins: no
 * Project, tool not found, version unsupported, compiling, then how the last compile ended. A compile that left no
 * graph has failed; one that left a graph is compiled, or parsed only when it carries a notice, with its errors.
 */
export function compileStatusSlice(state: CompileState, compile: CompileNumber): CompileStatus {
    if (!state.inProject) {
        return { compile, status: 'no project' };
    }
    if (state.missingTool) {
        return { compile, status: 'tool not found', ...state.missingTool };
    }
    if (state.unsupportedVersion) {
        return { compile, status: 'version unsupported', ...state.unsupportedVersion };
    }
    if (state.compiling) {
        return { compile, status: 'compiling', ...state.compiling };
    }
    if (!state.compiled) {
        return { compile, status: 'failed', errors: state.errors };
    }
    const { compiledAt, durationMs, notice } = state.compiled;
    const timing = durationMs === undefined ? { compiledAt } : { compiledAt, durationMs };
    return notice === undefined
        ? { compile, status: 'compiled', ...timing, errors: state.errors }
        : { compile, status: 'parsed only', compiledAt, notice, errors: state.errors };
}

/**
 * The BigQuery slice: the dry-run results that are in, the dry runs still out and what is known of the actions'
 * tables.
 */
export function bigQuerySlice(input: { results: DryRunResult[]; dryRunning?: DryRunKey[]; tables?: Record<ActionId, TableState>; currencySymbol?: string }, compile: CompileNumber): BigQuerySlice {
    return {
        compile,
        // A result of an earlier compile is not for the SQL on show
        results: input.results.filter((result) => result.compile === compile),
        dryRunning: input.dryRunning ?? [],
        tables: input.tables ?? {},
        currencySymbol: input.currencySymbol ?? '$',
    };
}

/** The run status slice: the last run started through a Backend's runner, if there has been one */
export function runStatusSlice(lastRun: { request: RunOptions; command: string; startedAt: number } | undefined, compile: CompileNumber): RunStatusSlice {
    return lastRun ? { compile, lastRun } : { compile };
}

/** What the host knows of a dbt Project beside its Compiled Graph, from which its block is built */
export interface DbtBlockInput {
    /** The dbt that was found, if one was */
    dbt?: DbtBlock['dbt'];
    /** dbt is still being looked for */
    looking?: boolean;
    /** The dbt target in force: the one chosen or set, else the one the last compile said dbt used */
    target?: string;
    /** The panel's choice overrides the `dbtTarget` setting */
    targetOverridden?: boolean;
    /** The `dbtTarget` setting */
    targetSetting?: string;
    /** The dbt targets of the Project's profile and its default, where `profiles.yml` could be read */
    targets?: { names: string[]; defaultName?: string };
    vars?: string;
    profilesDir?: string;
    /** The profile `dbt_project.yml` names, where it could be read */
    profile?: string;
    /** The last compile only parsed the Project, because it has on-run hooks */
    parsedForHooks?: boolean;
    /** What the last compile's manifest said beside the graph */
    data?: DbtProjectData;
    graph?: CompiledGraph;
    /** The actions the panel names: those of the `file` slice sent with this block, and their neighbours */
    shown?: ActionId[];
    /** The file on show, relative to the Project root with forward slashes */
    file?: string;
}

const BIGQUERY = 'bigquery';

/**
 * The `dbt` block: what only a dbt Project has. A Project is taken for a BigQuery one until a compile says its
 * profile is for another warehouse.
 */
export function dbtBlock(input: DbtBlockInput, compile: CompileNumber): DbtBlock {
    const { data, graph } = input;
    const block: DbtBlock = {
        compile,
        looking: input.looking === true,
        target: {
            ...(input.target ? { name: input.target } : {}),
            overridden: input.targetOverridden === true,
            names: input.targets?.names ?? [],
            ...(input.targets?.defaultName ? { profileDefault: input.targets.defaultName } : {}),
            ...(input.targetSetting ? { setting: input.targetSetting } : {}),
        },
        hooksNotice: input.parsedForHooks === true,
        bigQuery: !data?.adapterType || data.adapterType === BIGQUERY,
        names: {},
        macros: [],
    };
    if (input.dbt) {
        block.dbt = input.dbt;
    }
    if (input.vars) {
        block.vars = input.vars;
    }
    if (input.profilesDir) {
        block.profilesDir = input.profilesDir;
    }
    if (data?.adapterType) {
        block.warehouse = data.adapterType;
    }
    if (data && graph) {
        const actions: Partial<Record<Kind, number>> = {};
        for (const action of Object.values(graph.actions)) {
            actions[action.kind] = (actions[action.kind] ?? 0) + 1;
        }
        block.project = { name: data.projectName, ...(input.profile ? { profile: input.profile } : {}), actions };
    }
    for (const id of input.shown ?? []) {
        const name = data?.names[id];
        const called = !name ? undefined : name.sourceName ? `${name.sourceName}.${name.name}` : name.version ? `${name.name} v${name.version}` : name.name;
        if (called && called !== graph?.actions[id]?.target.name) {
            block.names[id] = called;
        }
    }
    if (input.file) {
        // By name only: a manifest lists a macro's arguments only where a YAML file documents them
        block.macros = (data?.macros ?? []).filter((macro) => macro.fileName === input.file).map((macro) => macro.name);
    }
    return block;
}
