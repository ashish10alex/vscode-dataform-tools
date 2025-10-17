import * as vscode from 'vscode';
import path from 'path';
import * as fs from 'fs/promises'; 
import { getGitBranchAndRepoName } from './getGitMeta';

import { DataformClient  } from '@google-cloud/dataform';
import { protos } from '@google-cloud/dataform';
import {getGitStatusFiles as getLocalGitState, getGitStatusCommitedFiles} from "./getGitMeta";
import { getWorkspaceFolder } from './utils';

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
    // vscode.window.showInformationMessage("Creating compilation result...");

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

async function _createDataformWorkflowInvocation(client: DataformClient, projectId:string, gcpProjectLocation:string, repositoryName:string, workspaceId:string, createWorkflowInvocationRequest:any){
    vscode.window.showInformationMessage("Creating workflow invocation");
    const createdWorkflowInvocation = await client.createWorkflowInvocation(createWorkflowInvocationRequest);
    if(createdWorkflowInvocation[0]?.name){
        const workflowInvocationId = createdWorkflowInvocation[0].name.split("/").pop();
        const workflowInvocationUrlGCP = `https://console.cloud.google.com/bigquery/dataform/locations/${gcpProjectLocation}/repositories/${repositoryName}/workspaces/${workspaceId}/workflows/${workflowInvocationId}?project=${projectId}`;
        // https://console.cloud.google.com/bigquery/dataform/locations/europe-west2/repositories/football_dataform/workspaces/dev_test_new/workflows/1760705131-4205af3f-1a7e-4063-a58a-2db11c345641?project=drawingfire-b72a8

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
    }
    return createdWorkflowInvocation;
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
        const {gitRepoName, gitBranch} = await getGitBranchAndRepoName() || {}; 
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
    vscode.window.showInformationMessage(`Workspace created: ${workspace}`);
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

async function getRemoteGitState(client: DataformClient, workspace:string) {
  try {
    const request = {
      name: workspace
    };

    const output = await client.fetchFileGitStatuses(request);
    return output;
  } catch (error) {
    console.error('Unexpected error:', error);
    return undefined;
  }
}


export async function runWorkflowInvocationWorkspace(client: DataformClient, projectId:string, gcpProjectLocation:string, dataformRepositoryName:string, workspaceId:string, tagsToRun:string[]): Promise<CreateCompilationResultResponse | undefined>{

    const workspace = `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${dataformRepositoryName}/workspaces/${workspaceId}`;
    const parent = `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${dataformRepositoryName}`;

    //TODO: call getLocalGitState, getGitStatusCommitedFiles simultaneously 
    const gitStatusLocal = await getLocalGitState();
    if(gitStatusLocal.length === 0){
        //FIXME: we might need to call this regardless of weather there are any uncommited git changes locally ?
        const gitStatusLocalCommited = await getGitStatusCommitedFiles(workspaceId);
        console.log(gitStatusLocalCommited);
        const request = {
            name: workspace,
            clean: true
        };
        await client.resetWorkspaceChanges(request);
    }

    let gitStatusRemote = await getRemoteGitState(client, workspace);
    if(!gitStatusRemote){
        return;
    }
    const gitStatusRemoteUncommitedChanges = gitStatusRemote[0].uncommittedFileChanges;
    //@ts-ignore
    //FIXME: fix the typing error
    const gitStatusRemoteMap = Object.fromEntries(gitStatusRemoteUncommitedChanges?.map((item) => [item.path, item.state]));
    const gitStatusLocalMap = Object.fromEntries(gitStatusLocal?.map((item:any) => [item.path, item.state]));
    const gitStatusLocalFullPathMap = Object.fromEntries(gitStatusLocal?.map((item:any) => [item.path, item.fullPath]));

    vscode.window.showInformationMessage("[...] Syncronising remote workspace with local state");
    await Promise.all(gitStatusLocal.map(async ({ state, path, fullPath } : {state: string, path:string, fullPath:string}) => {
        if (state === "ADDED" || state === "MODIFIED") {
            await writeFileToWorkspace(workspace, path, fullPath);
        } else if (state === "DELETED") {
            await deleteFileInWorkspace(client, workspace, path, fullPath);
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
                        await writeFileToWorkspace(workspace, remotePath, gitStatusLocalFullPathMap[remotePath]);
                    } else {
                        const fullPath = path.join(workspaceFolder,remotePath);
                        await writeFileToWorkspace(workspace, remotePath, fullPath);
                    }
                }
                break;
            }
        }));
    }
    vscode.window.showInformationMessage("[done] Syncronised remote workspace with local state");

    const compilationResult = {
        workspace: workspace,
    };

    const invocationConfig = {
        includedTags: tagsToRun,
        transitiveDependenciesIncluded: false,
        transitiveDependentsIncluded: false,
        fullyRefreshIncrementalTablesEnabled: false,
    };

    const createCompilationResultRequest = {
        parent: parent,
        compilationResult: compilationResult,
    };

    try{
        vscode.window.showInformationMessage("Creating compilation result");
        const createdCompilationResult = await client.createCompilationResult(createCompilationResultRequest);
        const fullCompilationResultName = createdCompilationResult[0].name;

        const workflowInvocation = {
            compilationResult: fullCompilationResultName,
            invocationConfig: invocationConfig
        };

        const createWorkflowInvocationRequest = {
            parent: parent,
            workflowInvocation: workflowInvocation,
        };

        const createdWorkflowInvocation = await _createDataformWorkflowInvocation(client, projectId, gcpProjectLocation, dataformRepositoryName, workspaceId, createWorkflowInvocationRequest);
        return createdWorkflowInvocation;
    } catch(error:any){
        vscode.window.showErrorMessage(error.message);
    }
    return;
}
