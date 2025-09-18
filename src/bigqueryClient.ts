import * as vscode from 'vscode';
import { BigQuery } from '@google-cloud/bigquery';

let bigquery: BigQuery | undefined;
let authenticationCheckInterval: NodeJS.Timeout | undefined;
let lastAuthCheck: number = 0;
let isAuthenticated: boolean = false;

export async function createBigQueryClient(): Promise<string | undefined> {
    try {
        const projectId = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
        const serviceAccountJsonPath  = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');

        // default state will be projectId as null and the projectId will be inferred from what the user has set using gcloud cli
        let options = {projectId};
        if(serviceAccountJsonPath){
            vscode.window.showInformationMessage(`Using service account at: ${serviceAccountJsonPath}`);
            // @ts-ignore 
            options = {... options , keyFilename: serviceAccountJsonPath};
        }

        // @ts-ignore 
        bigquery = new BigQuery(options);
        await verifyAuthentication();
        vscode.window.showInformationMessage('BigQuery client created successfully.');
        return undefined;
    } catch (error: any) {
        bigquery = undefined;
        isAuthenticated = false;
        const errorMessage = `Error creating BigQuery client: ${error?.message}`;
        vscode.window.showErrorMessage(errorMessage);
        return errorMessage;
    }
}

async function verifyAuthentication() {
    try {
        if (!bigquery) {
            throw new Error('BigQuery client not initialized');
        }
        await bigquery.query('SELECT 1');
        isAuthenticated = true;
        lastAuthCheck = Date.now();
    } catch (error) {
        isAuthenticated = false;
        throw error;
    }
}

export async function checkAuthentication(): Promise<string | undefined> {
    if (!bigquery || !isAuthenticated) {
        return await createBigQueryClient();
    }

    const useIntervalCheck = vscode.workspace.getConfiguration('vscode-dataform-tools').get('bigqueryAuthenticationCheck', true);

    if (useIntervalCheck) {
        const timeSinceLastCheck = Date.now() - lastAuthCheck;
        if (timeSinceLastCheck > 55 * 60 * 1000) { // 55 minutes in milliseconds
            try {
                await verifyAuthentication();
            } catch (error) {
                vscode.window.showWarningMessage('BigQuery authentication expired. Recreating client...');
                return await createBigQueryClient();
            }
        }
    }
    return undefined;
}

export function getBigQueryClient(): BigQuery | undefined {
    return isAuthenticated ? bigquery : undefined;
}

export function setAuthenticationCheckInterval() {
    const useIntervalCheck = vscode.workspace.getConfiguration('vscode-dataform-tools').get('bigqueryAuthenticationCheck', true);

    clearAuthenticationCheckInterval();

    if (useIntervalCheck) {
        authenticationCheckInterval = setInterval(async () => {
            await checkAuthentication();
        }, 60 * 60 * 1000); // Check every hour
    }
}

export function clearAuthenticationCheckInterval() {
    if (authenticationCheckInterval) {
        clearInterval(authenticationCheckInterval);
        authenticationCheckInterval = undefined;
    }
}

export async function handleBigQueryError(error: any): Promise<void> {
    if (error?.message?.includes('authentication')) {
        vscode.window.showWarningMessage('BigQuery authentication error. Recreating client...');
        await createBigQueryClient();
    }
    throw error;
}