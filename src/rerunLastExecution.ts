import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionMode } from './types';
import { findMissingItems, getLastRun, planReplay, summarizeLastRun, describeOverrides } from './lastRun';
import { getWorkspaceFolder, runMultipleFilesFromSelection } from './utils';
import { isRemoteMode } from './utils/remoteCompiler';
import { runCurrentFile } from './runCurrentFile';
import { runMultipleTagsFromSelection, runTagWtApi } from './runTag';

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

    const workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }

    const plan = planReplay(request, isRemoteMode());

    const missing = findMissingItems(request, dataformTags, (relativePath) => fs.existsSync(path.join(workspaceFolder, relativePath)));
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

    const { items, includeDependencies, includeDependents, fullRefresh, executionMode } = plan;
    switch (plan.runner) {
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
    }
}
