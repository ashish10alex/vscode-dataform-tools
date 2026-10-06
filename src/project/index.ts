import * as vscode from 'vscode';
import { logger } from '../logger';
import type { DataformCompiledJson } from '../types';
import { clearIndices, computeIndices, useIndices } from '../utils/compiledJsonIndex';
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

/**
 * Records what the Dataform Project at `root` compiled to, and makes it what the window-wide lookups read.
 * The one place a compile result is stored.
 */
export function setCompiled(root: string, compiled: DataformCompiledJson) {
    const indices = computeIndices(compiled);
    projects.ensure(root, 'dataform')?.setCompiled(compiled, indices);
    globalThis.CACHED_COMPILED_DATAFORM_JSON = compiled;
    useIndices(indices);
    logger.debug(`Built indices: ${indices.fileNodeMap.size} files, ${indices.targetDependentsMap.size} targets with dependents`);
}

/** Forgets what the Dataform Project at `root` compiled to, or every Dataform Project without a `root` */
export function clearCompiled(root?: string, options: { keepIndices?: boolean } = {}) {
    const cleared = root ? [projects.find(root, 'dataform')] : projects.projects.filter((project) => project.backend === 'dataform');
    cleared.forEach((project) => project?.clearCompiled());
    globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined;
    if (!options.keepIndices) {
        clearIndices();
    }
}
