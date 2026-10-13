import * as vscode from 'vscode';
import { withRunFeedback } from './runFeedback';
import { compiledGraph } from './project';
import { resolveDataformOptions } from './project/dataformOptions';
import { ActionId, isRunnable, runSelection } from './shared/compiledGraph';
import type { RunScope } from './shared/panelContract';
import { ExecutionMode, LastRunRequest } from './types';
import { ensureFreshCompilation, getWorkspaceFolder, runIncludedTargets } from './utils';
import { resolveExecutionMode } from './utils/remoteCompiler';

/**
 * Runs the actions `ids` of the Dataform Project, whichever file is open: what the panel asks for by Target. The run
 * is recorded as the actions' file when they are all a run executes of it, so that "Run again" runs the file as it
 * is then, as a run of the open file does; else as the actions. Resolves to true when it created a workflow
 * invocation on the pushed branch.
 */
export function runActions(...args: Parameters<typeof runActionsNow>): ReturnType<typeof runActionsNow> {
    return withRunFeedback(args[3], () => runActionsNow(...args));
}

async function runActionsNow(context: vscode.ExtensionContext, ids: ActionId[], scope: RunScope, executionMode: ExecutionMode): Promise<boolean> {
    executionMode = resolveExecutionMode(executionMode);
    const workspaceFolder = await getWorkspaceFolder({ explain: true });
    if (!workspaceFolder) {
        return false;
    }
    await ensureFreshCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder));
    const graph = compiledGraph(workspaceFolder);
    if (!graph) {
        vscode.window.showErrorMessage("Error compiling Dataform. Run `dataform compile` to see more details");
        return false;
    }

    const unknown = ids.filter((id) => !graph.actions[id] || !isRunnable(graph.actions[id]));
    if (unknown.length > 0) {
        vscode.window.showErrorMessage(`Cannot run ${unknown.join(', ')}: the compiled project has no such action to run`);
        return false;
    }
    if (ids.length === 0) {
        vscode.window.showErrorMessage('No runnable Dataform actions to run');
        return false;
    }

    const selection = runSelection(graph, ids);
    const lastRunRequest: Omit<LastRunRequest, 'timestamp'> = {
        ...('file' in selection ? { kind: 'currentFile', items: [selection.file] } : { kind: 'actions', items: selection.actions }),
        includeDependencies: scope.includeDependencies,
        includeDependents: scope.includeDependents,
        fullRefresh: scope.fullRefresh,
        executionMode,
        workspaceFolder,
    };
    const targets = ids.map((id) => graph.actions[id].target);
    return runIncludedTargets(context, workspaceFolder, targets, scope.includeDependencies, scope.includeDependents, scope.fullRefresh, executionMode, lastRunRequest);
}
