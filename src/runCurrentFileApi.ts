import * as vscode from 'vscode';
import { getLocationOfGcpProject, getWorkspaceFolder, runCompilation, getMultipleFileSelection, getQueryMetaForCurrentFile} from './utils';
import { getGitBranchAndRepoName } from './getGitMeta';

import { DataformClient } from '@google-cloud/dataform';

export async function runDataformUsingApi() {

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

    vscode.window.showInformationMessage("Retriving git repository and branch for compilation...");
    //TODO: user might not have git extension, we need a fallback ?
    const gitMetaData = await getGitBranchAndRepoName();
    const gitRepoName = gitMetaData?.gitRepoName;
    const gitBranch = gitMetaData?.gitBranch;

    // Initialize the Dataform client.
    // The client automatically picks up credentials from the environment (e.g., GOOGLE_APPLICATION_CREDENTIALS)
    // or from a service account key file path provided in the constructor like:
    // new DataformClient({ keyFilename: 'path/to/your-key.json' });
    const client = new DataformClient();

    const parent = `projects/${projectId}/locations/${gcpProjectLocation}/repositories/${gitRepoName}`;

    try {
        vscode.window.showInformationMessage("🚀 Step 1: Creating compilation result...");

        const compilationResult = {
            gitCommitish: gitBranch,
        };

        const createCompilationResultRequest = {
            parent: parent,
            compilationResult: compilationResult,
        };

        const createdCompilationResult = await client.createCompilationResult(createCompilationResultRequest);
        const fullCompilationResultName = createdCompilationResult[0].name;

        vscode.window.showInformationMessage(`✅ Compilation Result created: ${fullCompilationResultName}`);
        vscode.window.showInformationMessage("\n🚀 Step 2: Creating workflow invocation...");

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

        const INVOCATION_CONFIG = {
            // includedTags: ["engines"], 
            includedTargets: actionsList,
            transitiveDependenciesIncluded: false, 
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

        const createdWorkflowInvocation = await client.createWorkflowInvocation(createWorkflowInvocationRequest);
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

    } catch (error:any) {
        vscode.window.showErrorMessage(JSON.stringify(error));
    } finally {
        // Close the client to release resources.
        client.close();
    }
}