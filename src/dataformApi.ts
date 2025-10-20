import * as vscode from 'vscode';
import { getGitBranchAndRepoName } from './getGitMeta';

import { DataformClient  } from '@google-cloud/dataform';
import { protos } from '@google-cloud/dataform';

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

        // vscode.window.showInformationMessage("Creating workflow invocation...");

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
