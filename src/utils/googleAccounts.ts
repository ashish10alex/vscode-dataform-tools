import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadGoogleAuth } from '../lazySdk';

/*
 * Which Google accounts are in use, for the Project tab of the compiled-query panel: the credentials the
 * extension's own BigQuery, lineage and Dataform API calls sign in with, and the gcloud CLI's active account, which
 * can be another one. As xf's `gcpauth` package. No `vscode` import.
 */

/** What to run to sign in again */
export const SIGN_IN_COMMAND = 'gcloud auth application-default login';

/** What to run to sign the gcloud CLI itself in again. The extension's calls do not use that login; `bq` and `gcloud` do */
export const GCLOUD_SIGN_IN_COMMAND = 'gcloud auth login';

/** The type of credentials that come from no file but from the machine, as in Cloud Shell or on a VM */
export const METADATA_SERVER = 'metadata_server';

/** The variable that names a credential file to use in place of the gcloud CLI's */
export const CREDENTIALS_ENV = 'GOOGLE_APPLICATION_CREDENTIALS';

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const TIMEOUT_MS = 15000;

/** The credentials the extension's own Google calls sign in with */
export interface Credentials {
    /** The email they sign in as. Unset when Google does not say */
    account?: string;
    /** The credential file's type, e.g. `authorized_user`, or `METADATA_SERVER` */
    type?: string;
    /** The credential file, and what chose it: a setting, a variable, or "gcloud's default file" */
    source?: string;
    sourceFrom?: string;
    /** The project the calls are counted against */
    quotaProject?: string;
    /** Why there are no credentials, or why they do not work */
    error?: string;
}

/** The gcloud CLI's active account and project */
export interface GcloudAccount {
    account?: string;
    project?: string;
    /** The CLI's own login no longer gives a token: `GCLOUD_SIGN_IN_COMMAND` renews it */
    loginExpired?: boolean;
    /** Why gcloud did not say */
    error?: string;
}

/** A credential type in words */
export function credentialTypeText(type: string): string {
    switch (type) {
        case 'authorized_user': return 'user login';
        case 'service_account': return 'service account key';
        case 'impersonated_service_account': return 'impersonated service account';
        case 'external_account': return 'workload identity federation';
        case 'external_account_authorized_user': return 'workforce identity login';
        case METADATA_SERVER: return 'metadata server';
        default: return type || 'unknown type';
    }
}

/** The credential file Google's library reads when none is given, by its rules */
export function defaultCredentialFile(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, homeDir: string = os.homedir()): { path: string; from: string } {
    const named = env[CREDENTIALS_ENV];
    if (named) {
        return { path: named, from: `$${CREDENTIALS_ENV}` };
    }
    const name = 'application_default_credentials.json';
    const directory = platform === 'win32' ? path.join(env.APPDATA ?? '', 'gcloud') : path.join(homeDir, '.config', 'gcloud');
    return { path: path.join(directory, name), from: "gcloud's default file" };
}

/** The service account an impersonation URL names */
function impersonated(url: unknown): string | undefined {
    return typeof url === 'string' ? /\/serviceAccounts\/([^/:]+):/.exec(url)?.[1] : undefined;
}

const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';

