import * as vscode from 'vscode';
import { getLocationOfGcpProject, getWorkspaceFolder, runCompilation, getMultipleFileSelection, getQueryMetaForCurrentFile} from './utils';
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


/**
 * Creates compilation object from the latest state of the git branch of the remote repo
 *
 * @param  client - Dataform client
 * @param  parent - string of the format `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${gitRepoName}`
 * @param  gitBranch - name of the git branch from which compilation object is being generated
 * @returns createdCompilationResult
 */
export async function getCompilationResult(client:DataformClient, parent:string, gitBranch:string): CreateCompilationResultResponse{
    vscode.window.showInformationMessage("Creating compilation result...");

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

export async function createDataformWorkflowInvocation(projectId:string, gcpProjectLocation:string, actionsList:any[]){
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

        // vscode.window.showInformationMessage(`✅ Compilation Result created: ${fullCompilationResultName}`);
        vscode.window.showInformationMessage("Creating workflow invocation...");

        const INVOCATION_CONFIG = {
            includedTags: [], // NOTE: shouldn't the tags and targets be mutually exclusive ?
            includedTargets: actionsList,
            transitiveDependenciesIncluded: false,
            transitiveDependentsIncluded: false,
            fullyRefreshIncrementalTablesEnabled: false,
        };


        const workflowInvocation = {
            compilationResult: fullCompilationResultName,
            invocationConfig: INVOCATION_CONFIG,
        };

        const createWorkflowInvocationRequest = {
            parent: parent,
            workflowInvocation: workflowInvocation,
        };

        const createdWorkflowInvocation = await dataformClient.createWorkflowInvocation(createWorkflowInvocationRequest);
        if(createdWorkflowInvocation[0]?.name){
            const workflowInvocationId = createdWorkflowInvocation[0].name.split("/").pop();
            const workflowExecutionUrlGCP = `https://console.cloud.google.com/bigquery/dataform/locations/${gcpProjectLocation}/repositories/${gitRepoName}/workflows/${workflowInvocationId}?project=${projectId}`;

            vscode.window.showInformationMessage(
                `Workflow invocation created`,
                'View workflow execution'
            ).then(selection => {
                if (selection === 'View workflow execution') {
                    vscode.env.openExternal(vscode.Uri.parse(workflowExecutionUrlGCP));
                }
            });

        }else{
            vscode.window.showErrorMessage(`Workflow invocation could not be determined`);
        }
    }
        catch (error:any) {
            vscode.window.showErrorMessage(JSON.stringify(error));
        } finally {
            if(dataformClient){
                dataformClient.close();
            }
        }
}


export async function runMultipleFilesUsingDataformApi() {

    if (!CACHED_COMPILED_DATAFORM_JSON) {

        let workspaceFolder = await getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        let {dataformCompiledJson} = await runCompilation(workspaceFolder); // Takes ~1100ms
        if (dataformCompiledJson) {
            CACHED_COMPILED_DATAFORM_JSON = dataformCompiledJson;
        }
    }

    const projectId = CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultDatabase;
    if(!projectId){
        vscode.window.showErrorMessage("Could not determine projectId from dataform config file");
        return;
    }

    vscode.window.showInformationMessage("Retriving execution location from gcloud...");

    let gcpProjectLocation = undefined;
    if(CACHED_COMPILED_DATAFORM_JSON?.projectConfig.defaultLocation){
        gcpProjectLocation = CACHED_COMPILED_DATAFORM_JSON.projectConfig.defaultLocation;
    }else{
        gcpProjectLocation = await getLocationOfGcpProject(projectId);
    }

    if(!gcpProjectLocation){
        vscode.window.showErrorMessage("GCP project location could not be determined from the config file or the api");
        return;
    }
    let workspaceFolder = await getWorkspaceFolder();
    if (!workspaceFolder){ return; }
    let multipleFileSelection = await getMultipleFileSelection(workspaceFolder);
    if(!multipleFileSelection){return;}

    let fileMetadatas: any[] = [];

    if(!CACHED_COMPILED_DATAFORM_JSON){
        vscode.window.showErrorMessage("Compile project before running actions using API");
        return;
    }
    let dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;

    if (multipleFileSelection && dataformCompiledJson !== undefined) {
        for (let i = 0; i < multipleFileSelection.length; i++) {
            let relativeFilepath = multipleFileSelection[i];
            if (dataformCompiledJson && relativeFilepath) {
                fileMetadatas.push(await getQueryMetaForCurrentFile(relativeFilepath, dataformCompiledJson));
            }
        }
    }

    let actionsList: {database:string, schema: string, name:string}[] = [];
    fileMetadatas.forEach(fileMetadata => {
        if (fileMetadata) {
            fileMetadata.tables.forEach((table: { target: { database: string; schema: string; name: string; }; }) => {
                const action = {database: table.target.database, schema: table.target.schema, name: table.target.name};
                actionsList.push(action);
            });
        }
    });
    createDataformWorkflowInvocation(projectId, gcpProjectLocation, actionsList);
}
