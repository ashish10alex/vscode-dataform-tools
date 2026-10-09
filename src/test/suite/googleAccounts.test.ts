import * as assert from 'assert';
import { suite, test } from 'mocha';
import path from 'path';
import { AccountLookups, CREDENTIALS_ENV, METADATA_SERVER, credentialTypeText, defaultCredentialFile, lookUpCredentials, lookUpGcloud } from '../../utils/googleAccounts';

const HOME = path.join(path.sep, 'home', 'me');
const DEFAULT_FILE = path.join(HOME, '.config', 'gcloud', 'application_default_credentials.json');

/** Lookups that reach nothing outside: the files given, a sign-in that works, and Google naming `email` */
function lookups(files: Record<string, string>, fields: Partial<AccountLookups> = {}): AccountLookups {
    return {
        env: {}, platform: 'linux', homeDir: HOME,
        readFile: (file) => {
            if (!(file in files)) {
                throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
            }
            return files[file];
        },
        token: async () => 'token',
        email: async () => 'me@example.com',
        ...fields,
    };
}

suite('the Google accounts in use', () => {
    test("the credential file is the one a variable names, else gcloud's own", () => {
        assert.deepStrictEqual(defaultCredentialFile({}, 'linux', HOME), { path: DEFAULT_FILE, from: "gcloud's default file" });
        assert.deepStrictEqual(defaultCredentialFile({ [CREDENTIALS_ENV]: '/keys/k.json' }, 'linux', HOME), { path: '/keys/k.json', from: `$${CREDENTIALS_ENV}` });
        assert.strictEqual(defaultCredentialFile({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', HOME).path, path.join('C:\\Users\\me\\AppData\\Roaming', 'gcloud', 'application_default_credentials.json'));
    });

    test('a user login has no email in its file: Google is asked whose token it is', async () => {
        const file = JSON.stringify({ type: 'authorized_user', quota_project_id: 'dev-project', refresh_token: 'secret' });
        assert.deepStrictEqual(await lookUpCredentials(undefined, lookups({ [DEFAULT_FILE]: file })), {
            type: 'authorized_user', source: DEFAULT_FILE, sourceFrom: "gcloud's default file", quotaProject: 'dev-project', account: 'me@example.com',
        });
    });

    test('the key file of the serviceAccountJsonPath setting is used in place of the default credentials, and names its account', async () => {
        const signedInWith: Array<string | undefined> = [];
        const key = JSON.stringify({ type: 'service_account', client_email: 'runner@p.iam.gserviceaccount.com' });
        const found = await lookUpCredentials('/keys/runner.json', lookups({ '/keys/runner.json': key }, {
            token: async (keyFile) => { signedInWith.push(keyFile); return 'token'; },
            email: async () => { throw new Error('not asked: the file names the account'); },
        }));
        assert.deepStrictEqual(found, { type: 'service_account', source: '/keys/runner.json', sourceFrom: 'the serviceAccountJsonPath setting', account: 'runner@p.iam.gserviceaccount.com' });
        assert.deepStrictEqual(signedInWith, ['/keys/runner.json']);
    });

    test('an impersonated service account is named by its URL', async () => {
        const file = JSON.stringify({ type: 'impersonated_service_account', service_account_impersonation_url: 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/deployer@p.iam.gserviceaccount.com:generateAccessToken' });
        assert.strictEqual((await lookUpCredentials(undefined, lookups({ [DEFAULT_FILE]: file }))).account, 'deployer@p.iam.gserviceaccount.com');
    });

    test('credentials that no longer work keep what their file says, with the first line of why', async () => {
        const file = JSON.stringify({ type: 'authorized_user', quota_project_id: 'dev-project' });
        const found = await lookUpCredentials(undefined, lookups({ [DEFAULT_FILE]: file }, { token: async () => { throw new Error('invalid_grant: reauth related error (invalid_rapt)\nmore'); } }));
        assert.deepStrictEqual(found, { type: 'authorized_user', source: DEFAULT_FILE, sourceFrom: "gcloud's default file", quotaProject: 'dev-project', error: 'invalid_grant: reauth related error (invalid_rapt)' });
    });

    test('with no file and no sign-in there are no credentials; with no file and a sign-in they are the machine\'s', async () => {
        assert.deepStrictEqual(await lookUpCredentials(undefined, lookups({}, { token: async () => { throw new Error('Could not load the default credentials'); } })), { error: 'no Application Default Credentials' });
        assert.deepStrictEqual(await lookUpCredentials(undefined, lookups({}, { email: async () => 'vm@developer.gserviceaccount.com' })), { type: METADATA_SERVER, account: 'vm@developer.gserviceaccount.com' });
    });

    test('a file that was named and is not there is the error, and nothing is signed in to', async () => {
        const never = async () => { throw new Error('not reached'); };
        assert.deepStrictEqual(await lookUpCredentials('/keys/gone.json', lookups({}, { token: never })), {
            source: '/keys/gone.json', sourceFrom: 'the serviceAccountJsonPath setting', error: 'the serviceAccountJsonPath setting: there is no such file',
        });
        const named = await lookUpCredentials(undefined, lookups({ '/keys/bad.json': 'not json' }, { env: { [CREDENTIALS_ENV]: '/keys/bad.json' }, token: never }));
        assert.strictEqual(named.error, `$${CREDENTIALS_ENV}: the file is not a credential file`);
    });

    test('a login that Google will not name is still a login', async () => {
        const file = JSON.stringify({ type: 'authorized_user' });
        assert.deepStrictEqual(await lookUpCredentials(undefined, lookups({ [DEFAULT_FILE]: file }, { email: async () => { throw new Error('offline'); } })), { type: 'authorized_user', source: DEFAULT_FILE, sourceFrom: "gcloud's default file" });
    });

    test("gcloud's account and project, or why it did not say", async () => {
        const asked: string[][] = [];
        const says = (printed: string): AccountLookups => ({ gcloud: async (binary, args) => { asked.push([binary, ...args]); return printed; } });
        assert.deepStrictEqual(await lookUpGcloud('/usr/bin/gcloud', says(JSON.stringify({ core: { account: 'me@example.com', project: 'dev-project' } }))), { account: 'me@example.com', project: 'dev-project' });
        assert.deepStrictEqual(asked, [['/usr/bin/gcloud', 'config', 'list', '--format=json']]);
        assert.deepStrictEqual(await lookUpGcloud('/usr/bin/gcloud', says('{}')), {});
        assert.deepStrictEqual(await lookUpGcloud('/usr/bin/gcloud', says('WARNING')), { error: 'gcloud config list printed no JSON' });
        assert.deepStrictEqual(await lookUpGcloud(undefined), { error: 'gcloud not found' });
        const fails = (error: object): AccountLookups => ({ gcloud: async () => { throw Object.assign(new Error('Command failed'), error); } });
        assert.deepStrictEqual(await lookUpGcloud('gcloud', fails({ code: 'ENOENT' })), { error: 'gcloud not found' });
        assert.deepStrictEqual(await lookUpGcloud('gcloud', fails({ killed: true })), { error: 'gcloud timed out' });
        assert.deepStrictEqual(await lookUpGcloud('gcloud', fails({ stderr: '\u001b[31mERROR: (gcloud.config.list) broken\u001b[0m\nmore' })), { error: 'ERROR: (gcloud.config.list) broken' });
    });

    test('a credential type is said in words', () => {
        assert.deepStrictEqual(['authorized_user', 'service_account', METADATA_SERVER, 'something_new', ''].map(credentialTypeText), ['user login', 'service account key', 'metadata server', 'something_new', 'unknown type']);
    });
});
