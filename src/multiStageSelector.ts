import * as vscode from 'vscode';
import { getDataformCompilationTimeoutFromConfig, getWorkspaceFolder, runCommandInTerminal, runCurrentFile } from './utils';
import { getRunTagsWtDepsCommand } from './commands';

export async function multiStageSelectionHandler() {
    // First stage selection
    const firstStageOptions = ["run current file", "run a tag"];
    const firstStageSelection = await vscode.window.showQuickPick(firstStageOptions, {
        placeHolder: 'Select an option'
    });

    if (!firstStageSelection) {
        return; // User cancelled the selection
    }

    let tagSelection: string | undefined;
    if (firstStageSelection === "run a tag") {
        const tagOptions = dataformTags;
        tagSelection = await vscode.window.showQuickPick(tagOptions, {
            placeHolder: 'Select a tag'
        });
    }

    // Second stage selection based on first stage
    let secondStageOptions: string[];
    if (firstStageSelection || tagSelection) {
        secondStageOptions = ["default", "include dependents", "include dependencies"];
    } else {
        return;
    }

    const secondStageSelection = await vscode.window.showQuickPick(secondStageOptions, {
        placeHolder: `select run type`
    });

    if (!secondStageSelection) {
        return; // User cancelled the selection
    }

    // Second stage selection based on first stage
    let thirdStageOptions: string[];
    if (firstStageSelection) {
        thirdStageOptions = ["no", "yes"];
    } else {
        return;
    }

    const thirdStageSelection = await vscode.window.showQuickPick(thirdStageOptions, {
        placeHolder: `full refresh`
    });

    if (!thirdStageSelection) {
        return;
    }

    // Handle the final selection
    vscode.window.showInformationMessage(`You selected: ${firstStageSelection} > ${tagSelection} > ${secondStageSelection} > ${thirdStageSelection}`);
    let includeDependents = false;
    let includeDependencies = false;
    let fullRefresh = false;
    if (secondStageSelection === "include dependents") {
        includeDependents = true;
    }
    if (secondStageSelection === "include dependencies") {
        includeDependencies = true;
    }
    if (thirdStageSelection === "yes") {
        fullRefresh = true;
    }
    if (firstStageSelection === "run current file") {
        runCurrentFile(includeDependencies, includeDependents, fullRefresh);
    } else if (firstStageSelection === "run a tag" && tagSelection) {
        // TODO: make this a function and also use the abstraction in extension.ts
        let workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) { return; }
        let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
        let runTagsWtDepsCommand = getRunTagsWtDepsCommand(workspaceFolder, tagSelection, defaultDataformCompileTime);
        runCommandInTerminal(runTagsWtDepsCommand);
    }
}
