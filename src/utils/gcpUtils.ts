import * as vscode from 'vscode';
import { GoogleAuth } from 'google-auth-library';
import { ProjectsClient } from '@google-cloud/resource-manager';
import { checkAuthentication, getBigQueryClient } from '../bigqueryClient';
import { DataformCompiledJson } from '../types';
import { createSelector } from './vscodeUi';
import { gcloudComputeRegions } from '../constants';

export async function getCachedDataformRepositoryLocation(context: vscode.ExtensionContext, repositoryName: string): Promise<string | undefined> {
        let cachedGcpLocation = context.globalState.get<string>(`vscode_dataform_tools_${repositoryName}`);
        if (!cachedGcpLocation) {
            cachedGcpLocation = await createSelector(gcloudComputeRegions, "Select Dataform repository location");
        }
        return cachedGcpLocation;
}

export async function getCurrentGcpProjectId(): Promise<string | undefined> {
    try {
        const auth = new GoogleAuth();
        const projectId = await auth.getProjectId();
        return projectId;
    } catch (err) {
        console.error("Failed to get project ID:", err);
        return undefined;
    }
}

export async function getLocationOfGcpProject(projectId: string){
    try{
        const client = new ProjectsClient();
        const [project] = await client.getProject({
            name: `projects/${projectId}`
        });
        return project.labels?.application_region;
    } catch(err){
        const e = err instanceof Error ? err : new Error(String(err));
        vscode.window.showErrorMessage(`Run failed: ${e.message}`);
        return undefined;
    }
}

export async function getGcpProjectLocationDataform(projectId:string, compiledDataformJson:DataformCompiledJson) {
    let gcpProjectLocation;

    if (compiledDataformJson?.projectConfig?.defaultLocation) {
        gcpProjectLocation = compiledDataformJson.projectConfig.defaultLocation;
    } else {
        vscode.window.showWarningMessage(`Determing GCP compute location using API. Define it in Dataform config for faster invocation`);
        gcpProjectLocation = await getLocationOfGcpProject(projectId);
    }

    if (!gcpProjectLocation) {
        throw new Error(`Unable to determine GCP project location for project ID: ${projectId}`);
    }

    return gcpProjectLocation;
}

export async function getGcpProjectIdDataform(compiledDataformJson:DataformCompiledJson) {
    let gcpProjectId;

    if (compiledDataformJson?.projectConfig?.defaultDatabase) {
        gcpProjectId = compiledDataformJson.projectConfig.defaultDatabase;
    } else {
        vscode.window.showWarningMessage(`Determing GCP project ID using API. Define it in Dataform config for faster invocation`);
        gcpProjectId = await getCurrentGcpProjectId();
    }

    if (!gcpProjectId) {
        throw new Error(`Unable to determine GCP project id`);
    }

    return gcpProjectId;
}

export async function getGcpProjectIds(){
    let gcpProjectIds = [];

    //TODO: need to check what happens when there is an error ?
    const client = new ProjectsClient();
    const projects = client.searchProjectsAsync();
    vscode.window.showInformationMessage("Loading available GCP projects...");
    for await (const project of projects) {
        if(project.projectId){
            gcpProjectIds.push(project.projectId);
        }
    }
    return gcpProjectIds;
}

export async function getTableSchema(projectId: string, datasetId: string, tableId: string): Promise<{ name: string, metadata: { fullTableId: string } }[]> {
    try {
        await checkAuthentication();
        const bigquery = getBigQueryClient();
        if (!bigquery) {
            vscode.window.showErrorMessage('Error creating BigQuery client Please check your authentication.');
            return [];
        }
        const dataset = bigquery.dataset(datasetId, { projectId: projectId });
        const [table] = await dataset.table(tableId).get();
        return table.metadata.schema.fields.map((field: { name: string, type: string, description: string }) => {
            return {
                name: field.name,
                metadata: {
                    fullTableId: `${projectId}.${datasetId}.${tableId}`,
                    type: `${field.type}`,
                    description: `${field?.description || ""}`

                }
            };
        });
    } catch (error) {
        // we do not want to throw an error as it would be an annoying editing experience to have this error constantly popping up
        return [];
    }
}
