import path from 'path';
import * as vscode from 'vscode';
import { BuildDependencyGraphResult, buildDependencyGraphFromCompiledGraph } from '../shared/buildDependencyGraph';
import { CompiledGraph, slashPath } from '../shared/compiledGraph';
import { compileDbtProject, dbtCompilePending, dbtCompileState } from './dbtCompile';
import type { ProjectState } from './registry';

/*
 * The dependency graph of a dbt Project. It is drawn from the Project's latest graph, which a parse gives in full:
 * every action and every dependency, whether or not its SQL was compiled. When there is none yet the Project is
 * parsed, never compiled, through its one compile loop; a compile that is already running is waited for instead, so
 * that it is not replaced.
 */

const POLL_MS = 200;

async function compileEnded(root: string, token: vscode.CancellationToken): Promise<void> {
    while (dbtCompilePending(root) && !token.isCancellationRequested) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
}

/** Why the Project has no graph to draw, from how its last compile stands */
function whyNoGraph(root: string): string {
    const state = dbtCompileState(root);
    if (state.missingTool) {
        return `dbt was not found. Looked in: ${state.missingTool.lookedIn.join(', ')}`;
    }
    if (state.unsupportedVersion) {
        return state.unsupportedVersion.message;
    }
    return state.errors[0]?.message ?? 'dbt gave no manifest';
}

/** The Project's latest graph, parsing the Project first when it has none. Undefined, with the reason shown, when there is still none */
async function latestGraph(project: ProjectState): Promise<CompiledGraph | undefined> {
    const { root, dbtBackend } = project;
    if (!dbtBackend) {
        return undefined;
    }
    if (!dbtBackend.lastResult) {
        const cancelled = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Reading the dbt project for its dependency graph', cancellable: true },
            async (_progress, token) => {
                await compileEnded(root, token);
                if (!dbtBackend.lastResult && !token.isCancellationRequested) {
                    await compileDbtProject(project, undefined, 'open');
                }
                return token.isCancellationRequested;
            },
        );
        if (cancelled) {
            return undefined;
        }
    }
    const graph = dbtBackend.lastResult?.graph;
    if (!graph || Object.keys(graph.actions).length === 0) {
        vscode.window.showErrorMessage(`The dbt project has no dependency graph to show: ${whyNoGraph(root)}`);
        return undefined;
    }
    return graph;
}

/** The dependency graph of the Project, centred on the first action of `focusFile` (an absolute path) when it has one */
export async function dbtDependencyGraph(project: ProjectState, focusFile: string | undefined): Promise<BuildDependencyGraphResult | undefined> {
    const graph = await latestGraph(project);
    if (!graph) {
        return undefined;
    }
    const relative = focusFile ? slashPath(path.relative(project.root, focusFile)) : undefined;
    return buildDependencyGraphFromCompiledGraph(graph, { focusFile: relative });
}

/**
 * Opens where the action is defined: its file, at its entry when the file is YAML that defines several. `fileName`
 * is used when the latest compile no longer knows the action.
 */
export async function openDbtAction(project: ProjectState, actionId: string | undefined, fileName: string | undefined): Promise<void> {
    const place = actionId ? project.dbtBackend?.editor.placeOf(actionId) : undefined;
    const file = place?.fileName || fileName;
    if (!file) {
        vscode.window.showInformationMessage('This action is not defined in a file of the project');
        return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(project.root, file)));
    // The entry's line when it is still in the file, else the top of the file
    const line = place?.lineIn?.(document.getText()) ?? 0;
    const position = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(position, position) });
}
