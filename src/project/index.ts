import * as vscode from 'vscode';
import { logger } from '../logger';
import type { CompiledGraph } from '../shared/compiledGraph';
import type { DataformCompiledJson } from '../types';
import { CompiledIndices, emptyIndices } from '../utils/compiledJsonIndex';
import { createDataformBackend } from './dataformBackend';
import { ProjectRegistry, ProjectState } from './registry';

export { ProjectRegistry, ProjectState } from './registry';
export * from './detection';
export * from './tools';

/** The Projects of this window. Each Dataform one compiles as the extension does, see ./dataformBackend.ts */
export const projects = new ProjectRegistry(() => createDataformBackend());

const activeProjectChanged = new vscode.EventEmitter<ProjectState | undefined>();
/** Fires when the active Project changes, see `ProjectRegistry.active` */
export const onDidChangeActiveProject = activeProjectChanged.event;

function workspaceFolderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
}

let knownProjects = '';

/**
 * Looks for Projects at the workspace-folder roots again and notes which one the editor in focus belongs to.
 * Cheap (a few `stat` calls per folder), so it runs on every editor switch: that is how a settings file created or
 * deleted since the last look is noticed. A file watcher for them is not used, as it shifts when other extensions'
 * file events arrive and made the git state be computed twice on some saves.
 */
function syncProjects(editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor) {
    const before = projects.active;
    const found = projects.refresh(workspaceFolderPaths());
    const description = found.length === 0 ? 'none' : found.map((project) => `${project.backend} at ${project.root}`).join(', ');
    if (description !== knownProjects) {
        knownProjects = description;
        logger.debug(`Projects: ${description}`);
        // The Project picker is only worth listing when there is something to pick
        vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.multipleProjects', found.length > 1);
    }
    if (editor?.document.uri.scheme === 'file') {
        projects.noteActiveFile(editor.document.uri.fsPath);
    }
    if (projects.active !== before) {
        activeProjectChanged.fire(projects.active);
    }
}

/** Makes `project` the active one, e.g. because the user picked it */
export function activateProject(project: ProjectState) {
    const before = projects.active;
    projects.activate(project);
    if (projects.active !== before) {
        activeProjectChanged.fire(projects.active);
    }
}

/** Finds the window's Projects and keeps the list and the active Project current */
export function initProjects(context: vscode.ExtensionContext) {
    syncProjects();
    context.subscriptions.push(
        activeProjectChanged,
        vscode.workspace.onDidChangeWorkspaceFolders(() => syncProjects()),
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
