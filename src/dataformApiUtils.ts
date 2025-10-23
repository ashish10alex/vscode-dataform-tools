import * as vscode from 'vscode';
import path from 'path';
import { getLocalGitState, getGitStatusCommitedFiles } from "./getGitMeta";
import { getWorkspaceFolder } from './utils';
import { DataformApi } from './dataformApi';
import { CreateCompilationResultResponse, InvocationConfig , GitFileChange} from "./types";

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

export async function runWorkflowInvocationWorkspace(dataformClient: DataformApi, invocationConfig: InvocationConfig, remoteGitRepoExsists:boolean): Promise<CreateCompilationResultResponse | undefined>{

    let defaultGitBranch = undefined;
    if(!remoteGitRepoExsists){
        const repository = await dataformClient.getRepository();
        defaultGitBranch = repository[0].gitRemoteSettings?.defaultBranch;
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

    if(gitCommitsAheadBehind[0].commitsAhead){
        let errorMessage = `Push commited changes in the ${dataformClient.gitRepoName} workspace in GCP first`;
        vscode.window.showErrorMessage(errorMessage);
        throw new Error(errorMessage);
    }

    if(gitCommitsAheadBehind[0].commitsBehind){
            //  FIXME: I think we should ask the user before re-setting the changes they have made remotely
            await dataformClient.resetWorkspaceChanges(true);
            if(remoteGitRepoExsists){
                await dataformClient.pullGitCommits();
            }
    }

    const [gitStatusLocalUnCommited, gitStatusLocalCommited, remoteDataformWorkspaceStatus] = await Promise.all([
        await getLocalGitState(),
        remoteGitRepoExsists ?  await getGitStatusCommitedFiles(dataformClient.workspaceId) : await getGitStatusCommitedFiles(defaultGitBranch),
        //NOTE: we are assuming that there will not be any commited changes as we are doing local first development
        //FIXME: explore the error that we might get in that case
        await dataformClient.getRemoteWorkspaceGitState()
    ]);

    if(!remoteDataformWorkspaceStatus){
        //FIXME: verify if this is the right thing to do
        return;
    }
    //NOTE: we are assuming that there will not be any commited changes as we are doing local first development
    const gitRemoteChanges = remoteDataformWorkspaceStatus[0].uncommittedFileChanges;

    const noLocalGitChanges = gitStatusLocalUnCommited.length === 0 && gitStatusLocalCommited.length === 0;
    if(noLocalGitChanges){
        try{
            //  FIXME: I think we should ask the user before re-setting the changes they have made remotely
            await dataformClient.resetWorkspaceChanges(true);
            if(remoteGitRepoExsists){
                await dataformClient.pullGitCommits();
            }
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


    try{
        vscode.window.showInformationMessage("[...] Creating compilation result & invoking workflow");
        const createdWorkflowInvocation = await dataformClient.runDataformRemotely(invocationConfig, "workspace");
        if(createdWorkflowInvocation?.url){
            sendWorkflowInvocationNotification(createdWorkflowInvocation.url);
        }
    } catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
    return;
}
