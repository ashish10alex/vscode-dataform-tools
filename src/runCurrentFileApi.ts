import * as vscode from 'vscode';
import { getLocationOfGcpProject, getWorkspaceFolder, runCompilation } from './utils';
import { getGitBranchAndRepoName } from './getGitMeta';

import { DataformClient } from '@google-cloud/dataform';

export async function runDataformWorkflow() {

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
        vscode.window.showErrorMessage("Could not determine projectId");
        return;
    }

    vscode.window.showInformationMessage("Retriving execution location from gcloud...");
    const gcpProjectLocation = await getLocationOfGcpProject(projectId);
    if(!gcpProjectLocation){
        vscode.window.showErrorMessage("Could not get gcp project location using api !");
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

        //TODO: load tags dynamically

        //NOTE: Decide if we should have separate command for tags and files ? 

        const INVOCATION_CONFIG = {
            // includedTags: ["engines"], 
            includedTargets: [
            { database: "project_id", schema: "dataset_name", name: "table_name" },
            ],
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