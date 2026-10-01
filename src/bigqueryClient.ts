import * as vscode from 'vscode';
import { logger } from './logger';
import type { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';
import { loadBigQuery } from './lazySdk';

let bigquery: BigQuery | undefined;
let isAuthenticated: boolean = false;

let clientCreationPromise: Promise<string | undefined> | undefined;

/**
 * Creates the BigQuery client. Called on first use rather than at activation, and again after an
 * authentication error. Credentials are checked by fetching an access token, which runs no query job.
 */
export async function createBigQueryClient(): Promise<string | undefined> {
    if (clientCreationPromise) {
        return clientCreationPromise;
    }

    clientCreationPromise = (async () => {
        try {
            const projectId : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpProjectId');
            const gcpLocation : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('gcpLocation');
            const serviceAccountJsonPath : string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('serviceAccountJsonPath');

            logger.info(`Creating BigQuery client with Project ID: ${projectId}, Location: ${gcpLocation}, Service Account JSON Path: ${serviceAccountJsonPath}`);

            let options: BigQueryOptions = {};
            if(projectId && projectId.trim() !== ''){
                options = {... options , projectId: projectId};
            }

            if(gcpLocation && gcpLocation.trim() !== ''){
                options = {... options , location: gcpLocation};
            }

            if(serviceAccountJsonPath && serviceAccountJsonPath.trim() !== ''){
                options = {... options , keyFilename: serviceAccountJsonPath};
            }

            const client = new (await loadBigQuery())(options);
            await client.authClient.getAccessToken();
            bigquery = client;
            isAuthenticated = true;
            logger.info('BigQuery client created');
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

/** Makes sure a client exists, creating it on first use. Returns an error message when it cannot be created. */
export async function checkAuthentication(): Promise<string | undefined> {
    if (!bigquery || !isAuthenticated) {
        return await createBigQueryClient();
    }
    return undefined;
}

export function getBigQueryClient(): BigQuery | undefined {
    return isAuthenticated ? bigquery : undefined;
}

function isAuthenticationError(error: any): boolean {
    return error?.code === 401 || /authenticat|credential|invalid_grant|reauth/i.test(error?.message ?? '');
}

/**
 * After a failed BigQuery call: on an authentication error, recreates the client and returns so the caller
 * can retry once (`alreadyRetried` false). Otherwise rethrows the error.
 */
export async function handleBigQueryError(error: any, alreadyRetried: boolean = false): Promise<void> {
    if (!alreadyRetried && isAuthenticationError(error)) {
        logger.info(`BigQuery authentication error, recreating the client: ${error?.message}`);
        isAuthenticated = false;
        if (await createBigQueryClient() === undefined) {
            return;
        }
    }
    throw error;
}