function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const late = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out ${what}`)), TIMEOUT_MS);
    });
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** How the lookups reach the outside. A test gives its own */
export interface AccountLookups {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    readFile?: (file: string) => string;
    /** Signs in with the key file given, else with the Application Default Credentials, and gives an access token */
    token?: (keyFile?: string) => Promise<string>;
    /** Asks Google whose access token it is */
    email?: (token: string) => Promise<string | undefined>;
    /** Runs gcloud and gives what it printed */
    gcloud?: (binary: string, args: string[]) => Promise<string>;
    /** Asks the metadata server of a Google Cloud machine for its project */
    metadataProject?: () => Promise<string | undefined>;
}

async function signIn(keyFile?: string): Promise<string> {
    const GoogleAuth = await loadGoogleAuth();
    const token = await new GoogleAuth({ scopes: [SCOPE], ...(keyFile ? { keyFilename: keyFile } : {}) }).getAccessToken();
    if (!token) {
        throw new Error('Google gave no access token');
    }
    return token;
}

/** The token goes in the request's body, not its URL, so that no log holds it */
async function emailOf(token: string): Promise<string | undefined> {
    const response = await fetch(TOKEN_INFO_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: token }).toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const info = (await response.json()) as { email?: unknown };
    return typeof info.email === 'string' && info.email ? info.email : undefined;
}

/**
 * Reads the credentials the extension's Google calls use and signs in with them, which says whether they still work,
 * and as whom. With `keyFile`, the `serviceAccountJsonPath` setting, they are that file's; otherwise the Application
 * Default Credentials.
 */
export async function lookUpCredentials(keyFile: string | undefined, lookups: AccountLookups = {}): Promise<Credentials> {
    const readFile = lookups.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
    const file = keyFile ? { path: keyFile, from: 'the serviceAccountJsonPath setting' } : defaultCredentialFile(lookups.env, lookups.platform, lookups.homeDir);
    const credentials: Credentials = {};
    let content: Record<string, unknown> | undefined;
    try {
        const parsed: unknown = JSON.parse(readFile(file.path));
        content = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    } catch (error) {
        // A file that was named has to be there. Without one named, the machine may still give credentials
        if (keyFile || file.from !== "gcloud's default file") {
            return { source: file.path, sourceFrom: file.from, error: `${file.from}: ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'there is no such file' : 'the file is not a credential file'}` };
        }
    }
    if (content) {
        const text = (name: string) => (typeof content![name] === 'string' && content![name] ? (content![name] as string) : undefined);
        credentials.type = text('type');
        credentials.source = file.path;
        credentials.sourceFrom = file.from;
        credentials.quotaProject = text('quota_project_id');
        credentials.account = text('client_email') ?? impersonated(content.service_account_impersonation_url);
    }
    let token: string;
    try {
        token = await withTimeout((lookups.token ?? signIn)(keyFile), 'signing in');
    } catch (error) {
        credentials.error = content ? firstLine(error instanceof Error ? error.message : String(error)) || 'the sign-in failed' : 'no Application Default Credentials';
        return definedOnly(credentials);
    }
    if (!content) {
        credentials.type = METADATA_SERVER;
    }
    if (!credentials.account) {
        // Best effort: a login without the email scope has no email
        credentials.account = await withTimeout((lookups.email ?? emailOf)(token), 'asking Google whose token it is').catch(() => undefined);
    }
    return definedOnly(credentials);
}

function definedOnly<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function runGcloud(binary: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        // A `.cmd` file, as gcloud is on Windows, is not run without a shell. The shell is given one command line, so
        // the path is quoted: gcloud installs into "Cloud SDK", and cmd would run the part before the space
        const onWindows = process.platform === 'win32';
        execFile(onWindows ? `"${binary}"` : binary, args, { timeout: TIMEOUT_MS, windowsHide: true, shell: onWindows }, (error, stdout, stderr) => {
            if (error) {
                reject(Object.assign(error, { stderr }));
            } else {
                resolve(stdout);
            }
        });
    });
}

/** Asks the gcloud CLI for its active account and project. Without `binary`, there is no gcloud to ask */
export async function lookUpGcloud(binary: string | undefined, lookups: AccountLookups = {}): Promise<GcloudAccount> {
    if (!binary) {
        return { error: 'gcloud not found' };
    }
    let printed: string;
    try {
        printed = await (lookups.gcloud ?? runGcloud)(binary, ['config', 'list', '--format=json']);
    } catch (error) {
        const failed = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
        if (failed.code === 'ENOENT') {
            return { error: 'gcloud not found' };
        }
        if (failed.killed) {
            return { error: 'gcloud timed out' };
        }
        // eslint-disable-next-line no-control-regex
        return { error: firstLine((failed.stderr ?? '').replace(/\u001b\[[0-9;]*m/g, '')) || firstLine(failed.message ?? '') || 'gcloud failed' };
    }
    try {
        const core = (JSON.parse(printed) as { core?: { account?: unknown; project?: unknown } }).core ?? {};
        return definedOnly({
            account: typeof core.account === 'string' && core.account ? core.account : undefined,
            project: typeof core.project === 'string' && core.project ? core.project : undefined,
        });
    } catch {
        return { error: 'gcloud config list printed no JSON' };
    }
}

/** What gcloud prints when its login has to be made again, and not when it only could not reach Google */
const LOGIN_EXPIRED = /reauth|invalid_grant/i;

/**
 * Whether the gcloud CLI's own login still gives a token. It is another login than the extension's credentials, and
 * `bq` and `gcloud` in a terminal fail without it. This reaches Google, so it is for when the answer is on show.
 */
export async function gcloudLoginExpired(binary: string, lookups: AccountLookups = {}): Promise<boolean> {
    try {
        await (lookups.gcloud ?? runGcloud)(binary, ['auth', 'print-access-token', '--quiet']);
        return false;
    } catch (error) {
        const failed = error as { stderr?: string; message?: string };
        return LOGIN_EXPIRED.test(`${failed.stderr ?? ''}\n${failed.message ?? ''}`);
    }
}

/** The project that jobs run in when no job names its own, and what named it */
export interface JobProject {
    projectId?: string;
    from?: string;
}

export interface JobProjectInputs {
    /** The `gcpProjectId` setting */
    setting?: string;
    /** The `serviceAccountJsonPath` setting */
    keyFile?: string;
    /** The gcloud CLI, when there is one. Not needed with `gcloud` */
    gcloudBinary?: string;
    /** What gcloud has said already, so that it is not asked again */
    gcloud?: GcloudAccount;
    /** The default project of the Dataform Project, when it is known */
    defaultProject?: string;
}

/** The variables Google's library reads a project from, in its order */
const PROJECT_ENV = ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'gcloud_project', 'google_cloud_project'];

async function metadataServerProject(): Promise<string | undefined> {
    const host = process.env.GCE_METADATA_HOST || 'metadata.google.internal';
    const response = await fetch(`http://${host}/computeMetadata/v1/project/project-id`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(3000) });
    return response.ok && response.headers.get('metadata-flavor') === 'Google' ? (await response.text()).trim() || undefined : undefined;
}

