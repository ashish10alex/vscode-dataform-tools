import { getCachedDataformRepositoryLocation, getWorkspaceFolder, runCommandInTerminal, showLoadingProgress, ensureFreshCompilation } from "./utils";
import { compiledJson } from './project';
import * as vscode from 'vscode';
import { loadDataformTools } from "./lazySdk";
import { sendWorkflowInvocationNotification, syncAndrunDataformRemotely} from "./dataformApiUtils";
import { ExecutionMode } from './types';
import { GitService } from "./gitClient";
import { confirmRemoteRun, resolveExecutionMode } from "./utils/remoteCompiler";
import { beginRun } from './defer/deferRun';
import { resolveDataformOptions } from './project/dataformOptions';
import { dataformRunCommand } from './project/dataformBackend';

export async function runMultipleTagsFromSelection(workspaceFolder: string, selectedTags: string[], includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean) {
    if (!(await beginRun({ kind: 'tags', items: selectedTags, includeDependencies: includDependencies, includeDependents: includeDownstreamDependents, fullRefresh, executionMode: 'cli', workspaceFolder }))) { return; }
    let runmultitagscommand = getRunTagsWtOptsCommand(workspaceFolder, selectedTags, includDependencies, includeDownstreamDependents, fullRefresh);
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

export function getRunTagsWtOptsCommand(workspaceFolder: string, tags: string[], includDependencies: boolean, includeDownstreamDependents: boolean, fullRefresh: boolean): string {
    return dataformRunCommand(workspaceFolder, { tags, includeDependencies: includDependencies, includeDependents: includeDownstreamDependents, fullRefresh });
}

export async function runTag(context:vscode.ExtensionContext, includeDependencies: boolean, includeDependents: boolean, fullRefresh:boolean, executionMode:ExecutionMode) {
    executionMode = resolveExecutionMode(executionMode);
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

        let workspaceFolder = await getWorkspaceFolder({ explain: true });
        if (!workspaceFolder) { return; }

        if(executionMode === "cli"){
            if (!(await beginRun({ kind: 'tags', items: [selection], includeDependencies, includeDependents, fullRefresh, executionMode: 'cli', workspaceFolder }))) { return; }

            let cmd = "";
            if (includeDependencies) {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], true, false, false);
            } else if (includeDependents) {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], false, true, false);
            } else {
                cmd = getRunTagsWtOptsCommand(workspaceFolder, [selection], false, false, false);
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
    // Prepares defer to prod and saves the run once it is about to dispatch, so a cancelled run does not replace the last one.
    const recordThisRun = (workspaceFolder: string) => beginRun({
        kind: 'tags',
        items: tagsToRun,
        includeDependencies: transitiveDependenciesIncluded,
        includeDependents: transitiveDependentsIncluded,
        fullRefresh: fullyRefreshIncrementalTablesEnabled,
        executionMode: executionMode === "api_workspace" ? "api_workspace" : "api",
        workspaceFolder,
    });

    const invocationConfig = {
        includedTags: tagsToRun,
        transitiveDependenciesIncluded: transitiveDependenciesIncluded,
        transitiveDependentsIncluded: transitiveDependentsIncluded,
        fullyRefreshIncrementalTablesEnabled: fullyRefreshIncrementalTablesEnabled,
    };

    if(executionMode === "api_workspace"){
        const runFolder = await getWorkspaceFolder({ explain: true });
        if (runFolder && !(await recordThisRun(runFolder))) {
            return;
        }
        await showLoadingProgress(
            "",
            syncAndrunDataformRemotely,
            "Dataform remote workspace execution cancelled",
            context,
            invocationConfig,
            globalThis.compilerOptionsMap,
        );
        return;
    }

    if (!(await confirmRemoteRun())) {
        return;
    }

    let workspaceFolder = await getWorkspaceFolder({ explain: true });
    if (!workspaceFolder) { return; }
    if (!(await recordThisRun(workspaceFolder))) { return; }
    await ensureFreshCompilation(workspaceFolder, resolveDataformOptions(workspaceFolder));

    const gcpProjectIdOveride = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
    const projectId = (gcpProjectIdOveride || compiledJson()?.projectConfig.defaultDatabase) as string | undefined;
    if(!projectId){
        vscode.window.showErrorMessage(`Unable to determine GCP project Id in Dataform config`);
        return;
    }

    if(!compiledJson()){
        vscode.window.showErrorMessage(`Unable to compile dataform project. Run "dataform compile" in the terminal to check`);
        return;
    }

    try{

        const gitClient = new GitService();
        const gitInfo = await gitClient.getGitBranchAndRepoName();
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

        const dataformClient = new (await loadDataformTools())(projectId, gcpProjectLocation);

        const output = await dataformClient.runDataformRemotely(repositoryName, globalThis.compilerOptionsMap, invocationConfig, undefined, gitInfo.gitBranch);
        if(!output){
            throw new Error("Error creating workflow invocation");
        }
        await sendWorkflowInvocationNotification(
            output.workflowInvocationUrl, 
            context, 
            invocationConfig, 
            gitInfo.gitBranch, 
            executionMode as 'api' | 'api_workspace', 
            output.workflowInvocationId, 
            projectId, 
            gcpProjectLocation, 
            repositoryName
        );
        //NOTE: I am assuming that if the user has got this far the location set was correct, so caching it
        await context.globalState.update(`vscode_dataform_tools_${repositoryName}`, gcpProjectLocation);

    }catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
}