import * as vscode from 'vscode';
import { getDataformCompilationTimeoutFromConfig, getMultipleFileSelection, getWorkspaceFolder, runCommandInTerminal, runCurrentFile, runMultipleFilesFromSelection } from './utils';
import { getRunTagsWtDepsCommand } from './commands';

export async function multiStageSelectionHandler() {
    const firstStageOptions = ["run current file", "run multiple files" , "run a tag"];
    const firstStageSelection = await vscode.window.showQuickPick(firstStageOptions, {
        placeHolder: 'Select an option'
    });

    if (!firstStageSelection) {
        return;
    }

    let tagSelection: string | undefined;
    if (firstStageSelection === "run a tag") {
        const tagOptions = dataformTags;
        tagSelection = await vscode.window.showQuickPick(tagOptions, {
            placeHolder: 'Select a tag'
        });
    }

    let multipleFileSelection: string | undefined;
    let workspaceFolder: string | undefined;
    if (firstStageSelection === "run multiple files"){
        workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder){ return; }
        multipleFileSelection = await getMultipleFileSelection(workspaceFolder);
    }

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
        return;
    }

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
        if (!workspaceFolder){ return; }
        let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
        let runTagsWtDepsCommand = getRunTagsWtDepsCommand(workspaceFolder, tagSelection, defaultDataformCompileTime);
        runCommandInTerminal(runTagsWtDepsCommand);
    } else if (firstStageSelection === "run multiple files"){
        if(!multipleFileSelection){return;};
        if(!workspaceFolder){return;};
        runMultipleFilesFromSelection(workspaceFolder, multipleFileSelection, includeDependencies, includeDependents, fullRefresh);
    }
}
