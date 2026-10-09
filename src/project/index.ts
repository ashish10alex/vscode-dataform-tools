import * as vscode from 'vscode';
import { logger } from '../logger';
import path from 'path';
import { CompiledGraph, actionsInFile } from '../shared/compiledGraph';
import type { DataformCompiledJson } from '../types';
import { CompiledIndices, emptyIndices } from '../utils/compiledJsonIndex';
import { createDataformBackend } from './dataformBackend';
import { BACKENDS, BackendName, FileBackendHints, isWithin, SETTINGS_FILES } from './detection';
import { ProjectRegistry, ProjectState } from './registry';

export { ProjectRegistry, ProjectState } from './registry';
export * from './detection';
export * from './tools';

/** The Projects of this window. Each Dataform one compiles as the extension does, see ./dataformBackend.ts */
export const projects = new ProjectRegistry(() => createDataformBackend());

const activeProjectChanged = new vscode.EventEmitter<ProjectState | undefined>();
/** Fires when the active Project changes, see `ProjectRegistry.active` */
export const onDidChangeActiveProject = activeProjectChanged.event;

const projectsChanged = new vscode.EventEmitter<void>();
/** Fires when the window's Projects are no longer the ones they were: one was added or removed */
export const onDidChangeProjects = projectsChanged.event;

function workspaceFolderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
}

/**
 * What menus, commands and editor buttons show by: the active Project's Backend, and which optional parts it has.
 * With no active Project the Backend is empty, and nothing that needs one is shown.
 */
export interface BackendContext {
    backend: BackendName | '';
    canRun: boolean;
    listsChangedActions: boolean;
}

export function backendContext(project: ProjectState | undefined = projects.active): BackendContext {
    const parts = project?.parts;
    return { backend: project?.backend ?? '', canRun: parts?.runner ?? false, listsChangedActions: parts?.changes ?? false };
}

let knownContext = '';

/** Sets the context keys of `backendContext`, when they differ from what was last set */
function syncBackendContext() {
    const context = backendContext();
    if (JSON.stringify(context) === knownContext) {
        return;
    }
    knownContext = JSON.stringify(context);
    vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.backend', context.backend);
    vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.backendCanRun', context.canRun);
    vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.backendListsChangedActions', context.listsChangedActions);
}

/** Where the answer to "which Backend?" for a root shared by two Projects is kept, when no setting gives it */
const SHARED_ROOT_BACKEND = 'sharedRootBackend';
let workspaceState: vscode.Memento | undefined;
/** Asked once in a window: a user who closes the question is not asked again until the next one */
let askedForBackend = false;

const isBackendName = (value: unknown): value is BackendName => BACKENDS.includes(value as BackendName);

/**
 * What settles which Project a file belongs to in a directory that is the root of both a Dataform and a dbt Project,
 * when its type does not (xf#47): the one Compiled Graph that lists it, else the `backend` setting, else what the
 * user answered when asked.
 */
export function fileBackendHints(filePath: string): FileBackendHints {
    const setting = vscode.workspace.getConfiguration('vscode-dataform-tools', vscode.Uri.file(filePath)).get<string>('backend');
    const remembered = workspaceState?.get<string>(SHARED_ROOT_BACKEND);
    const preferred = isBackendName(setting) ? setting : isBackendName(remembered) ? remembered : undefined;
    return {
        ...(preferred ? { preferred } : {}),
        isListed: (backend, relativePath) => {
            const root = filePath.slice(0, filePath.length - relativePath.length).replace(/[\\/]+$/, '');
            const project = projects.find(path.normalize(root), backend);
            const graph = backend === 'dataform' ? project?.dataformBackend?.graph : project?.dbtBackend?.lastResult?.graph;
            return !!graph && actionsInFile(graph, relativePath).length > 0;
        },
    };
}

