import * as vscode from 'vscode';
import { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';

let bigquery: BigQuery | undefined;
let authenticationCheckInterval: NodeJS.Timeout | undefined;
let lastAuthCheck: number = 0;
let isAuthenticated: boolean = false;

let clientCreationPromise: Promise<string | undefined> | undefined;

export async function createBigQueryClient(): Promise<string | undefined> {
    if (clientCreationPromise) {
        return clientCreationPromise;
    }

    clientCreationPromise = (async () => {
        try {
            const projectId : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
            const gcpLocation : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpLocation');
            const serviceAccountJsonPath : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');

            let options: BigQueryOptions = {};
            if(projectId && projectId.trim() !== ''){
                options = {... options , projectId: projectId};
            }

            if(gcpLocation && gcpLocation.trim() !== ''){
                options = {... options , location: gcpLocation};
            }

            if(serviceAccountJsonPath && serviceAccountJsonPath.trim() !== ''){
                vscode.window.showInformationMessage(`Using service account at: ${serviceAccountJsonPath}`);
                options = {... options , keyFilename: serviceAccountJsonPath};
            }

            bigquery = new BigQuery(options);
            await verifyAuthentication();
            const projectIdMessage = projectId ? `Project ID: ${projectId}` : '';
            const gcpLocationMessage = gcpLocation ? `Location: ${gcpLocation}` : '';
            const message = `BigQuery client created successfully. ${projectIdMessage} ${gcpLocationMessage}`;
            vscode.window.showInformationMessage(message);
            return undefined;
        } catch (error: any) {
            bigquery = undefined;
            isAuthenticated = false;
            const errorMessage = `Error creating BigQuery client: ${error?.message}`;
            vscode.window.showErrorMessage(errorMessage);
            return errorMessage;
        } finally {
            clientCreationPromise = undefined;
        }
    })();

    return clientCreationPromise;
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