/**
 * Finds the project that the extension's jobs run in. Google's library can find one itself, but it asks gcloud in a
 * way that needs the CLI's own login to work (`gcloud config config-helper`), and says "Unable to detect a Project
 * Id" when that login has expired, although the extension's credentials are in order. So the project is found here,
 * from the same places in the same order, with gcloud asked in a way that needs no login, and is given to each client.
 * Two places more are looked in before the metadata server: the credentials' quota project and the Dataform Project.
 */
export async function lookUpJobProject(inputs: JobProjectInputs, lookups: AccountLookups = {}): Promise<JobProject> {
    const setting = inputs.setting?.trim();
    if (setting) {
        return { projectId: setting, from: 'the gcpProjectId setting' };
    }
    const env = lookups.env ?? process.env;
    const variable = PROJECT_ENV.find((name) => env[name]);
    if (variable) {
        return { projectId: env[variable], from: `$${variable}` };
    }
    const file = inputs.keyFile ? { path: inputs.keyFile, from: 'the serviceAccountJsonPath setting' } : defaultCredentialFile(env, lookups.platform, lookups.homeDir);
    let content: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse((lookups.readFile ?? ((path: string) => fs.readFileSync(path, 'utf8')))(file.path));
        content = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        // No credential file, or not one: the other places are still looked in
    }
    const text = (name: string) => (typeof content[name] === 'string' && content[name] ? (content[name] as string) : undefined);
    if (text('project_id')) {
        return { projectId: text('project_id'), from: 'the credential file' };
    }
    const gcloud = inputs.gcloud ?? await lookUpGcloud(inputs.gcloudBinary, lookups);
    if (gcloud.project) {
        return { projectId: gcloud.project, from: 'gcloud config' };
    }
    if (text('quota_project_id')) {
        return { projectId: text('quota_project_id'), from: "the credentials' quota project" };
    }
    const defaultProject = inputs.defaultProject?.trim();
    if (defaultProject) {
        return { projectId: defaultProject, from: "the Dataform project's default project" };
    }
    const machine = await (lookups.metadataProject ?? metadataServerProject)().catch(() => undefined);
    return machine ? { projectId: machine, from: 'the metadata server' } : {};
}
