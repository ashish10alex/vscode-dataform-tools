import * as assert from 'assert';
import { suite, test } from 'mocha';
import path from 'path';
import { GitInfo, INFO_SETTINGS, ProjectInfoInput, SettingInfo, ToolInfo, linksOf, projectInfoSlice, remoteWebUrl, settingInfo, warningsOf, withPanelChoice, withoutCredentials } from '../../panel/projectInfo';
import type { InfoRow, InfoSectionName, ProjectInfoSlice } from '../../shared/panelContract';
import { applyMessage, initialSlices } from '../../shared/panelState';
import type { Credentials, GcloudAccount } from '../../utils/googleAccounts';

const ROOT = path.join(path.sep, 'work', 'orders');
const OWN_FILE = path.join(ROOT, '.vscode', 'settings.json');

const rowsOf = (slice: ProjectInfoSlice, name: InfoSectionName): InfoRow[] => slice.sections.find((section) => section.name === name)!.rows;
const row = (slice: ProjectInfoSlice, name: InfoSectionName, label: string): InfoRow => rowsOf(slice, name).find((candidate) => candidate.label === label)!;

const signedIn: Credentials = { account: 'me@example.com', type: 'authorized_user', source: '/home/me/.config/gcloud/application_default_credentials.json', sourceFrom: "gcloud's default file", quotaProject: 'dev-project' };
const gcloud: GcloudAccount = { account: 'me@example.com', project: 'dev-project' };
const dataformTool: ToolInfo = { name: 'dataform', path: '/usr/local/bin/dataform', foundBy: 'PATH', version: '3.0.71' };

function dataform(fields: Partial<ProjectInfoInput> = {}): ProjectInfoInput {
    return {
        root: ROOT, backend: 'dataform', settingsFile: 'workflow_settings.yaml', compilationMode: 'cli', extensionVersion: '2.0.0',
        tools: [dataformTool], settings: [], google: { credentials: signedIn, gcloud }, git: { branch: 'feature', origin: 'git@github.com:acme/orders.git' },
        ...fields,
    };
}

suite('project info: where a setting comes from', () => {
    test('the most specific scope that sets it wins: folder, workspace, user, default', () => {
        const files = { workspace: '/work/all.code-workspace', folder: '/work/.vscode/settings.json' };
        assert.deepStrictEqual(settingInfo('defaultBranch', { defaultValue: 'main' }, files), { key: 'defaultBranch', value: 'main', source: 'default' });
        assert.deepStrictEqual(settingInfo('defaultBranch', { defaultValue: 'main', globalValue: 'develop' }, files), { key: 'defaultBranch', value: 'develop', source: 'user' });
        assert.deepStrictEqual(
            settingInfo('defaultBranch', { defaultValue: 'main', globalValue: 'develop', workspaceValue: 'trunk' }, files),
            { key: 'defaultBranch', value: 'trunk', source: 'workspace', file: '/work/all.code-workspace' },
        );
        assert.deepStrictEqual(
            settingInfo('defaultBranch', { globalValue: 'develop', workspaceValue: 'trunk', workspaceFolderValue: 'release' }, files),
            { key: 'defaultBranch', value: 'release', source: 'folder', file: '/work/.vscode/settings.json' },
        );
    });

    test("the Project's own file stands where the folder's does, and a different user value under it is noted", () => {
        const files = { folder: '/work/.vscode/settings.json', project: OWN_FILE };
        assert.deepStrictEqual(
            settingInfo('gcpProjectId', { globalValue: 'my-sandbox', workspaceFolderValue: 'team-dev' }, files),
            { key: 'gcpProjectId', value: 'team-dev', source: 'project file', file: OWN_FILE, over: { source: 'user', value: 'my-sandbox' } },
        );
        // The same value in both places is no surprise
        assert.strictEqual(settingInfo('gcpProjectId', { globalValue: 'team-dev', workspaceFolderValue: 'team-dev' }, files).over, undefined);
        // A folder's own file over a user value is VS Code's usual order: only the file VS Code does not read is noted
        assert.strictEqual(settingInfo('gcpProjectId', { globalValue: 'my-sandbox', workspaceFolderValue: 'team-dev' }, { folder: files.folder }).over, undefined);
    });

    test('a choice of the panel comes before what the settings say', () => {
        const setting: SettingInfo = { key: 'dbtTarget', value: 'dev', source: 'workspace', file: '/work/.vscode/settings.json' };
        assert.deepStrictEqual(withPanelChoice(setting, 'ci'), { key: 'dbtTarget', value: 'ci', source: 'panel', over: { source: 'workspace', value: 'dev' } });
        assert.strictEqual(withPanelChoice(setting, undefined), setting);
    });

    test('each Backend lists its own settings, and neither lists a formatting or display preference', () => {
        assert.ok(INFO_SETTINGS.dataform.includes('compilerOptions') && !INFO_SETTINGS.dataform.includes('dbtTarget'));
        assert.ok(INFO_SETTINGS.dbt.includes('dbtTarget') && !INFO_SETTINGS.dbt.includes('compilerOptions'));
        for (const key of [...INFO_SETTINGS.dataform, ...INFO_SETTINGS.dbt]) {
            assert.ok(!/format|currency|recommend|snooze/i.test(key), key);
        }
    });
});

