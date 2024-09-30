import * as vscode from 'vscode';
import { getDataformCompilationTimeoutFromConfig, getMultipleFileSelection, getMultipleTagsSelection, getWorkspaceFolder, runCommandInTerminal, runCurrentFile, runMultipleFilesFromSelection, runMultipleTagsFromSelection } from './utils';
import { getRunTagsWtOptsCommand } from './commands';

export async function runFilesTagsWtOptions() {
    const firstStageOptions = ["run current file", "run a tag", "run multiple files", "run multiple tags"];
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
    let workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder){ return; }
    if (firstStageSelection === "run multiple files"){
        multipleFileSelection = await getMultipleFileSelection(workspaceFolder);
    }

    let multipleTagsSelection: string | undefined;
    if (firstStageSelection === "run multiple tags"){
        multipleTagsSelection = await getMultipleTagsSelection();
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
    } else if (firstStageSelection === "run a tag") {
        if(!tagSelection){return;};
        let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
        let runTagsWtDepsCommand = getRunTagsWtOptsCommand(workspaceFolder, tagSelection, defaultDataformCompileTime, includeDependencies, includeDependents, fullRefresh);
        runCommandInTerminal(runTagsWtDepsCommand);
    } else if (firstStageSelection === "run multiple files"){
        if(!multipleFileSelection){return;};
        runMultipleFilesFromSelection(workspaceFolder, multipleFileSelection, includeDependencies, includeDependents, fullRefresh);
    } else if (firstStageSelection === "run multiple tags"){
        if(!multipleTagsSelection){return;};
        runMultipleTagsFromSelection(workspaceFolder, multipleTagsSelection, includeDependencies, includeDependents, fullRefresh);
    }
}
