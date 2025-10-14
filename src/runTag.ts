import { getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, getDataformCompilerOptions, getGcpProjectLocationDataform, getWorkspaceFolder, runCommandInTerminal } from "./utils";
import { createDataformWorkflowInvocation } from "./runDataformWtApi";
import * as vscode from 'vscode';

export async function runMultipleTagsFromSelection(workspaceFolder: string, selectedTags: string[], includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {
    let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
    let runmultitagscommand = getRunTagsWtOptsCommand(workspaceFolder, selectedTags, defaultDataformCompileTime, includDependencies, includeDownstreamDependents, fullRefresh);
    runCommandInTerminal(runmultitagscommand);
}


export async function getMultipleTagsSelection() {
    let options = {
        canPickMany: true,
        ignoreFocusOut: true,
    };
    let selectedTags = await vscode.window.showQuickPick(dataformTags, options);
    return selectedTags as string[] | undefined;
}

export function getRunTagsWtOptsCommand(workspaceFolder: string, tags: string[] | object[], dataformCompilationTimeoutVal: string, includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean): string {
    let dataformCompilerOptions = getDataformCompilerOptions();
    const customDataformCliPath = getDataformCliCmdBasedOnScope(workspaceFolder);
    let cmd = `${customDataformCliPath} run "${workspaceFolder}" ${dataformCompilerOptions} --timeout=${dataformCompilationTimeoutVal}`;
    if (typeof tags === "object") {
        for (let tag of tags) {
            cmd += ` --tags=${tag}`;
        }
    } else {
        cmd += ` --tags=${tags}`;
    }

    if (includDependencies) {
        cmd += ` --include-deps`;
    }
    if (includeDownstreamDependents) {
        cmd += ` --include-dependents`;
    }
    if (fullRefresh) {
        cmd += ` --full-refresh`;
    }
    return cmd;
}

export async function runTag(includeDependencies: boolean, includeDependents: boolean, fullRefresh:boolean, executionMode:string) {
    if (dataformTags.length === 0) {
        vscode.window.showInformationMessage('No tags found in project');
        return;
    }
    vscode.window.showQuickPick(dataformTags, {
        onDidSelectItem: (_) => {
            // This is triggered as soon as a item is hovered over
        }
    }).then(async(selection) => {
        if (!selection) {
            return;
        }

        let workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) { return; }

        if(executionMode === "cli"){

            let defaultDataformCompileTime = getDataformCompilationTimeoutFromConfig();
            let cmd = "";
            if (includeDependencies) {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], defaultDataformCompileTime, true, false, false);
            } else if (includeDependents) {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], defaultDataformCompileTime, false, true, false);
            } else {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], defaultDataformCompileTime, false, false, false);
            }
            if (cmd !== "") {
                runCommandInTerminal(cmd);
            }
        } else if (executionMode === "api"){
            runTagWtApi([selection],includeDependencies, includeDependents, fullRefresh);

        }

    });
}

export async function runTagWtApi(tagsToRun: string[], transitiveDependenciesIncluded:boolean, transitiveDependentsIncluded:boolean, fullyRefreshIncrementalTablesEnabled:boolean ){
    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) { return; }

    const invocationConfig = {
        includedTags: tagsToRun,
        transitiveDependenciesIncluded: transitiveDependenciesIncluded,
        transitiveDependentsIncluded: transitiveDependentsIncluded,
        fullyRefreshIncrementalTablesEnabled: fullyRefreshIncrementalTablesEnabled,
    };

    const projectId = CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase;
    if(!projectId){
        vscode.window.showErrorMessage(`Unable to determine GCP project Id in Dataform config`);
        return;
    }

    if(!CACHED_COMPILED_DATAFORM_JSON){
        vscode.window.showErrorMessage(`Unable to compile dataform project. Run "dataform compile" in the terminal to check`);
        return;
    }

    let gcpProjectLocation = await getGcpProjectLocationDataform(projectId, CACHED_COMPILED_DATAFORM_JSON);

    createDataformWorkflowInvocation(projectId, gcpProjectLocation, invocationConfig);
}