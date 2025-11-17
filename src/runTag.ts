import { getCachedDataformRepositoryLocation, getDataformCliCmdBasedOnScope, getDataformCompilationTimeoutFromConfig, getDataformCompilerOptions, getWorkspaceFolder, runCommandInTerminal, showLoadingProgress } from "./utils";
import * as vscode from 'vscode';
import { DataformTools } from "@ashishalex/dataform-tools";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely} from "./dataformApiUtils";
import { ExecutionMode } from './types';
import { getGitBranchAndRepoName } from "./getGitMeta";

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

export async function runTag(context:vscode.ExtensionContext, includeDependencies: boolean, includeDependents: boolean, fullRefresh:boolean, executionMode:ExecutionMode) {
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
            runTagWtApi(context, [selection],includeDependencies, includeDependents, fullRefresh, executionMode);

        }

    });
}

export async function runTagWtApi(context: vscode.ExtensionContext, tagsToRun: string[], transitiveDependenciesIncluded:boolean, transitiveDependentsIncluded:boolean, fullyRefreshIncrementalTablesEnabled:boolean, executionMode:string){

    const invocationConfig = {
        includedTags: tagsToRun,
        transitiveDependenciesIncluded: transitiveDependenciesIncluded,
        transitiveDependentsIncluded: transitiveDependentsIncluded,
        fullyRefreshIncrementalTablesEnabled: fullyRefreshIncrementalTablesEnabled,
    };

    if(executionMode === "api_workspace"){
        await showLoadingProgress(
            "",
            syncAndrunDataformRemotely,
            "Dataform remote workspace execution cancelled",
            invocationConfig,
            compilerOptionsMap,
        );
        return;
    }

    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder) { return; }

    const projectId = CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase;
    if(!projectId){
        vscode.window.showErrorMessage(`Unable to determine GCP project Id in Dataform config`);
        return;
    }

    if(!CACHED_COMPILED_DATAFORM_JSON){
        vscode.window.showErrorMessage(`Unable to compile dataform project. Run "dataform compile" in the terminal to check`);
        return;
    }

    try{

        const gitInfo = getGitBranchAndRepoName();
        if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
            throw new Error("Error determining git repository and or branch name");
        } 
        const repositoryName = gitInfo.gitRepoName;
        vscode.window.showInformationMessage(`Creating workflow invocation with ${gitInfo.gitBranch} remote git branch ...`);


        const gcpProjectLocation = await getCachedDataformRepositoryLocation(context, repositoryName);
        if (!gcpProjectLocation) {
            vscode.window.showInformationMessage("Could not determine the location where Dataform repository is hosted, aborting...");
            return;
        }

        const dataformClient = new DataformTools(projectId, gcpProjectLocation);

        const workflowInvocation = await dataformClient.runDataformRemotely(repositoryName, compilerOptionsMap, invocationConfig, gitInfo.gitBranch, undefined);
        const workflowInvocationId = workflowInvocation?.name?.split("/").pop();
        if(workflowInvocationId){
            const workflowInvocationUrl = dataformClient.getWorkflowInvocationUrl(repositoryName, workflowInvocationId);
            sendWorkflowInvocationNotification(workflowInvocationUrl);
        }
        //NOTE: I am assuming that if the user has got this far the location set was correct, so caching it
        context.globalState.update(`vscode_dataform_tools_${repositoryName}`, gcpProjectLocation);

    }catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
}