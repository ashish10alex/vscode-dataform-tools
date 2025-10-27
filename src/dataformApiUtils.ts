import * as vscode from 'vscode';
import path from 'path';
import { getLocalGitState, getGitStatusCommitedFiles, gitRemoteBranchExsists} from "./getGitMeta";
import { getWorkspaceFolder, runCompilation, getGcpProjectLocationDataform} from './utils';
import { DataformApi } from './dataformApi';
import { CreateCompilationResultResponse, InvocationConfig , GitFileChange, ICodeCompilationConfig} from "./types";

export function sendWorkflowInvocationNotification(url:string){
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

async function resetWorkspaceChangesFollowedByGitPull(dataformClient: DataformApi, remoteGitRepoExsists:boolean, gitCommitsBehind:number){
    let userResponse: string | undefined = "No";
    if(gitCommitsBehind>0){
        userResponse = await vscode.window.showWarningMessage(
            `Dataform workspace ${dataformClient.workspaceId} is behind origin/${dataformClient.workspaceId} by ${gitCommitsBehind} commit(s).  Running "git restore ." followed by "git pull" to allign with the latest state. Do you want to proceed ?`,
                {modal: true},
                "Yes",
                "No"
        );
    }else{
        userResponse = "Yes";
    }

    if(userResponse === "Yes"){
        await dataformClient.resetWorkspaceChanges(true);
        if(remoteGitRepoExsists){
            await dataformClient.pullGitCommits();
        }
        return true;
    } else {
        vscode.window.showInformationMessage("Git restore operation in remote workspace cancelled, exiting...");
        return false;
    }
}

export async function syncRemoteWorkspaceToLocalBranch(dataformClient: DataformApi, remoteGitRepoExsists:boolean){
    let defaultGitBranch = undefined;
    if(!remoteGitRepoExsists){
        const repository = await dataformClient.getRepository();
        defaultGitBranch = repository.gitRemoteSettings?.defaultBranch;
        if(!defaultGitBranch){
            defaultGitBranch = await vscode.window.showInputBox({
                placeHolder: "Enter default git branch",
                prompt: 'e.g. main',
                value: 'main' 
            });
        }
    }else{
        defaultGitBranch = dataformClient.workspaceId;
    }

    if(!defaultGitBranch){
        vscode.window.showErrorMessage("Need a default git branch to compare the local changes to");
        return;
    }

    const gitCommitsAheadBehind = await dataformClient.getGitCommitsAheadAndBehind();
    const gitCommitsAhead = gitCommitsAheadBehind.commitsAhead || 0;
    const gitCommitsBehind = gitCommitsAheadBehind.commitsBehind || 0;

    if(gitCommitsAhead > 0 && !remoteGitRepoExsists){
        // NOTE: this will create the branch in remote if it does not exsists
        await dataformClient.pushWorkspaceCommits();
    } else if(gitCommitsAhead > 0){
        let warningMessage = `There are ${gitCommitsAhead} un-pushed commits in ${dataformClient.gitBranch} workspace in GCP. Push it first ?`;
        const response = await vscode.window.showWarningMessage(warningMessage, {modal: true}, "Yes", "No");
        if(response === "Yes"){
            await dataformClient.pushWorkspaceCommits();
        } else{
            return;
        }
    }

    if(gitCommitsBehind > 0){
        try{
           if(!await resetWorkspaceChangesFollowedByGitPull(dataformClient, remoteGitRepoExsists, gitCommitsBehind)){
            return;
           };
        }catch(error:any){
            vscode.window.showErrorMessage(error.message);
        }
    }

    const [gitStatusLocalUnCommited, gitStatusLocalCommited, remoteDataformWorkspaceStatus] = await Promise.all([
        await getLocalGitState(),
        //NOTE: defaultGitBranch gets assigned to workspaceId when remote git repository exsists
        await getGitStatusCommitedFiles(defaultGitBranch),
        await dataformClient.getRemoteWorkspaceGitState()
    ]);

    if(!remoteDataformWorkspaceStatus){
        vscode.window.showErrorMessage(`Could not get determine git status for workspace ${dataformClient.workspaceId}`)
        return;
    }
    const gitRemoteChanges = remoteDataformWorkspaceStatus.uncommittedFileChanges;

    const noLocalGitChanges = gitStatusLocalUnCommited.length === 0 && gitStatusLocalCommited.length === 0;
    if(noLocalGitChanges){
        try{
           if(!await resetWorkspaceChangesFollowedByGitPull(dataformClient, remoteGitRepoExsists, 0)){
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


        // NOTE: doing this as we are getting following error when doing Promise.all 
        // 10 ABORTED: sync mutate calls cannot be queued
        for (const {state, path, fullPath} of finalGitLocalChanges.values()){
            if(state === "ADDED" || state === "MODIFIED"){
                await dataformClient.writeFileToWorkspace(fullPath, path);
            } else if (state === "DELETED"){
                try{
                    await dataformClient.deleteFileInWorkspace(path);
                }catch(error:any){
                    if(error.code === 5){
                        vscode.window.showWarningMessage(`${error.message}`);
                    }else{
                        throw(error);
                    }
                }
            }
        }

        if (gitRemoteChanges && gitRemoteChanges.length > 0) {
            const workspaceFolder = await getWorkspaceFolder();
            if(!workspaceFolder) { return;}

            for (const remoteChange of gitRemoteChanges){
                const remotePath = remoteChange?.path;
                if (remoteChange.state === "DELETED"){
                    if(remotePath){
                        const finalLocalVersion  = finalGitLocalChanges.get(remotePath);
                        if(finalLocalVersion && finalLocalVersion?.path !== "DELETED"){
                            await dataformClient.writeFileToWorkspace(finalLocalVersion?.fullPath, remotePath);
                        }
                    }
                } else {
                    if(remotePath && !finalGitLocalChanges.get(remotePath)){
                        const fullPath = path.join(workspaceFolder, remotePath);
                        await dataformClient.writeFileToWorkspace(fullPath, remotePath);
                    }
                }
            }
        }
        vscode.window.showInformationMessage("[done] Syncronised remote workspace with local state");
    }
}

export async function compileAndCreateWorkflowInvocation(dataformClient: DataformApi, invocationConfig: InvocationConfig, codeCompilationConfig?:ICodeCompilationConfig): Promise<CreateCompilationResultResponse | undefined>{
    try{
        vscode.window.showInformationMessage("[...] Creating compilation result & invoking workflow");
        const createdWorkflowInvocation = await dataformClient.runDataformRemotely(invocationConfig, "workspace", codeCompilationConfig);
        if(createdWorkflowInvocation?.url){
            sendWorkflowInvocationNotification(createdWorkflowInvocation.url);
        }
    } catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
    return;
}

export async function syncAndrunDataformRemotely(progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken, invocationConfig:any, codeCompilationConfig?:ICodeCompilationConfig){
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

        let gcpProjectLocation = await getGcpProjectLocationDataform(gcpProjectId, CACHED_COMPILED_DATAFORM_JSON);
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

        let options = {
            clientOptions
        }

        const dataformClient = new DataformApi(gcpProjectId, gcpProjectLocation, options);
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during client initialization.');
            return;
        }

        // 3
        progress.report({ message: `Creating Dataform workspace ${dataformClient.workspaceId} if it does not exsist...`, increment: 14.28 });
        try {
            await dataformClient.createWorkspace();
        } catch (error: any) {
            const DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE = 6;
            const DATAFORM_WORKSPACE_PARENT_NOT_FOUND_ERROR_CODE = 5;

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage('Operation cancelled during workspace creation.');
                return;
            }

            if (error.code === DATAFORM_WORKSPACE_EXSIST_IN_GCP_ERROR_CODE) {
                // vscode.window.showWarningMessage(error.message);
            } else if (error.code === DATAFORM_WORKSPACE_PARENT_NOT_FOUND_ERROR_CODE) {
                error.message += `. Check if the Dataform repository ${dataformClient.gitRepoName} exists in GCP`;
                vscode.window.showErrorMessage(error.message);
                throw error;
            } else {
                vscode.window.showErrorMessage(error.message);
                throw error;
            }
        }

        // 4
        progress.report({ message: `Verifying if git remote origin/${dataformClient.workspaceId} exsists...`, increment: 14.28 });
        let remoteGitRepoExsists = await gitRemoteBranchExsists(dataformClient.gitBranch);
        if (token.isCancellationRequested) {
            vscode.window.showInformationMessage('Operation cancelled during workflow execution.');
            return;
        }

        if(remoteGitRepoExsists){
            // 5
            progress.report({ message: `Pulling Git commits into workspace ${dataformClient.workspaceId}...`, increment: 14.28 });
            try {
                await dataformClient.pullGitCommits();
            } catch (error: any) {
                //TODO: should we show user warning, and do a git resotore and pull changes ? 
                const CANNOT_PULL_UNCOMMITED_CHANGES_ERROR_CODE = 9;
                //NOTE: this should not happen anymore as we are checking for git remote first
                // const NO_REMOTE_ERROR_MSG = `9 FAILED_PRECONDITION: Could not pull branch '${dataformClient.workspaceId}' as it was not found remotely.`;

                if (token.isCancellationRequested) {
                    vscode.window.showInformationMessage('Operation cancelled during Git pull.');
                    return;
                }
                if (error.code === CANNOT_PULL_UNCOMMITED_CHANGES_ERROR_CODE) {
                    vscode.window.showWarningMessage(error.message);
                } else {
                    throw error;
                }
            }
        }

        // 6
        progress.report({ message: 'Syncing remote workspace to local code...', increment: 14.28 });
        await syncRemoteWorkspaceToLocalBranch(dataformClient, remoteGitRepoExsists);

        //7
        progress.report({ message: 'Syncing remote workspace to local code...', increment: 14.28 });
        await compileAndCreateWorkflowInvocation(dataformClient, invocationConfig, codeCompilationConfig);
};