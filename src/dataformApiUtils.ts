import * as vscode from 'vscode';
import path from 'path';
import { getLocalGitState, getGitStatusCommitedFiles } from "./getGitMeta";
import { getWorkspaceFolder } from './utils';
import { DataformApi } from './dataformApi';
import { CreateCompilationResultResponse, InvocationConfig } from "./types";

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
    }

    vscode.window.showInformationMessage("[...] Syncronising remote workspace with local state");
    await Promise.all(gitStatusLocalUnCommited.map(async ({ state, path, fullPath } : {state: string, path:string, fullPath:string}) => {
        if (state === "ADDED" || state === "MODIFIED") {
            //TODO: can we only pass the full path and infer the relative path later ?
            await dataformClient.writeFileToWorkspace(fullPath, path);
        } else if (state === "DELETED") {
            await dataformClient.deleteFileInWorkspace(path);
        }
    }));

    const gitStatusLocalUncommitedMap = Object.fromEntries(gitStatusLocalUnCommited?.map((item:{state:string, path:string, fullPath:string, commitIndex:number}) => {
        return [item.path, { state: item.state, fullPath: item.fullPath }];
    }));

    let gitStatusLocalCommitedMap:Record<string, {state: string; fullPath: string; commitIndex: number}> = {};
    for (const changesMeta of gitStatusLocalCommited){
        const state = changesMeta.state;
        const path = changesMeta.path;
        const fullPath = changesMeta.fullPath;
        const commitIndex = changesMeta.commitIndex;

        let fileExsistsInUncommited = Object.hasOwn(gitStatusLocalUncommitedMap, path);

        if(fileExsistsInUncommited){
            continue;
        }

        if (Object.hasOwn(gitStatusLocalCommitedMap, path)) {
            if(commitIndex < gitStatusLocalCommitedMap[path].commitIndex){
                gitStatusLocalCommitedMap[path] = {"state": state, "fullPath": fullPath, "commitIndex": commitIndex};
            }else{
                continue;
            }
        } else {
            gitStatusLocalCommitedMap[path] = {"state": state, "fullPath": fullPath, "commitIndex": commitIndex};
        }
    }

    for (const path of Object.keys(gitStatusLocalCommitedMap)) {
        const state = gitStatusLocalCommitedMap[path].state;
        const fullPath = gitStatusLocalCommitedMap[path].fullPath;
        if (state === "ADDED" || state === "MODIFIED") {
            await dataformClient.writeFileToWorkspace(fullPath, path);
        } else if (state === "DELETED") {
            await dataformClient.deleteFileInWorkspace(path);
        }
    }

    let gitStatusRemote =  await dataformClient.getRemoteWorkspaceGitState();
    //FIXME: check this logic
    if(!gitStatusRemote){
        return;
    }
    //NOTE: we are assuming that there will not be any commited changes as we are doing local first development
    const gitStatusRemoteUncommitedChanges = gitStatusRemote[0].uncommittedFileChanges;

    //@ts-ignore
    //FIXME: fix the typing error
    //TODO: is there a more optimal approach that creating multiple data structures here 
    const gitStatusRemoteMap = Object.fromEntries(gitStatusRemoteUncommitedChanges?.map((item) => [item.path, item.state]));

    if(gitStatusRemoteMap && Object.keys(gitStatusRemoteMap).length > 0){
        //@ts-ignore
        //FIXME: fix the typing error
        await Promise.all(gitStatusRemoteUncommitedChanges.map(async({path: remotePath, state}: {path: string, state:string}) => {
            const workspaceFolder = await getWorkspaceFolder();
            if(!workspaceFolder){
                return;
            }
            switch (state){
                case("DELETED"):
                if(gitStatusLocalUncommitedMap[remotePath].state!== state || gitStatusLocalCommitedMap[remotePath].state!== state){
                    if(gitStatusLocalUncommitedMap[remotePath]){
                        await dataformClient.writeFileToWorkspace(gitStatusLocalUncommitedMap[remotePath].fullPath, remotePath);
                    } else if(gitStatusLocalCommitedMap[remotePath]){
                        await dataformClient.writeFileToWorkspace(gitStatusLocalCommitedMap[remotePath].fullPath, remotePath);
                    } else {
                        const fullPath = path.join(workspaceFolder,remotePath);
                        await dataformClient.writeFileToWorkspace(fullPath, remotePath);
                    }
                }
                break;
            }
        }));
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
