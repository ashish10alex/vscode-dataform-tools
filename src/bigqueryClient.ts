import * as vscode from 'vscode';
import { logger } from './logger';
import type { BigQuery, BigQueryOptions } from '@google-cloud/bigquery';
import { loadBigQuery } from './lazySdk';
import type { JobPlace, JobSettings } from './bigquery/jobPlace';
import { extensionConfiguration } from './project/settings';
import { compiledJson } from './project';
import { JobProject, lookUpJobProject } from './utils/googleAccounts';
import { resolveExecutable } from './utils/executableResolver';

let bigquery: BigQuery | undefined;
let isAuthenticated: boolean = false;

let clientCreationPromise: Promise<string | undefined> | undefined;

/** What the client was made with, so that a client for another project can be made the same way */
let clientOptions: BigQueryOptions = {};
/** Clients for jobs that run in a project other than the client's own, by project. Emptied when the client is remade */
const clientsByProject = new Map<string, BigQuery>();

/** What Google's library says when it finds no project for a job. With `findJobProject` it is said only when there is none anywhere */
const NO_PROJECT_FROM_GOOGLE = /Unable to detect a Project Id/i;
const NO_PROJECT_MESSAGE = 'No Google Cloud project is set for BigQuery jobs. Set `vscode-dataform-tools.gcpProjectId`, or run `gcloud config set project <PROJECT_ID>`.';
/** Whether the user has been told, for this client, that there is no project */
let toldNoProject = false;

/**
 * The project that jobs run in when a job names none: the `gcpProjectId` setting, else what the machine and the
 * Dataform Project say. See `lookUpJobProject` for why Google's library is not left to find it.
 */
export async function findJobProject(): Promise<JobProject> {
    return lookUpJobProject({
        setting: extensionConfiguration().get<string>('gcpProjectId'),
        keyFile: extensionConfiguration().get<string>('serviceAccountJsonPath')?.trim() || undefined,
        gcloudBinary: resolveExecutable('gcloud').path ?? undefined,
        defaultProject: compiledJson()?.projectConfig?.defaultDatabase,
    });
}

function tellNoProject() {
    if (toldNoProject) {
        return;
    }
    toldNoProject = true;
    vscode.window.showErrorMessage(NO_PROJECT_MESSAGE, 'Open setting').then((choice) => {
        if (choice) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-dataform-tools.gcpProjectId');
        }
    });
}

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
            const gcpLocation : string | undefined = extensionConfiguration().get('gcpLocation');
            const serviceAccountJsonPath : string | undefined = extensionConfiguration().get('serviceAccountJsonPath');
            const { projectId, from } = await findJobProject();

            logger.info(`Creating BigQuery client with Project ID: ${projectId}${from ? ` (from ${from})` : ''}, Location: ${gcpLocation}, Service Account JSON Path: ${serviceAccountJsonPath}`);

            let options: BigQueryOptions = {};
            if(projectId){
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
            toldNoProject = false;
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
    const config = extensionConfiguration();
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
    // Google's "no project" message has a link about authentication in it, and is not a failed sign-in
    if (NO_PROJECT_FROM_GOOGLE.test(error?.message ?? '')) {
        return false;
    }
    return error?.code === 401 || /authenticat|credential|invalid_grant|reauth/i.test(error?.message ?? '');
}

/**
 * After a failed BigQuery call: on an authentication error, recreates the client and returns so the caller
 * can retry once (`alreadyRetried` false). Otherwise rethrows the error.
 */
export async function handleBigQueryError(error: any, alreadyRetried: boolean = false): Promise<void> {
    if (NO_PROJECT_FROM_GOOGLE.test(error?.message ?? '')) {
        tellNoProject();
        throw new Error(NO_PROJECT_MESSAGE);
    }
    if (!alreadyRetried && isAuthenticationError(error)) {
        logger.info(`BigQuery authentication error, recreating the client: ${error?.message}`);
        isAuthenticated = false;
        if (await createBigQueryClient() === undefined) {
            return;
        }
    }
    throw error;
}