/** Asks which Backend files that neither Project claims belong to, once, and remembers the answer for the workspace */
async function askForBackend(filePath: string) {
    if (askedForBackend || !workspaceState) {
        return;
    }
    askedForBackend = true;
    const answer = await vscode.window.showInformationMessage(
        `${path.basename(filePath)} is in a folder that is both a Dataform and a dbt project, and neither claims it. Which should such files be treated as? The setting "vscode-dataform-tools.backend" changes this later.`,
        'Dataform', 'dbt',
    );
    if (answer) {
        await workspaceState.update(SHARED_ROOT_BACKEND, answer === 'dbt' ? 'dbt' : 'dataform');
        syncProjects();
    }
}

/**
 * What the panel calls the Project at `root`, where the window does not make plain which one it is: its root from
 * the workspace folder when it is below one, its folder's name when the window has several Projects.
 */
export function projectLabel(root: string): string | undefined {
    const folder = workspaceFolderPaths().filter((candidate) => isWithin(candidate, root)).sort((a, b) => b.length - a.length)[0];
    const below = folder ? path.relative(folder, root).split(path.sep).join('/') : '';
    if (below) {
        return below;
    }
    return projects.projects.length > 1 ? path.basename(root) : undefined;
}

let knownProjects = '';

/**
 * Looks at the workspace-folder roots and at the Projects known below them again, and notes which one the editor in
 * focus belongs to, by the settings file nearest above its file. Cheap (a few `stat` calls per directory), so it runs
 * on every editor switch: that is how a settings file created or deleted since the last look is noticed. A file
 * watcher for them is not used, as it shifts when other extensions' file events arrive and made the git state be
 * computed twice on some saves.
 */
function syncProjects(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) {
    const before = projects.active;
    projects.refresh(workspaceFolderPaths());
    let ambiguous: string | undefined;
    if (editor?.document.uri.scheme === 'file') {
        const file = editor.document.uri.fsPath;
        const hints = fileBackendHints(file);
        projects.noteActiveFile(file, hints);
        if (projects.forFile(file, hints).kind === 'ambiguous') {
            ambiguous = file;
        }
    }
    noteProjects();
    if (ambiguous) {
        void askForBackend(ambiguous);
    }
    syncBackendContext();
    if (projects.active !== before) {
        activeProjectChanged.fire(projects.active);
    }
}

/** Says so when the window's Projects are no longer the ones last noted */
function noteProjects() {
    const found = projects.projects;
    const description = found.length === 0 ? 'none' : found.map((project) => `${project.backend} at ${project.root}`).join(', ');
    if (description === knownProjects) {
        return;
    }
    knownProjects = description;
    logger.debug(`Projects: ${description}`);
    // The Project picker is only worth listing when there is something to pick
    vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.multipleProjects', found.length > 1);
    projectsChanged.fire();
}

/** Never searched for settings files: what a tool installs or builds, where a settings file is not a Project of the user's */
const NOT_SEARCHED = ['**/node_modules/**', '**/dbt_packages/**', '**/target/**', '**/.venv/**'];

/** The globs a `files.exclude` or `search.exclude` setting turns on. One with braces cannot be put inside another glob */
function excludedBySetting(section: 'files' | 'search'): string[] {
    const globs = vscode.workspace.getConfiguration(section).get<Record<string, unknown>>('exclude') ?? {};
    return Object.keys(globs).filter((glob) => globs[glob] === true && !/[{}]/.test(glob));
}

/**
 * Searches the workspace once for the settings files of Projects below the workspace-folder roots, so that a Project
 * is known before one of its files is opened. Runs in VS Code's search process, not on the path of an editor switch.
 */
async function searchForProjects() {
    const settingsFiles = Object.values(SETTINGS_FILES).flat();
    const exclude = `{${[...new Set([...NOT_SEARCHED, ...excludedBySetting('files'), ...excludedBySetting('search')])].join(',')}}`;
    try {
        const found = await vscode.workspace.findFiles(`**/{${settingsFiles.join(',')}}`, exclude);
        const roots = [...new Set(found.filter((uri) => uri.scheme === 'file').map((uri) => path.dirname(uri.fsPath)))].sort();
        if (projects.discover(roots)) {
            syncProjects();
        }
    } catch (error) {
        logger.debug(`Could not search the workspace for Projects: ${error}`);
    }
}

