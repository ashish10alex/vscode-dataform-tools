import * as vscode from 'vscode';
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
    }

    if(!defaultGitBranch){
        vscode.window.showErrorMessage("Need a default git branch to compare the local changes to");
        return;
    }

    const [gitStatusLocalUnCommited, gitStatusLocalCommited] = await Promise.all([
        await getLocalGitState(),
        remoteGitRepoExsists ?  await getGitStatusCommitedFiles(dataformClient.workspaceId) : await getGitStatusCommitedFiles(defaultGitBranch)
    ]);

    const noLocalGitChanges = gitStatusLocalUnCommited.length === 0 && gitStatusLocalCommited.length === 0;
    if(noLocalGitChanges){
        await dataformClient.resetWorkspaceChanges(true);
        // TODO: If there is no local changed we might want to directly go to compilation and workflow invocation
    }

    vscode.window.showInformationMessage("[...] Syncronising remote workspace with local state");
    const finalGitLocalChanges = new Map<string, GitFileChange>();

    gitStatusLocalUnCommited.forEach((change: GitFileChange) => {
        finalGitLocalChanges.set(change.path, change)
    });

    gitStatusLocalCommited.forEach((change: GitFileChange) => {
        if(!finalGitLocalChanges.has(change.path)){
            finalGitLocalChanges.set(change.path, change)
        }else{
            const exsistingChange = finalGitLocalChanges.get(change.path);
            if(exsistingChange && (change.commitIndex < exsistingChange?.commitIndex)){
                finalGitLocalChanges.set(change.path, change);
            }
        }
    })


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
                    vscode.window.showWarningMessage(`${error.message}`)
                }else{
                    throw(error);
                }
            }
        }
    }

    let gitStatusRemote =  await dataformClient.getRemoteWorkspaceGitState();
    //FIXME: check this logic
    if(!gitStatusRemote){
        return;
    }
    //NOTE: we are assuming that there will not be any commited changes as we are doing local first development
    const gitRemoteChanges = gitStatusRemote[0].uncommittedFileChanges;

    if (gitRemoteChanges && gitRemoteChanges.length > 0) {
        const workspaceFolder = await getWorkspaceFolder();
        if(!workspaceFolder) { return;}

        for (const remoteChange of gitRemoteChanges){
            if (remoteChange.state === "DELETED"){
                const path = remoteChange?.path;
                if(path){
                    const finalLocalVersion  = finalGitLocalChanges.get(path);
                    if(finalLocalVersion && finalLocalVersion?.path !== "DELETED"){
                        await dataformClient.writeFileToWorkspace(finalLocalVersion?.fullPath, path)
                    }
                }
            }
        }
    }
    vscode.window.showInformationMessage("[done] Syncronised remote workspace with local state");

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
