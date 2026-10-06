import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionMode, LastRunRequest } from './types';
import { findMissingItems, getLastRun, isFromOtherFolder, planReplay, summarizeLastRun, describeOverrides } from './lastRun';
import { getDataformTags, getOrCompileDataformJson, getWorkspaceFolder, runMultipleFilesFromSelection } from './utils';
import { isRemoteMode } from './utils/remoteCompiler';
import { runCurrentFile } from './runCurrentFile';
import { runMultipleTagsFromSelection, runTagWtApi } from './runTag';
import { runChangedActions } from './changedActions';
import { withDeferOverride } from './defer/deferRun';

const CHOOSE_WHAT_TO_RUN = 'Choose what to run';

function runWithOptionsCommand(mode: ExecutionMode): string {
    switch (mode) {
        case 'cli': return 'vscode-dataform-tools.runFilesTagsWtOptions';
        case 'api': return 'vscode-dataform-tools.runFilesTagsWtOptionsApi';
        case 'api_workspace': return 'vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace';
    }
}

async function offerRunWithOptions(show: Thenable<string | undefined>, mode: ExecutionMode) {
    if (await show === CHOOSE_WHAT_TO_RUN) {
        await vscode.commands.executeCommand(runWithOptionsCommand(mode));
    }
}

export async function rerunLastExecution(context: vscode.ExtensionContext) {
    const request = getLastRun();
    if (!request) {
        await offerRunWithOptions(vscode.window.showInformationMessage('No previous execution to rerun', CHOOSE_WHAT_TO_RUN), 'cli');
        return;
    }

    const workspaceFolder = await getWorkspaceFolder({ explain: true });
    if (!workspaceFolder) {
        return;
    }

    if (isFromOtherFolder(request, workspaceFolder)) {
        const selectFolder = 'Select Dataform folder';
        const choice = await vscode.window.showErrorMessage(
            `Cannot rerun last execution. It ran in ${request.workspaceFolder}, but the selected Dataform folder is ${workspaceFolder}.`,
            selectFolder,
        );
        if (choice === selectFolder) {
            await vscode.commands.executeCommand('vscode-dataform-tools.selectWorkspaceFolder');
        }
        return;
    }

    const plan = planReplay(request, isRemoteMode());

    // The tag list is only populated once the panel has compiled, so read it from the compiled project instead.
    let knownTags: string[] | undefined;
    if (request.kind === 'tags') {
        const compiledJson = await getOrCompileDataformJson(workspaceFolder);
        knownTags = compiledJson ? await getDataformTags(compiledJson) : undefined;
    }
    const missing = findMissingItems(request, knownTags, (relativePath) => fs.existsSync(path.join(workspaceFolder, relativePath)));
    if (missing.length > 0) {
        const what = request.kind === 'tags' ? 'Tag(s) no longer in the project' : 'File(s) no longer exist';
        await offerRunWithOptions(
            vscode.window.showErrorMessage(`Cannot rerun last execution. ${what}: ${missing.join(', ')}`, CHOOSE_WHAT_TO_RUN),
            plan.executionMode,
        );
        return;
    }

    const { label, detail } = summarizeLastRun(request, plan.executionMode, describeOverrides(globalThis.compilerOptionsMap));
    if (request.fullRefresh) {
        const confirmed = await vscode.window.showWarningMessage(
            'Rerun last execution with full refresh?',
            { modal: true, detail },
            'Run again',
        );
        if (confirmed !== 'Run again') {
            return;
        }
    }
    vscode.window.showInformationMessage(`Rerunning: ${label}`);

    await withDeferOverride(request.deferToProd ?? false, () => replayRun(context, workspaceFolder, request));
}

/** Runs a recorded request again through the runner it came from */
export async function replayRun(context: vscode.ExtensionContext, workspaceFolder: string, request: LastRunRequest) {
    const { items, includeDependencies, includeDependents, fullRefresh, executionMode, runner } = planReplay(request, isRemoteMode());
    switch (runner) {
        case 'currentFile':
            await runCurrentFile(context, includeDependencies, includeDependents, fullRefresh, executionMode, items[0]);
            return;
        case 'files':
            await runMultipleFilesFromSelection(context, workspaceFolder, items, includeDependencies, includeDependents, fullRefresh, executionMode);
            return;
        case 'tagsCli':
            await runMultipleTagsFromSelection(workspaceFolder, items, includeDependencies, includeDependents, fullRefresh);
            return;
        case 'tagsApi':
            await runTagWtApi(context, items, includeDependencies, includeDependents, fullRefresh, executionMode);
            return;
        case 'changed':
            await runChangedActions(context, workspaceFolder, includeDependencies, includeDependents, fullRefresh, executionMode, request.files, true);
            return;
    }
}
