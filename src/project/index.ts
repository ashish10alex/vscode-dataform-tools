import * as vscode from 'vscode';
import { logger } from '../logger';
import type { DataformCompiledJson } from '../types';
import { clearIndices, computeIndices, useIndices } from '../utils/compiledJsonIndex';
import { BACKENDS, SETTINGS_FILES } from './detection';
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

function refreshProjects() {
    const before = projects.active;
    const found = projects.refresh(workspaceFolderPaths());
    logger.debug(`Projects: ${found.length === 0 ? 'none' : found.map((project) => `${project.backend} at ${project.root}`).join(', ')}`);
    noteActiveEditor(vscode.window.activeTextEditor);
    if (projects.active !== before) {
        activeProjectChanged.fire(projects.active);
    }
}

function noteActiveEditor(editor: vscode.TextEditor | undefined) {
    if (editor?.document.uri.scheme === 'file' && projects.noteActiveFile(editor.document.uri.fsPath)) {
        activeProjectChanged.fire(projects.active);
    }
}

/** Finds the window's Projects and keeps the list and the active Project current */
export function initProjects(context: vscode.ExtensionContext) {
    refreshProjects();
    const settingsFiles = BACKENDS.flatMap((backend) => SETTINGS_FILES[backend]).join(',');
    const watchers = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
        // A settings file created or deleted at a root makes or unmakes a Project
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `{${settingsFiles}}`), false, true, false);
        watcher.onDidCreate(refreshProjects);
        watcher.onDidDelete(refreshProjects);
        return watcher;
    });
    context.subscriptions.push(
        activeProjectChanged,
        ...watchers,
        vscode.workspace.onDidChangeWorkspaceFolders(refreshProjects),
        vscode.window.onDidChangeActiveTextEditor(noteActiveEditor),
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
