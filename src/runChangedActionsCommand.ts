import * as vscode from 'vscode';
import { ExecutionMode } from './types';
import { getWorkspaceFolder } from './utils';
import { resolveExecutionMode } from './utils/remoteCompiler';
import { describeComparison } from './shared/changeComparison';
import { ChangedActionsResult, dispatchChangedActions, noChangesMessage, prepareChangedActions } from './changedActions';

/** Keybinding args; when any is given the prompts are skipped and the changed actions run straight away. */
export interface RunChangedActionsArgs {
    includeDependencies?: boolean;
    includeDependents?: boolean;
    fullRefresh?: boolean;
}

type RunTypeItem = vscode.QuickPickItem & { runType?: 'default' | 'dependents' | 'dependencies' };

/**
 * Asks for the run type in a picker that also lists what will run. The action rows are a read-only
 * preview: accepting one keeps the picker open.
 */
function pickRunType(result: ChangedActionsResult): Promise<RunTypeItem['runType']> {
    const count = result.changed.length;
    const items: RunTypeItem[] = [
        { label: '$(play) Run', description: `${count} changed action${count === 1 ? '' : 's'}`, runType: 'default' },
        { label: '$(play) Run with dependents', runType: 'dependents' },
        { label: '$(play) Run with dependencies', runType: 'dependencies' },
    ];
    let currentFile: string | undefined;
    for (const action of result.changed) {
        if (action.fileName !== currentFile) {
            currentFile = action.fileName;
            items.push({ label: action.fileName, kind: vscode.QuickPickItemKind.Separator });
        }
        items.push({ label: action.target.split('.').slice(1).join('.'), description: `${action.type} · ${action.reasons.join(', ')}` });
    }
    for (const action of result.deleted) {
        items.push({ label: `$(trash) ${action.target.split('.').slice(1).join('.')}`, description: 'removed on this branch, not run' });
    }

    const quickPick = vscode.window.createQuickPick<RunTypeItem>();
    quickPick.title = `Changed actions ${describeComparison(result.headRef, result.baseRef)} @ ${result.mergeBaseSha.slice(0, 7)} (${result.headLabel})`;
    quickPick.placeholder = 'Select run type';
    quickPick.items = items;
    quickPick.matchOnDescription = true;
    return new Promise((resolve) => {
        let accepted: RunTypeItem['runType'];
        quickPick.onDidAccept(() => {
            const runType = quickPick.selectedItems[0]?.runType;
            if (runType) {
                accepted = runType;
                quickPick.hide();
            }
        });
        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(accepted);
        });
        quickPick.show();
    });
}

export async function runChangedActionsCommand(context: vscode.ExtensionContext, executionMode: ExecutionMode, args?: RunChangedActionsArgs) {
    executionMode = resolveExecutionMode(executionMode);
    const workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Working out changed actions…' },
        () => prepareChangedActions(workspaceFolder),
    );
    if (!result) {
        return;
    }
    if (result.changed.length === 0) {
        vscode.window.showInformationMessage(noChangesMessage(result));
        return;
    }

    const hasArgs = !!args && (args.includeDependencies !== undefined || args.includeDependents !== undefined || args.fullRefresh !== undefined);
    if (hasArgs) {
        await dispatchChangedActions(context, workspaceFolder, result, !!args.includeDependencies, !!args.includeDependents, !!args.fullRefresh, executionMode);
        return;
    }

    const runType = await pickRunType(result);
    if (!runType) {
        return;
    }
    const fullRefresh = await vscode.window.showQuickPick(['no', 'yes'], { placeHolder: 'full refresh' });
    if (!fullRefresh) {
        return;
    }
    await dispatchChangedActions(context, workspaceFolder, result, runType === 'dependencies', runType === 'dependents', fullRefresh === 'yes', executionMode);
}
