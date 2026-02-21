import * as vscode from 'vscode';
import * as fs from 'fs/promises'; 
import path from 'path';
import {GitService} from "./gitClient";
import { getWorkspaceFolder, runCompilation, getCachedDataformRepositoryLocation} from './utils';
import { DataformTools } from "@ashishalex/dataform-tools";
import { CreateCompilationResultResponse , GitFileChange, CodeCompilationConfig, InvocationConfig} from "./types";

export function sendWorkflowInvocationNotification(
    url: string,
    context?: vscode.ExtensionContext,
    invocationConfig?: InvocationConfig,
    workspaceName?: string,
    executionMode?: 'api' | 'api_workspace'
) {
    if (context && url) {
        const storedUrls = context.workspaceState.get<{
            url: string;
            timestamp: number;
            workspace: string;
            includeDependencies: boolean;
            includeDependents: boolean;
            fullRefresh: boolean;
            executionMode?: 'api' | 'api_workspace';
        }[]>('dataform_workflow_urls') || [];

        storedUrls.push({
            url,
            timestamp: Date.now(),
            workspace: workspaceName || 'unknown',
            includeDependencies: invocationConfig?.transitiveDependenciesIncluded || false,
            includeDependents: invocationConfig?.transitiveDependentsIncluded || false,
            fullRefresh: invocationConfig?.fullyRefreshIncrementalTablesEnabled || false,
            executionMode: executionMode || 'api',
        });
        context.workspaceState.update('dataform_workflow_urls', storedUrls);
    }
    vscode.window.showInformationMessage(
        `Workflow invocation created`,
        'View workflow execution'
    ).then(selection => {
        if (selection === 'View workflow execution') {
            if(url){
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        }
    });
}

async function resetWorkspaceChangesFollowedByGitPull(dataformClient: DataformTools, gitClient: GitService, repositoryName:string, workspaceName:string, remoteGitRepoExsists:boolean, gitCommitsBehind:number){
    let userResponse: string | undefined = "No";
    if(gitCommitsBehind>0){
        userResponse = await vscode.window.showWarningMessage(
            `Dataform workspace ${workspaceName} is behind origin/${workspaceName} by ${gitCommitsBehind} commit(s).  Running "git restore ." followed by "git pull" to allign with the latest state. Do you want to proceed ?`,
                {modal: true},
                "Yes",
                "No"
        );
    }else{
        userResponse = "Yes";
    }

    if(userResponse === "Yes"){
        await dataformClient.resetWorkspaceChanges(repositoryName, workspaceName, [], true);
        if(remoteGitRepoExsists){
            const gitUser = await gitClient.getGitUserMeta() || {name: "", email: ""};
            if(gitUser && gitUser.name && gitUser.email){
                await dataformClient.pullGitCommits(repositoryName, workspaceName, {remoteBranch: workspaceName ,emailAddress: gitUser.email, userName: gitUser.name});
            }
        }
        await dataformClient.installNpmPackages(repositoryName, workspaceName);
        return true;
    } else {
        vscode.window.showInformationMessage("Git restore operation in remote workspace cancelled, exiting...");
        return false;
    }
}

export async function syncRemoteWorkspaceToLocalBranch(dataformClient: DataformTools, gitClient: GitService, repositoryName:string, workspaceName:string, remoteGitRepoExsists:boolean){
    let defaultGitBranch = undefined;
    if(!remoteGitRepoExsists){
        const repository = await dataformClient.getRepository(repositoryName);
        defaultGitBranch = repository.gitRemoteSettings?.defaultBranch;
        if(!defaultGitBranch){
            defaultGitBranch = await vscode.window.showInputBox({
                placeHolder: "Enter default git branch",
                prompt: 'e.g. main',
                value: 'main' 
            });
        }
    }else{
        defaultGitBranch = workspaceName;
    }

    if(!defaultGitBranch){
        vscode.window.showErrorMessage("Need a default git branch to compare the local changes to");
        return;
    }

    const gitCommitsAheadBehind = await dataformClient.fetchGitAheadBehind(repositoryName, workspaceName, workspaceName);
    const gitCommitsAhead = gitCommitsAheadBehind.commitsAhead || 0;
    const gitCommitsBehind = gitCommitsAheadBehind.commitsBehind || 0;


    if (gitCommitsAhead > 0) {
        if (!remoteGitRepoExsists) {
            // Remote doesn't exist → create it by pushing (creates branch automatically)
            await dataformClient.pushWorkspaceCommits(repositoryName, workspaceName, workspaceName);
        } else {
            // Remote exists → warn the user
            const warningMessage = `There are ${gitCommitsAhead} un-pushed commits in ${workspaceName} workspace in GCP. Push them first?`;
            const response = await vscode.window.showWarningMessage(warningMessage, { modal: true }, "Yes", "No");

            if (response !== "Yes") {
                throw new Error(`Un-pushed commits in remote workspace ${workspaceName}, aborting sync`);
            }

            await dataformClient.pushWorkspaceCommits(repositoryName, workspaceName, workspaceName);
        }
    }

    if(gitCommitsBehind > 0){
        try{
           if(!await resetWorkspaceChangesFollowedByGitPull(dataformClient, gitClient, repositoryName, workspaceName, remoteGitRepoExsists, gitCommitsBehind)){
            return;
           };
        }catch(error:any){
            vscode.window.showErrorMessage(error.message);
        }
    }

    const [gitStatusLocalUnCommited, gitStatusLocalCommited, remoteDataformWorkspaceStatus] = await Promise.all([
        await gitClient.getLocalGitState(),
        //NOTE: defaultGitBranch gets assigned to workspaceId when remote git repository exsists
        await gitClient.getGitStatusCommitedFiles(defaultGitBranch),
        await dataformClient.getWorkspaceGitState(repositoryName, workspaceName)
    ]);

    if(!remoteDataformWorkspaceStatus){
        vscode.window.showErrorMessage(`Could not get determine git status for workspace ${workspaceName}`);
        return;
    }
    const gitRemoteChanges = remoteDataformWorkspaceStatus.uncommittedFileChanges;

    const noLocalGitChanges = gitStatusLocalUnCommited.length === 0 && gitStatusLocalCommited.length === 0;
    if(noLocalGitChanges){
        try{
           if(!await resetWorkspaceChangesFollowedByGitPull(dataformClient, gitClient, repositoryName, workspaceName, remoteGitRepoExsists, 0)){
            return;
           };
        }catch(error:any){
            vscode.window.showErrorMessage(error.message);
        }
    } else {
        vscode.window.showInformationMessage("[...] Syncronising remote workspace with local state");
        const finalGitLocalChanges = new Map<string, GitFileChange>();

        gitStatusLocalUnCommited.forEach((change: GitFileChange) => {
            finalGitLocalChanges.set(change.path, change);
        });

        gitStatusLocalCommited.forEach((change: GitFileChange) => {
            if(!finalGitLocalChanges.has(change.path)){
                finalGitLocalChanges.set(change.path, change);
            }else{
                const exsistingChange = finalGitLocalChanges.get(change.path);
                if(exsistingChange && (change.commitIndex < exsistingChange?.commitIndex)){
                    finalGitLocalChanges.set(change.path, change);
                }
            }
        });


        let configFileChanged = false;
        let configFilesChanged = [];

        // NOTE: doing this as we are getting following error when doing Promise.all 
        // 10 ABORTED: sync mutate calls cannot be queued
        for (const {state, path: relativePath, fullPath} of finalGitLocalChanges.values()){
            const baseFileName = relativePath.split("/").pop();
            if(baseFileName === "workflow_settings.yaml" || baseFileName === "dataform.json" || baseFileName === "package.json"){
                configFileChanged = true;
                configFilesChanged.push(baseFileName);
            }
            if(state === "ADDED" || state === "MODIFIED"){
                const fileContents = await fs.readFile(fullPath, 'utf8');
                await dataformClient.writeFile(repositoryName, workspaceName, relativePath, fileContents);
            } else if (state === "DELETED"){
                try{
                    await dataformClient.removeFile(repositoryName, workspaceName, relativePath);
                }catch(error:any){
                    if(error.code === 5){
                        vscode.window.showWarningMessage(`${error.message}`);
                    }else{
                        throw(error);
                    }
                }
            }
        }

        if(configFileChanged){
            vscode.window.showInformationMessage(`${configFilesChanged.join("")} were modified. Installing packages`);
            await dataformClient.installNpmPackages(repositoryName, workspaceName);
        }

        if (gitRemoteChanges && gitRemoteChanges.length > 0) {
            const workspaceFolder = await getWorkspaceFolder();
            if(!workspaceFolder) { return;}

            for (const remoteChange of gitRemoteChanges){
                const remotePath = remoteChange?.path;
                if (remoteChange.state === "DELETED"){
                    if(remotePath){
                        const finalLocalVersion  = finalGitLocalChanges.get(remotePath);
                        const fileLocallyNotDeleted = finalLocalVersion && finalLocalVersion?.state !== "DELETED";
                        const fileLocallyNotChanged = !finalLocalVersion;
                        if(fileLocallyNotDeleted || fileLocallyNotChanged){
                            const fullPath = path.join(workspaceFolder, remotePath);
                            const fileContents = await fs.readFile(fullPath, 'utf8');
                            await dataformClient.writeFile(repositoryName, workspaceName, remotePath, fileContents);
                        }
                    }
                } else {
                    if(remotePath && !finalGitLocalChanges.get(remotePath)){
                        const fullPath = path.join(workspaceFolder, remotePath);
                        const fileContents = await fs.readFile(fullPath, 'utf8');
                        await dataformClient.writeFile(repositoryName, workspaceName, remotePath, fileContents);
                    }
                }
            }
        }
        vscode.window.showInformationMessage("[done] Syncronised remote workspace with local state");
    }
}

export async function compileAndCreateWorkflowInvocation(dataformClient: DataformTools, repositoryName:string, workspaceName:string,  codeCompilationConfig:CodeCompilationConfig, invocationConfig: InvocationConfig, context?: vscode.ExtensionContext): Promise<CreateCompilationResultResponse | undefined>{
    try{
        vscode.window.showInformationMessage("[...] Creating compilation result & invoking workflow");
        const output = await dataformClient.runDataformRemotely(repositoryName, codeCompilationConfig, invocationConfig, workspaceName, undefined);
        if(!output){
            vscode.window.showErrorMessage("Error creating workflow invocation");
            return;
        }
        sendWorkflowInvocationNotification(output.workflowInvocationUrl, context, invocationConfig, workspaceName, "api_workspace");
    } catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
    return;
}

export async function syncAndrunDataformRemotely(progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken, context:vscode.ExtensionContext, invocationConfig:any, codeCompilationConfig?:CodeCompilationConfig){
        // 1
        progress.report({ message: 'Checking for cached compilation of Dataform project...', increment: 0 });
        if (!CACHED_COMPILED_DATAFORM_JSON) {
            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Operation cancelled during compilation check.');
                return;
            }

            let workspaceFolder = await getWorkspaceFolder();
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder selected.');
                return;
            }

            // 1
            progress.report({ message: 'Cache miss, compiling Dataform project...', increment: 14.28 });
            let { dataformCompiledJson } = await runCompilation(workspaceFolder); // ~1100ms
            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Operation cancelled during compilation.');
                return;
            }

            if (dataformCompiledJson) {
                CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
            } else {
                vscode.window.showErrorMessage(`Unable to compile Dataform project. Run "dataform compile" in the terminal to check`);
                return;
            }
        } 

        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during GCP validation.');
            return;
        }

        const gcpProjectIdOveride = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
        const gcpProjectId = (gcpProjectIdOveride || CACHED_COMPILED_DATAFORM_JSON.projectConfig.defaultDatabase) as string;
        if (!gcpProjectId) {
            vscode.window.showErrorMessage(`Unable to determine GCP project ID in Dataform config`);
            return;
        }


        const gitClient = new GitService();
        const gitInfo = gitClient.getGitBranchAndRepoName();
        if(!gitInfo || !gitInfo?.gitBranch || !gitInfo.gitRepoName){
            throw new Error("Error determining git repository and or branch name");
        } 
        const workspaceName = gitInfo.gitBranch;
        const repositoryName = gitInfo.gitRepoName;

        const isBehindRemote = await gitClient.localBranchBehindRemote(workspaceName);
        if(isBehindRemote){
            const isBehindError = `Local git branch ${workspaceName} is behind remote origin/${workspaceName}, pull latest changes ?`;
            const response = await vscode.window.showWarningMessage(isBehindError, { modal: true }, "Yes", "No");

            if (response !== "Yes") {
                vscode.window.showInformationMessage("Please pull latest changes and try again, aborting...");
                return;
            }else {
                await gitClient.triggerGitPull(workspaceName);
            }
        }

        const gcpProjectLocation = await getCachedDataformRepositoryLocation(context, repositoryName);
        if (!gcpProjectLocation) {
            vscode.window.showInformationMessage("Could not determine the location where Dataform repository is hosted, aborting...");
            return;
        }

        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during GCP location fetch.');
            return;
        }

        // 2
        progress.report({ message: 'Initializing Dataform client...', increment: 14.28 });
        const serviceAccountJsonPath  = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');
        let clientOptions = { projectId: gcpProjectId };
        if(serviceAccountJsonPath){
            vscode.window.showInformationMessage(`Using service account at: ${serviceAccountJsonPath}`);
            // @ts-ignore 
            clientOptions = {... clientOptions , keyFilename: serviceAccountJsonPath};
        }


        const dataformClient = new DataformTools(gcpProjectId, gcpProjectLocation, clientOptions);
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during Dataform client initialization.');
            return;
        }

        // 3
        progress.report({ message: `Creating Dataform workspace ${workspaceName} if it does not exsist...`, increment: 14.28 });
        try {

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Operation cancelled during workspace creation.');
                return;
            }

            await dataformClient.createWorkspace(repositoryName, workspaceName);
        } catch (error: any) {
            const DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE = 6;
            const DATAFORM_WORKSPACE_PARENT_NOT_FOUND_ERROR_CODE = 5;

            if (error.code === DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE) {
                // vscode.window.showWarningMessage(error.message);
            } else if (error.code === DATAFORM_WORKSPACE_PARENT_NOT_FOUND_ERROR_CODE) {
                error.message += `. Check if the Dataform repository ${repositoryName} exists in GCP`;
                vscode.window.showErrorMessage(error.message);
                throw error;
            } else {
                vscode.window.showErrorMessage(error.message);
                throw error;
            }
        }

        // 4
        progress.report({ message: `Verifying if git remote origin/${workspaceName} exsists...`, increment: 14.28 });
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during git remote check.');
            return;
        }
        let remoteGitRepoExsists = await gitClient.gitRemoteBranchExsists(workspaceName);

        if(remoteGitRepoExsists){
            // 5
            progress.report({ message: `Pulling Git commits into workspace ${workspaceName}...`, increment: 14.28 });
            try {
                const gitUser = await gitClient.getGitUserMeta() || {name: "", email: ""};
                if(gitUser && gitUser.name && gitUser.email){
                    await dataformClient.pullGitCommits(repositoryName, workspaceName, {remoteBranch: workspaceName ,emailAddress: gitUser.email, userName: gitUser.name});
                }else {
                    vscode.window.showWarningMessage(`Could not determine git username and email`);
                    return;
                }
            } catch (error: any) {
                //TODO: should we show user warning, and do a git resotore and pull changes ? 
                const CANNOT_PULL_UNCOMMITED_CHANGES_ERROR_CODE = 9;
                //NOTE: this should not happen anymore as we are checking for git remote first
                // const NO_REMOTE_ERROR_MSG = `9 FAILED_PRECONDITION: Could not pull branch '${dataformClient.workspaceId}' as it was not found remotely.`;

                if (error.code === CANNOT_PULL_UNCOMMITED_CHANGES_ERROR_CODE) {
                    vscode.window.showWarningMessage(error.message);
                } else {
                    throw error;
                }
            }
        }

        // 6
        progress.report({ message: 'Syncing remote workspace to local code...', increment: 14.28 });
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during workspace sync.');
            return;
        }

        //7
        progress.report({ message: 'Syncing remote workspace to local code...', increment: 14.28 });
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled before workflow invocation.');
            return;
        }
        await syncRemoteWorkspaceToLocalBranch(dataformClient, gitClient, repositoryName, workspaceName, remoteGitRepoExsists);

        if(codeCompilationConfig){
            // 8
            progress.report({ message: 'Creating compilation result & invoking workflow...', increment: 14.28 });
            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Operation cancelled before workflow invocation.');
                return;
            }
            await compileAndCreateWorkflowInvocation(dataformClient, repositoryName, workspaceName, codeCompilationConfig, invocationConfig, context);
            //NOTE: I am assuming that if the user has got this far the location set was correct, so caching it
            context.globalState.update(`vscode_dataform_tools_${repositoryName}`, gcpProjectLocation);
        }else{
            vscode.window.showErrorMessage("Code compilation config could not be determined");
        }
};