suite('project info: the slice', () => {
    test('five sections, the same for both Backends', () => {
        const names = (slice: ProjectInfoSlice) => slice.sections.map((section) => section.name);
        const expected = ['project', 'binaries', 'google cloud', 'git', 'settings'];
        assert.deepStrictEqual(names(projectInfoSlice(dataform())), expected);
        assert.deepStrictEqual(names(projectInfoSlice({ ...dataform(), backend: 'dbt', settingsFile: 'dbt_project.yml', compilationMode: undefined })), expected);
    });

    test('a Dataform Project says how it is compiled; a dbt Project says its dbt target and why it is that one', () => {
        const ofDataform = projectInfoSlice(dataform({ compilationMode: 'api' }));
        assert.deepStrictEqual(row(ofDataform, 'project', 'backend'), { label: 'backend', value: 'Dataform', note: 'from workflow_settings.yaml', noteLink: { kind: 'path', path: path.join(ROOT, 'workflow_settings.yaml') } });
        assert.strictEqual(row(ofDataform, 'project', 'compilation mode').value, 'API');

        const dbt = (target: NonNullable<ProjectInfoInput['dbt']>['target']) => projectInfoSlice({ ...dataform(), backend: 'dbt', settingsFile: 'dbt_project.yml', dbt: { name: 'jaffle', profile: 'jaffle_bq', warehouse: 'bigquery', target } });
        assert.strictEqual(row(dbt({ name: 'ci', overridden: true, setting: 'dev' }), 'project', 'dbt target').note, 'chosen in the panel; the default is dev');
        assert.strictEqual(row(dbt({ name: 'dev', overridden: false, setting: 'dev' }), 'project', 'dbt target').note, 'the dbtTarget setting');
        assert.strictEqual(row(dbt({ name: 'dev', overridden: false, profileDefault: 'dev' }), 'project', 'dbt target').note, 'profile default');
        assert.strictEqual(row(dbt({ overridden: false }), 'project', 'dbt target').absent, true);
        assert.deepStrictEqual(row(dbt({ overridden: false }), 'project', 'dbt project'), { label: 'dbt project', value: 'jaffle', note: 'profile jaffle_bq' });
        assert.strictEqual(rowsOf(dbt({ overridden: false }), 'project').some((candidate) => candidate.label === 'compilation mode'), false);
    });

    test('a directory that is two Projects says so', () => {
        assert.strictEqual(row(projectInfoSlice(dataform({ sharedRoot: true })), 'project', 'backend').note, 'from workflow_settings.yaml; this folder is also a dbt Project');
    });

    test('a tool is shown with where it was found and its version; one that is missing says where it was looked for', () => {
        const found = projectInfoSlice(dataform({ tools: [{ ...dataformTool, more: [{ value: '@dataform/core 3.0.38', note: "the Project's dataformCoreVersion" }] }] }));
        assert.deepStrictEqual(rowsOf(found, 'binaries'), [
            { label: 'dataform', value: '/usr/local/bin/dataform', link: { kind: 'path', path: '/usr/local/bin/dataform' }, note: 'PATH' },
            { label: '', value: '3.0.71' },
            { label: '', value: '@dataform/core 3.0.38', note: "the Project's dataformCoreVersion" },
            { label: 'extension', value: '2.0.0' },
        ]);

        const missing = projectInfoSlice(dataform({ tools: [{ name: 'dbt', lookedIn: ['the dbtExecutablePath setting', 'PATH'] }] }));
        assert.deepStrictEqual(rowsOf(missing, 'binaries').slice(0, 3), [
            { label: 'dbt', value: '(not found)', absent: true, warning: 'set the dbtExecutablePath setting to where it is' },
            { label: '', value: 'the dbtExecutablePath setting', absent: true, note: 'looked here' },
            { label: '', value: 'PATH', absent: true, note: 'looked here' },
        ]);
    });

    test('a tool the Project can do without is not marked when it is missing, and one that cannot be run is', () => {
        const optional = projectInfoSlice(dataform({ tools: [{ name: 'dataform', optional: 'not needed in API mode' }] }));
        assert.deepStrictEqual(rowsOf(optional, 'binaries')[0], { label: 'dataform', value: '(not found)', absent: true, note: 'not needed in API mode' });
        const unusable = projectInfoSlice(dataform({ tools: [{ name: 'dbt', path: '/opt/dbt', foundBy: 'PATH', problem: 'dbt --version printed nothing' }] }));
        assert.strictEqual(rowsOf(unusable, 'binaries')[0].warning, 'dbt --version printed nothing');
    });

    test('a version still being read marks its section as looking', () => {
        const slice = projectInfoSlice(dataform({ tools: [{ name: 'gcloud', path: '/usr/bin/gcloud', looking: true }] }));
        const binaries = slice.sections.find((section) => section.name === 'binaries')!;
        assert.strictEqual(binaries.looking, true);
        assert.deepStrictEqual(binaries.rows[1], { label: '', value: 'reading its version…', absent: true });
    });

    test('a setting is shown with its value in effect and the file that sets it, from the Project root where it is inside it', () => {
        const slice = projectInfoSlice(dataform({ settings: [
            { key: 'defaultBranch', value: 'main', source: 'default' },
            { key: 'compilerOptions', value: '', source: 'user' },
            { key: 'deferToProd', value: true, source: 'folder', file: OWN_FILE },
            { key: 'gcpProjectId', value: 'team-dev', source: 'workspace', file: '/elsewhere/all.code-workspace' },
        ] }));
        assert.deepStrictEqual(rowsOf(slice, 'settings'), [
            { label: 'defaultBranch', value: 'main', note: 'default', noteLink: { kind: 'setting', key: 'defaultBranch' } },
            { label: 'compilerOptions', value: '(not set)', absent: true, note: 'User settings', noteLink: { kind: 'setting', key: 'compilerOptions' } },
            { label: 'deferToProd', value: 'true', note: '.vscode/settings.json', noteLink: { kind: 'setting', key: 'deferToProd' } },
            { label: 'gcpProjectId', value: 'team-dev', note: '/elsewhere/all.code-workspace', noteLink: { kind: 'setting', key: 'gcpProjectId' } },
        ]);
    });

    test("a user setting that the Project's own file overrides is marked; a choice of the panel is explained, not marked", () => {
        const slice = projectInfoSlice(dataform({ settings: [
            { key: 'gcpProjectId', value: 'team-dev', source: 'project file', file: OWN_FILE, over: { source: 'user', value: 'my-sandbox' } },
            { key: 'dbtTarget', value: 'ci', source: 'panel', over: { source: 'workspace', value: 'dev' } },
            { key: 'dbtVars', value: 'x: 1', source: 'panel', over: { source: 'default', value: '' } },
        ] }));
        const [shadowing, chosen, chosenOverNothing] = rowsOf(slice, 'settings');
        assert.strictEqual(shadowing.warning, "User settings say my-sandbox, and the Project's own file comes first");
        assert.deepStrictEqual(chosen, { label: 'dbtTarget', value: 'ci', note: 'chosen in the panel, for this workspace; the setting says dev' });
        assert.strictEqual(chosenOverNothing.note, 'chosen in the panel, for this workspace; the setting is not set');
        assert.strictEqual(rowsOf(slice, 'settings').filter((candidate) => candidate.warning).length, 1);
        // That one, and the quota project that is not the project the file sets
        assert.strictEqual(warningsOf(slice), 2);
    });

    test('the Google accounts: who the extension signs in as, with what, and whether gcloud is someone else', () => {
        const same = projectInfoSlice(dataform());
        assert.deepStrictEqual(rowsOf(same, 'google cloud'), [
            { label: 'extension uses', value: 'me@example.com' },
            { label: '', value: 'user login' },
            { label: '', value: signedIn.source, link: { kind: 'path', path: signedIn.source }, note: "gcloud's default file" },
            { label: 'quota', value: 'dev-project' },
            { label: 'gcloud', value: 'me@example.com', note: 'project dev-project' },
        ]);
        assert.strictEqual(warningsOf(same), 0);

        const other = projectInfoSlice(dataform({ google: { credentials: signedIn, gcloud: { account: 'Other@Example.com' } } }));
        assert.strictEqual(row(other, 'google cloud', 'gcloud').warning, 'not the account the extension uses');
        // Not by the case of the address
        assert.strictEqual(row(projectInfoSlice(dataform({ google: { credentials: signedIn, gcloud: { account: 'ME@example.com' } } })), 'google cloud', 'gcloud').warning, undefined);
    });

    test('no credentials, and credentials that no longer work, each say so and offer the command that signs in', () => {
        const none = projectInfoSlice(dataform({ google: { credentials: { error: 'no Application Default Credentials' }, gcloud: { error: 'gcloud not found' } } }));
        assert.deepStrictEqual(rowsOf(none, 'google cloud'), [
            { label: 'extension uses', value: '(not signed in)', absent: true, warning: 'no Application Default Credentials' },
            { label: '', value: 'gcloud auth application-default login', note: 'put it in a terminal', link: { kind: 'sign in' } },
            { label: 'gcloud', value: '(unknown)', absent: true, note: 'gcloud not found' },
        ]);

        const expired = projectInfoSlice(dataform({ google: { credentials: { ...signedIn, account: undefined, error: 'invalid_grant: reauth related error' }, gcloud } }));
        assert.deepStrictEqual(rowsOf(expired, 'google cloud').slice(0, 2), [
            { label: 'extension uses', value: '(unknown account)', absent: true, warning: 'sign-in failed: invalid_grant: reauth related error' },
            { label: '', value: 'gcloud auth application-default login', note: 'put it in a terminal', link: { kind: 'sign in' } },
        ]);

        // A key file that fails is not something a login mends
        const key: Credentials = { account: 'runner@p.iam.gserviceaccount.com', type: 'service_account', source: '/keys/runner.json', sourceFrom: 'the serviceAccountJsonPath setting', error: 'invalid_grant: Invalid JWT Signature.' };
        const badKey = rowsOf(projectInfoSlice(dataform({ google: { credentials: key, gcloud } })), 'google cloud');
        assert.strictEqual(badKey.some((candidate) => candidate.link?.kind === 'sign in'), false);
        assert.deepStrictEqual(badKey[1], { label: '', value: 'service account key' });
    });

    test('a quota project that is not the gcpProjectId setting is marked, and for a dbt Project the tab says whose sign-in this is', () => {
        const settings: SettingInfo[] = [{ key: 'gcpProjectId', value: 'team-dev', source: 'user' }];
        assert.strictEqual(row(projectInfoSlice(dataform({ settings })), 'google cloud', 'quota').warning, 'the gcpProjectId setting is team-dev');
        assert.strictEqual(row(projectInfoSlice(dataform({ settings: [{ key: 'gcpProjectId', value: 'dev-project', source: 'user' }] })), 'google cloud', 'quota').warning, undefined);
        const ofDbt = projectInfoSlice({ ...dataform(), backend: 'dbt' });
        assert.strictEqual(rowsOf(ofDbt, 'google cloud')[1].note, "for the extension's own calls; dbt signs in as profiles.yml says");
    });

    test('what is still being looked up says so, and its section is marked', () => {
        const slice = projectInfoSlice(dataform({ google: undefined, git: undefined }));
        const looking = slice.sections.filter((section) => section.looking).map((section) => section.name);
        assert.deepStrictEqual(looking, ['google cloud', 'git']);
        assert.deepStrictEqual(rowsOf(slice, 'google cloud'), [{ label: 'extension uses', value: 'looking…', absent: true }]);
    });

    test('git: the branch, the remote as a link, and what Run Changed compares with', () => {
        const git: GitInfo = { branch: 'feature', origin: 'https://me:token@gitlab.example.com/team/orders.git', compare: { baseRef: 'origin/main', mergeBase: '0123456789abcdef', onDefaultBranch: false } };
        assert.deepStrictEqual(rowsOf(projectInfoSlice(dataform({ git })), 'git'), [
            { label: 'branch', value: 'feature' },
            { label: 'origin', value: 'https://gitlab.example.com/team/orders.git', link: { kind: 'url', url: 'https://gitlab.example.com/team/orders' } },
            { label: 'compares with', value: 'origin/main', note: 'Run Changed looks for what changed since 0123456, where the branch left it' },
        ]);
        const onMain = projectInfoSlice(dataform({ git: { branch: 'main', compare: { baseRef: 'origin/main', mergeBase: 'abc', onDefaultBranch: true } } }));
        assert.ok(row(onMain, 'git', 'compares with').note?.startsWith('the branch you are on'));
        assert.strictEqual(row(onMain, 'git', 'origin').absent, true);
        const noBase = projectInfoSlice(dataform({ git: { branch: 'x', compare: { error: 'Neither origin/main nor main exists.' } } }));
        assert.strictEqual(row(noBase, 'git', 'compares with').warning, 'Neither origin/main nor main exists.');
        assert.deepStrictEqual(rowsOf(projectInfoSlice(dataform({ git: { error: 'not a git repository' } })), 'git'), [{ label: 'branch', value: '(not a git repository)', absent: true }]);
        assert.strictEqual(row(projectInfoSlice(dataform({ git: { detachedAt: 'abc1234' } })), 'git', 'branch').value, '(detached at abc1234)');
    });

    test('in API mode git also says which Dataform repository compiles, and whether the branch is pushed', () => {
        const api = (fields: NonNullable<GitInfo['api']>) => projectInfoSlice(dataform({ compilationMode: 'api', git: { branch: 'feature', api: fields } }));
        const pushed = api({ repository: 'orders', repositoryFrom: 'origin', location: 'europe-west2', upstream: 'origin/feature', unpushed: 0 });
        assert.deepStrictEqual(rowsOf(pushed, 'git').slice(2), [
            { label: 'Dataform repository', value: 'orders', note: "from origin's name" },
            { label: 'location', value: 'europe-west2', note: 'as you chose it when first asked' },
            { label: 'pushed', value: 'yes, to origin/feature' },
        ]);
        assert.strictEqual(row(api({ repository: 'orders', repositoryFrom: 'setting', upstream: 'origin/feature', unpushed: 2 }), 'git', 'pushed').value, '2 commits not on origin/feature');
        assert.strictEqual(row(api({ repository: 'orders', repositoryFrom: 'setting', upstream: 'origin/feature', unpushed: 1 }), 'git', 'pushed').warning, 'API mode compiles the pushed commit');
        assert.ok(row(api({ repositoryFrom: 'origin' }), 'git', 'pushed').warning?.includes('push the branch'));
        assert.ok(row(api({ repositoryFrom: 'origin' }), 'git', 'Dataform repository').warning?.includes('gitRepoName'));
        // Not in CLI mode
        assert.strictEqual(rowsOf(projectInfoSlice(dataform()), 'git').some((candidate) => candidate.label === 'pushed'), false);
    });

    test('a remote is shown without the token in its address, and linked where it names a host', () => {
        assert.strictEqual(withoutCredentials('https://me:secret@github.com/acme/orders.git'), 'https://github.com/acme/orders.git');
        assert.strictEqual(withoutCredentials('git@github.com:acme/orders.git'), 'git@github.com:acme/orders.git');
        assert.strictEqual(remoteWebUrl('git@github.com:acme/orders.git'), 'https://github.com/acme/orders');
        assert.strictEqual(remoteWebUrl('ssh://git@gitlab.example.com:2222/team/sub/orders.git'), 'https://gitlab.example.com/team/sub/orders');
        assert.strictEqual(remoteWebUrl('https://oauth2:tok@gitlab.example.com/team/orders'), 'https://gitlab.example.com/team/orders');
        assert.strictEqual(remoteWebUrl('/srv/git/orders.git'), undefined);
    });

    test('every link of the slice is listed, for the host to check a click against', () => {
        const slice = projectInfoSlice(dataform({ settings: [{ key: 'defaultBranch', value: 'main', source: 'default' }] }));
        const kinds = linksOf(slice).map((link) => link.kind).sort();
        assert.deepStrictEqual(kinds, ['path', 'path', 'path', 'path', 'setting', 'url']);
        assert.deepStrictEqual(linksOf(undefined), []);
    });
});

suite('project info: the panel keeps the slice it is sent', () => {
    test('the slice is kept until the host takes it back', () => {
        const slice = projectInfoSlice(dataform());
        const kept = applyMessage(initialSlices(), { slice: 'project info', value: slice });
        assert.deepStrictEqual(kept.projectInfo, slice);
        assert.strictEqual(applyMessage(kept, { slice: 'project info', value: null }).projectInfo, undefined);
    });
});