/** Makes `project` the active one, e.g. because the user picked it */
export function activateProject(project: ProjectState) {
    const before = projects.active;
    projects.activate(project);
    syncBackendContext();
    if (projects.active !== before) {
        activeProjectChanged.fire(projects.active);
    }
}

/** Finds the window's Projects and keeps the list and the active Project current */
export function initProjects(context: vscode.ExtensionContext) {
    workspaceState = context.workspaceState;
    syncProjects();
    void searchForProjects();
    context.subscriptions.push(
        activeProjectChanged,
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.backend')) {
                syncProjects();
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => { syncProjects(); void searchForProjects(); }),
        vscode.window.onDidChangeActiveTextEditor((editor) => syncProjects(editor)),
    );
}

let lastCompiled: ProjectState | undefined;

/**
 * The Dataform Project a read or a command is about when the caller has no root in hand: the active Project, which
 * follows the editor in focus, else the one that compiled last, else the only one there is.
 */
function currentDataformProject(): ProjectState | undefined {
    const active = projects.active;
    if (active?.backend === 'dataform') {
        return active;
    }
    if (lastCompiled && projects.find(lastCompiled.root, 'dataform') === lastCompiled) {
        return lastCompiled;
    }
    const dataformProjects = projects.projects.filter((project) => project.backend === 'dataform');
    return dataformProjects.length === 1 ? dataformProjects[0] : undefined;
}

/** The root of the Dataform Project to act on, see `currentDataformProject`. Never asks the user */
export function currentDataformRoot(): string | undefined {
    return currentDataformProject()?.root;
}

function dataformProject(root?: string): ProjectState | undefined {
    return root ? projects.find(root, 'dataform') : currentDataformProject();
}

/**
 * What a Dataform Project last compiled to, as Dataform gave it; see `dataformProject` for which one. It is read
 * from the Project's Dataform Backend, and is for Dataform-only features: a surface shared with dbt reads the
 * Compiled Graph.
 */
export function compiledJson(root?: string): DataformCompiledJson | undefined {
    return dataformProject(root)?.dataformBackend?.rawResult;
}

/** The Dataform Backend of a Project; see `dataformProject` for which one */
export function dataformBackend(root?: string) {
    return dataformProject(root)?.dataformBackend;
}

/**
 * The Compiled Graph of what a Dataform Project last compiled to; see `dataformProject` for which one. Undefined
 * before the first compile result.
 */
export function compiledGraph(root?: string): CompiledGraph | undefined {
    return dataformProject(root)?.dataformBackend?.graph;
}

/** The number of the compile result `compiledJson(root)` and `compiledGraph(root)` give; 0 before the first */
export function compileNumber(root?: string): number {
    return dataformProject(root)?.compileNumber ?? 0;
}

const noIndices = emptyIndices();

/** The lookups over `compiledJson(root)`: empty ones when there is no compile result */
export function compiledIndices(root?: string): CompiledIndices {
    return dataformProject(root)?.dataformBackend?.rawIndices ?? noIndices;
}

/** Hands what the Dataform Project at `root` compiled to over to its Backend, the one place a compile result is kept. */
export function setCompiled(root: string, compiled: DataformCompiledJson) {
    const project = projects.ensure(root, 'dataform');
    if (!project?.dataformBackend) {
        logger.debug(`Not keeping a compile result for ${root}: it is not the root of a Dataform Project`);
        return;
    }
    if (project.dataformBackend.rawResult !== compiled) {
        project.compileNumber++;
    }
    project.dataformBackend.keep(compiled);
    const indices = project.dataformBackend.rawIndices ?? noIndices;
    lastCompiled = project;
    logger.debug(`Built indices: ${indices.fileNodeMap.size} files, ${indices.targetDependentsMap.size} targets with dependents`);
}

/** Forgets what the Dataform Project at `root` compiled to, or every Dataform Project without a `root` */
export function clearCompiled(root?: string) {
    const cleared = root ? [projects.find(root, 'dataform')] : projects.projects.filter((project) => project.backend === 'dataform');
    cleared.forEach((project) => project?.dataformBackend?.forget());
}
