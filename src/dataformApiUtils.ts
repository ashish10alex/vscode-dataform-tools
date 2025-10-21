import * as vscode from 'vscode';
import path from 'path';
import { DataformClient  } from '@google-cloud/dataform';
import { getLocalGitState as getLocalGitState, getGitStatusCommitedFiles, getGitBranchAndRepoName } from "./getGitMeta";
import { getWorkspaceFolder } from './utils';
import { DataformApi } from './dataformApi';
import { CreateCompilationResultResponse, InvocationConfig } from "./types";

/**
 * Creates compilation object from the latest state of the git branch of the remote repo
 *
 * @param  client - Dataform client
 * @param  parent - string of the format `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${gitRepoName}`
 * @param  gitBranch - name of the git branch from which compilation object is being generated
 * @returns createdCompilationResult
 */
export async function getCompilationResult(client:DataformClient, parent:string, gitBranch:string): CreateCompilationResultResponse{
    const compilationResult = {
        gitCommitish: gitBranch,
    };

    const createCompilationResultRequest = {
        parent: parent,
        compilationResult: compilationResult,
    };

    const createdCompilationResult = await client.createCompilationResult(createCompilationResultRequest);
    return createdCompilationResult;
}

async function sendWorkflowInvocationNotification(url:string){
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

/**
 * Creates workflow invocation from the latest state of the git branch of the remote repository
 *
 * @param  projectId - GCP porject Id
 * @param  gcpPojectLocation - Compute location to use in the GCP project
 * @param  invocationConfig -  Targets / tags to execute with or without dependecies. https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/protos.google.cloud.dataform.v1alpha2.workflowinvocation.iinvocationconfig
 */
export async function createDataformWorkflowInvocation(projectId:string, gcpProjectLocation:string, invocationConfig:InvocationConfig): Promise<{workflowInvocationUrlGCP: string|undefined, errorWorkflowInvocation: string|undefined} | undefined>{
    let workflowInvocationUrlGCP: string | undefined = undefined;
    let errorWorkflowInvocation: string | undefined = undefined;
    let dataformClient: DataformClient|undefined = undefined;
    try {

        // TODO: user might not have git extension, we need a fallback ?
        // TODO: show the information in logger only ?
        // vscode.window.showInformationMessage("Retriving git repository and branch for compilation...");
        const serviceAccountJsonPath  = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');
        let options = {projectId};
        if(serviceAccountJsonPath){
            // vscode.window.showInformationMessage(`Using service account at: ${serviceAccountJsonPath}`);
            // @ts-ignore 
            options = {... options , keyFilename: serviceAccountJsonPath};
        }


        dataformClient = new DataformClient(options);
        const {gitRepoName, gitBranch} = getGitBranchAndRepoName() || {}; 
        const parent = `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${gitRepoName}`;
        const createdCompilationResult = await getCompilationResult(dataformClient, parent, gitBranch);
        const fullCompilationResultName = createdCompilationResult[0].name;

        const workflowInvocation = {
            compilationResult: fullCompilationResultName,
            invocationConfig: invocationConfig,
        };

        const createWorkflowInvocationRequest = {
            parent: parent,
            workflowInvocation: workflowInvocation,
        };

        const createdWorkflowInvocation = await dataformClient.createWorkflowInvocation(createWorkflowInvocationRequest);
        if(createdWorkflowInvocation[0]?.name){
            const workflowInvocationId = createdWorkflowInvocation[0].name.split("/").pop();
            workflowInvocationUrlGCP = `https://console.cloud.google.com/bigquery/dataform/locations/${gcpProjectLocation}/repositories/${gitRepoName}/workflows/${workflowInvocationId}?project=${projectId}`;

            vscode.window.showInformationMessage(
                `Workflow invocation created`,
                'View workflow execution'
            ).then(selection => {
                if (selection === 'View workflow execution') {
                    if(workflowInvocationUrlGCP){
                        vscode.env.openExternal(vscode.Uri.parse(workflowInvocationUrlGCP));
                    }
                }
            });
            return {"workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation};
        }else{
            vscode.window.showErrorMessage(`Workflow invocation could not be determined`);
        }
    }
        catch (error:any) {
            vscode.window.showErrorMessage(JSON.stringify(error));
            errorWorkflowInvocation = error.toString();
            return {"workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation};
        } finally {
            if(dataformClient){
                dataformClient.close();
            }
            return {"workflowInvocationUrlGCP": workflowInvocationUrlGCP, "errorWorkflowInvocation": errorWorkflowInvocation};
        }
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
