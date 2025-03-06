import * as vscode from 'vscode';
import { BigQuery } from '@google-cloud/bigquery';

let bigquery: BigQuery | undefined;
let authenticationCheckInterval: NodeJS.Timeout | undefined;
let lastAuthCheck: number = 0;
let isAuthenticated: boolean = false;

export async function createBigQueryClient() {
    try {
        const projectId = vscode.workspace.getConfiguration('vscode-dataform-tools').get('bigqueryProjectId');
        // default state will be projectId as null and the projectId will be inferred from what the user has set using gcloud cli
        // @ts-ignore 
        bigquery = new BigQuery({ projectId });
        await verifyAuthentication();
        vscode.window.showInformationMessage('BigQuery client created successfully.');
    } catch (error) {
        bigquery = undefined;
        isAuthenticated = false;
        vscode.window.showErrorMessage(`Error creating BigQuery client: ${error}`);
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

export async function checkAuthentication() {
    if (!bigquery || !isAuthenticated) {
        await createBigQueryClient();
        return;
    }

    const useIntervalCheck = vscode.workspace.getConfiguration('vscode-dataform-tools').get('bigqueryAuthenticationCheck', true);

    if (useIntervalCheck) {
        const timeSinceLastCheck = Date.now() - lastAuthCheck;
        if (timeSinceLastCheck > 55 * 60 * 1000) { // 55 minutes in milliseconds
            try {
                await verifyAuthentication();
            } catch (error) {
                vscode.window.showWarningMessage('BigQuery authentication expired. Recreating client...');
                await createBigQueryClient();
            }
        }
    }
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