import * as vscode from 'vscode';
import path from 'path';
import * as fs from 'fs/promises'; 
import {CompilationType} from "./types";
import { getGitBranchAndRepoName } from './getGitMeta';

import { DataformClient  } from '@google-cloud/dataform';
import { protos } from '@google-cloud/dataform';
import {getLocalGitState as getLocalGitState, getGitStatusCommitedFiles, getGitUserMeta} from "./getGitMeta";
import { getWorkspaceFolder } from './utils';
import { DataformApi } from './dataformClass';

type CreateCompilationResultResponse = Promise<
  [
    protos.google.cloud.dataform.v1beta1.ICompilationResult,
    protos.google.cloud.dataform.v1beta1.ICreateCompilationResultRequest | undefined,
    {} | undefined
  ]
>;

type InvocationConfig = protos.google.cloud.dataform.v1beta1.IInvocationConfig;


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

//TODO: add appropriate type here
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


export async function createDataformWorkspace(client: DataformClient, projectId:string, location: string, dataformRepositoryName:string, workspaceId:string){
    const parent = `projects/${projectId}/locations/${location}/repositories/${dataformRepositoryName}`;
    const request = {
        parent: parent,
        workspaceId: workspaceId,
    };

    const [workspace] = await client.createWorkspace(request);
    vscode.window.showInformationMessage(`Workspace created: ${workspace.name}`);
    const gitUserMeta = await getGitUserMeta();
    if(gitUserMeta && gitUserMeta.name && gitUserMeta.email){
        await client.pullGitCommits({
            name: workspace.name,
            author: {
                name: gitUserMeta.name,
                emailAddress: gitUserMeta.email
            },
            remoteBranch: workspaceId
        });
        vscode.window.showInformationMessage(`[done] pulled latest changes from remote: ${workspace.name}`);
    }
    return workspace.name;
}


export async function writeFileToWorkspace(workspace:string, relativePath:string, fullPath:string) {
    const client = new DataformClient();

    try {
        const data = await fs.readFile(fullPath, 'utf8');

        const request = {
            workspace: workspace,
            path: relativePath,
            contents: Buffer.from(data),
        };

        await client.writeFile(request);
        vscode.window.showInformationMessage(`File written to workspace: ${fullPath}`);

    } catch (error: any) {
        console.error('Operation Error:', error);
        vscode.window.showErrorMessage('Error writing file to workspace:', error.message);
    }
}

async function fileExistsInWorkspace(client: DataformClient, workspace:string, relativePath:string) {
    try {
        await client.readFile({
            workspace: workspace,
            path: relativePath
        });
        return true;
    } catch (error:any) {
        if (error.code === 5) { // NOT_FOUND
            vscode.window.showWarningMessage(`${relativePath} does not exsist`);
            return false;
        }
        throw error; // Rethrow unexpected errors
    }
}

export async function deleteFileInWorkspace(client:DataformClient, workspace:string, relativePath:string, fullPath:string) {
    const fileExsistInRemoteWorkspace = await fileExistsInWorkspace(client, workspace, relativePath);
    if(fileExsistInRemoteWorkspace){
        const client = new DataformClient();
        try {
            const request = {
                workspace: workspace,
                path: relativePath,
            };
            await client.removeFile(request);
            vscode.window.showInformationMessage(`Deleted ${fullPath} in workspace`);

        } catch (error: any) {
            vscode.window.showErrorMessage(`Error deleting ${fullPath} to workspace:', error.message`);
        }

    }
}

export async function runWorkflowInvocationWorkspace(dataformClient: DataformApi, invocationConfig: InvocationConfig, compilationType:CompilationType): Promise<CreateCompilationResultResponse | undefined>{

    const [gitStatusLocalUnCommited, gitStatusLocalCommited] = await Promise.all([
        await getLocalGitState(),
        await getGitStatusCommitedFiles(dataformClient.workspaceId)
    ]);

    // TODO: create an object with git status to use for a file based on commited and uncommited changes
    // TODO: check if we can ignore the later earlier status of the file from a previous commit in gitStatusLocalCommited
    if(gitStatusLocalUnCommited.length === 0 && gitStatusLocalCommited.length === 0){
        await dataformClient.resetWorkspaceChanges(true);
    }

    //FIXME: i think this fails when the remote repo does not exsist yet
    let gitStatusRemote =  await dataformClient.getRemoteWorkspaceGitState();
    if(!gitStatusRemote){
        return;
    }
    const gitStatusRemoteUncommitedChanges = gitStatusRemote[0].uncommittedFileChanges;
    //@ts-ignore
    //FIXME: fix the typing error
    //TODO: is there a more optimal approach that creating multiple data structures here 
    const gitStatusRemoteMap = Object.fromEntries(gitStatusRemoteUncommitedChanges?.map((item) => [item.path, item.state]));
    const gitStatusLocalMap = Object.fromEntries(gitStatusLocalUnCommited?.map((item:any) => [item.path, item.state]));
    const gitStatusLocalFullPathMap = Object.fromEntries(gitStatusLocalUnCommited?.map((item:any) => [item.path, item.fullPath]));

    vscode.window.showInformationMessage("[...] Syncronising remote workspace with local state");
    await Promise.all(gitStatusLocalUnCommited.map(async ({ state, path, fullPath } : {state: string, path:string, fullPath:string}) => {
        if (state === "ADDED" || state === "MODIFIED") {
            //TODO: can we only pass the full path and infer the relative path later ?
            await dataformClient.writeFileToWorkspace(fullPath, path);
        } else if (state === "DELETED") {
            await dataformClient.deleteFileInWorkspace(path);
        }
    }));

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
                if(gitStatusLocalMap[remotePath]!== state){
                    if(gitStatusLocalMap[remotePath]){
                        await dataformClient.writeFileToWorkspace(gitStatusLocalFullPathMap[remotePath], remotePath);
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
        vscode.window.showInformationMessage("Creating compilation result");
        const createdCompilationResult = await dataformClient.createCompilationResult(compilationType);
        const fullCompilationResultName = createdCompilationResult[0].name;

        if(fullCompilationResultName){
            const createdWorkflowInvocation = await dataformClient.createDataformWorkflowInvocation(invocationConfig, fullCompilationResultName);
            if(createdWorkflowInvocation?.url){
                sendWorkflowInvocationNotification(createdWorkflowInvocation.url);
            }
        }
    } catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
    return;
}
