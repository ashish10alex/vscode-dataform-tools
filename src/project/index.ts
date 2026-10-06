import * as vscode from 'vscode';
import { logger } from '../logger';
import type { DataformCompiledJson } from '../types';
import { CompiledIndices, computeIndices, emptyIndices } from '../utils/compiledJsonIndex';
import { ProjectRegistry, ProjectState } from './registry';

export { ProjectRegistry, ProjectState } from './registry';
export * from './detection';

/** The Projects of this window */
export const projects = new ProjectRegistry();

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
    }
    if (editor?.document.uri.scheme === 'file') {
        projects.noteActiveFile(editor.document.uri.fsPath);
    }
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
 * The Dataform Project a read is about: the one rooted at `root` when the caller knows it, else the one that compiled
 * last. The second is what the window-wide compile result used to mean; it becomes the active Project once the
 * workspace folder follows the editor in focus too.
 */
function dataformProject(root?: string): ProjectState | undefined {
    return root ? projects.find(root, 'dataform') : lastCompiled;
}

/** What a Dataform Project last compiled to, see `dataformProject` for which one */
export function compiledJson(root?: string): DataformCompiledJson | undefined {
    return dataformProject(root)?.compiled;
}

const noIndices = emptyIndices();

/** The lookups over `compiledJson(root)`: empty ones when there is no compile result */
export function compiledIndices(root?: string): CompiledIndices {
    return dataformProject(root)?.indices ?? noIndices;
}

/** Records what the Dataform Project at `root` compiled to. The one place a compile result is stored. */
export function setCompiled(root: string, compiled: DataformCompiledJson) {
    const indices = computeIndices(compiled);
    const project = projects.ensure(root, 'dataform');
    if (!project) {
        logger.debug(`Not keeping a compile result for ${root}: it is not the root of a Dataform Project`);
        return;
    }
    project.setCompiled(compiled, indices);
    lastCompiled = project;
    logger.debug(`Built indices: ${indices.fileNodeMap.size} files, ${indices.targetDependentsMap.size} targets with dependents`);
}

/** Forgets what the Dataform Project at `root` compiled to, or every Dataform Project without a `root` */
export function clearCompiled(root?: string) {
    const cleared = root ? [projects.find(root, 'dataform')] : projects.projects.filter((project) => project.backend === 'dataform');
    cleared.forEach((project) => project?.clearCompiled());
}
