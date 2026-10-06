import * as vscode from 'vscode';
import { logger } from './logger';
import type { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';
import { loadBigQuery } from './lazySdk';
import type { JobPlace, JobSettings } from './bigquery/jobPlace';

let bigquery: BigQuery | undefined;
let isAuthenticated: boolean = false;

let clientCreationPromise: Promise<string | undefined> | undefined;

/** What the client was made with, so that a client for another project can be made the same way */
let clientOptions: BigQueryOptions = {};
/** Clients for jobs that run in a project other than the client's own, by project. Emptied when the client is remade */
const clientsByProject = new Map<string, BigQuery>();

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
            clientOptions = options;
            clientsByProject.clear();
            isAuthenticated = true;
            logger.info('BigQuery client created');
            return undefined;
        } catch (error: any) {
            bigquery = undefined;
            isAuthenticated = false;
            // Nothing checks for gcloud up front any more, so this is where a missing sign-in is explained
            const signInAdvice = isAuthenticationError(error) ? ' Sign in with `gcloud auth application-default login`, or set `vscode-dataform-tools.serviceAccountJsonPath`.' : '';
            const errorMessage = `Error creating BigQuery client: ${error?.message}${signInAdvice}`;
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

/** The `gcpProjectId` and `gcpLocation` settings, for `jobPlace` */
export function getJobSettings(): JobSettings {
    const config = vscode.workspace.getConfiguration('vscode-dataform-tools');
    return { gcpProjectId: config.get<string>('gcpProjectId') || undefined, gcpLocation: config.get<string>('gcpLocation') || undefined };
}

/**
 * The client for a job that runs at `place`. The BigQuery client sends every job to its own project, so a job for
 * another project needs a client of its own, made with the same credentials. Without a project, or with the client's
 * own, it is the one client there has always been.
 */
export async function getBigQueryClientFor(place: JobPlace | undefined): Promise<BigQuery | undefined> {
    const client = getBigQueryClient();
    if (!client || !place?.projectId || place.projectId === client.projectId) {
        return client;
    }
    let forProject = clientsByProject.get(place.projectId);
    if (!forProject) {
        forProject = new (await loadBigQuery())({ ...clientOptions, projectId: place.projectId });
        clientsByProject.set(place.projectId, forProject);
    }
    return forProject;
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
