import * as vscode from 'vscode';
import { BigQuery } from '@google-cloud/bigquery';

let bigquery: BigQuery | undefined;
let authenticationCheckInterval: NodeJS.Timeout | undefined;

// Function to create or recreate the BigQuery client
export async function createBigQueryClient() {
    try {
        bigquery = new BigQuery();
        vscode.window.showInformationMessage('BigQuery client created successfully.');
    } catch (error) {
        vscode.window.showErrorMessage(`Error creating BigQuery client: ${error}`);
    }
}

// Function to check authentication and recreate the client if necessary
export async function checkAuthentication() {
    if (!bigquery) {
        await createBigQueryClient();
        return;
    }

    try {
        // Perform a simple query to check authentication status
        await bigquery.query('SELECT 1');
    } catch (error) {
        // If the query fails due to authentication error, recreate the client
        vscode.window.showWarningMessage('BigQuery authentication expired. Recreating client...');
        await createBigQueryClient();
    }
}

export function getBigQueryClient(): BigQuery | undefined {
    return bigquery;
}

export function setAuthenticationCheckInterval(interval: NodeJS.Timeout) {
    authenticationCheckInterval = interval;
}

export function clearAuthenticationCheckInterval() {
    if (authenticationCheckInterval) {
        clearInterval(authenticationCheckInterval);
    }
}