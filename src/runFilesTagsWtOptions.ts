import * as vscode from 'vscode';
import { getDataformCompilationTimeoutFromConfig, getMultipleFileSelection, getWorkspaceFolder, runCommandInTerminal, runMultipleFilesFromSelection } from './utils';
import { getMultipleTagsSelection, getRunTagsWtOptsCommand, runMultipleTagsFromSelection, runTagWtApi } from './runTag';
import { ExecutionMode } from './types';
import { runCurrentFile } from './runCurrentFile';

export async function runFilesTagsWtOptions(context: vscode.ExtensionContext, executionMode: ExecutionMode) {
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
    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder){ return; }
    if (firstStageSelection === "run multiple files"){
        multipleFileSelection = await getMultipleFileSelection(workspaceFolder);
    }

    let multipleTagsSelection: string[] | undefined;
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


    if (executionMode === "cli"){
        if (firstStageSelection === "run current file") {
            runCurrentFile(context, includeDependencies, includeDependents, fullRefresh, "cli");
        } else if (firstStageSelection === "run a tag") {
            if(!tagSelection){return;};
            let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
            let runTagsWtDepsCommand = getRunTagsWtOptsCommand(workspaceFolder, [tagSelection], defaultDataformCompileTime, includeDependents, includeDependents, fullRefresh);
            runCommandInTerminal(runTagsWtDepsCommand);
        } else if (firstStageSelection === "run multiple files"){
            if(!multipleFileSelection){return;};
            runMultipleFilesFromSelection(context, workspaceFolder, multipleFileSelection, includeDependencies, includeDependents, fullRefresh, "cli");
        } else if (firstStageSelection === "run multiple tags"){
            if(!multipleTagsSelection){return;};
            runMultipleTagsFromSelection(workspaceFolder, multipleTagsSelection, includeDependencies, includeDependents, fullRefresh);
        }
    } else if (executionMode === "api" || executionMode === "api_workspace"){
        if (firstStageSelection === "run current file") {
            runCurrentFile(context, includeDependencies, includeDependents, fullRefresh, executionMode);
        } else if (firstStageSelection === "run a tag") {
            if(!tagSelection){return;};
            runTagWtApi(context, [tagSelection], includeDependencies, includeDependents, fullRefresh, executionMode);
        } else if (firstStageSelection === "run multiple files"){
            if(!multipleFileSelection){return;};
            runMultipleFilesFromSelection(context, workspaceFolder, multipleFileSelection, includeDependencies, includeDependents, fullRefresh, executionMode);
        } else if (firstStageSelection === "run multiple tags"){
            if(!multipleTagsSelection){return;};
            runTagWtApi(context, multipleTagsSelection, includeDependencies, includeDependents, fullRefresh, executionMode);
        }
    }
}
