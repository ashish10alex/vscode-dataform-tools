import path from 'path';
import type { BackendName } from '../project/detection';
import type { CompilationMode } from '../project/tools';
import type { InfoLink, InfoRow, InfoSection, ProjectInfoSlice } from '../shared/panelContract';
import { Credentials, GcloudAccount, SIGN_IN_COMMAND, credentialTypeText } from '../utils/googleAccounts';

/*
 * The `project info` slice of the compiled-query panel (see src/shared/panelContract.ts): what the Project tab shows
 * of a Project and of the user's setup. The host looks everything up (src/project/projectInfo.ts) and hands it over
 * as plain data; the rows, their notes and what is marked as a likely mistake are worked out here. Nothing here reads
 * a setting, runs a command or imports `vscode`.
 */

// ---- Settings

/** Where the value of a setting in effect comes from */
export type SettingSource =
    | 'default'
    | 'user'
    /** The workspace's settings: the `.code-workspace` file, or the one folder's `.vscode/settings.json` */
    | 'workspace'
    /** The `.vscode/settings.json` of the workspace folder the Project is in */
    | 'folder'
    /** The Project's own `.vscode/settings.json`, which the extension reads for a Project below a workspace folder */
    | 'project file'
    /** Chosen in the panel and kept for the workspace: it comes before every settings file */
    | 'panel';

export interface SettingInfo {
    /** Without the section, e.g. `compilerOptions` */
    key: string;
    /** The value in effect */
    value: unknown;
    source: SettingSource;
    /** The settings file the value is in, absolute. Unset for a default, a user setting and a choice of the panel */
    file?: string;
    /** A value this one comes before and differs from: what the settings say under a choice of the panel, or what the user set under the Project's own file */
    over?: { source: SettingSource; value: unknown };
}

/** What `WorkspaceConfiguration.inspect` gives of a setting, as far as it is read here */
export interface InspectedSetting {
    defaultValue?: unknown;
    globalValue?: unknown;
    workspaceValue?: unknown;
    workspaceFolderValue?: unknown;
}

/** The settings files a value can be in, absolute. `project` is set only when the Project's own file sets this setting */
export interface SettingsFiles {
    workspace?: string;
    folder?: string;
    project?: string;
}

const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

/**
 * Which scope gives a setting its value, by VS Code's order: folder, workspace, user, default. The Project's own
 * settings file stands where the folder's does. When it is that file that wins, a different value the user or the
 * workspace set is noted, since VS Code's settings editor shows that one as in force.
 */
export function settingInfo(key: string, inspected: InspectedSetting | undefined, files: SettingsFiles = {}): SettingInfo {
    const { defaultValue, globalValue, workspaceValue, workspaceFolderValue } = inspected ?? {};
    if (workspaceFolderValue !== undefined) {
        const info: SettingInfo = { key, value: workspaceFolderValue, source: files.project ? 'project file' : 'folder' };
        const file = files.project ?? files.folder;
        if (file) {
            info.file = file;
        }
        const under: SettingInfo['over'] = workspaceValue !== undefined ? { source: 'workspace', value: workspaceValue } : globalValue !== undefined ? { source: 'user', value: globalValue } : undefined;
        if (files.project && under && differs(under.value, workspaceFolderValue)) {
            info.over = under;
        }
        return info;
    }
    if (workspaceValue !== undefined) {
        return { key, value: workspaceValue, source: 'workspace', ...(files.workspace ? { file: files.workspace } : {}) };
    }
    if (globalValue !== undefined) {
        return { key, value: globalValue, source: 'user' };
    }
    return { key, value: defaultValue, source: 'default' };
}

/** A choice of the panel in place of what the settings say. Without a choice the setting stands as it is */
export function withPanelChoice(setting: SettingInfo, chosen: unknown): SettingInfo {
    if (chosen === undefined) {
        return setting;
    }
    return { key: setting.key, value: chosen, source: 'panel', over: { source: setting.source, value: setting.value } };
}

/** The settings that decide where and how a Project compiles and runs, in the order they are listed */
export const INFO_SETTINGS: Record<BackendName, string[]> = {
    dataform: [
        'compilationBackend', 'compilerOptions', 'prodCompilerOptions', 'deferToProd', 'defaultBranch', 'gcpProjectId', 'gcpLocation', 'gitRepoName',
        'serviceAccountJsonPath', 'dataformCliScope', 'skipPreOpsInDryRun', 'skipPreOpsInPreviewQuery',
    ],
    dbt: ['dbtTarget', 'dbtVars', 'dbtProfilesDir', 'dbtCompileWithHooks', 'dbtDryRunOnSave', 'dbtEditorFeatures', 'defaultBranch', 'gcpProjectId', 'gcpLocation', 'serviceAccountJsonPath'],
};

const isUnset = (value: unknown) => value === undefined || value === null || value === '';

function settingText(value: unknown): string {
    if (isUnset(value)) {
        return '(not set)';
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
}

const SOURCE_TEXT: Record<SettingSource, string> = {
    'default': 'default',
    'user': 'User settings',
    'workspace': 'Workspace settings',
    'folder': 'Folder settings',
    'project file': "the Project's settings file",
    'panel': 'chosen in the panel, for this workspace',
};

// ---- Tools

/** An executable the extension runs, as it was looked for */
export interface ToolInfo {
    /** As the user types it, e.g. `dataform` */
    name: string;
    path?: string;
    /** Which step of the search found it, in words, e.g. "PATH", "the dbtExecutablePath setting" */
    foundBy?: string;
    version?: string;
    /** It is being looked for, or its version is being read */
    looking?: boolean;
    /** Why the one found cannot be used */
    problem?: string;
    /** Where it was looked for, in order, when none was found */
    lookedIn?: string[];
    /** Why having none is no problem, e.g. "not needed in API mode" */
    optional?: string;
    /** What else to say of it, a line each */
    more?: Array<{ value: string; note?: string; path?: string }>;
}

// ---- Git

export interface GitInfo {
    /** Why nothing is known, e.g. "not a git repository" */
    error?: string;
    /** Unset on a detached HEAD */
    branch?: string;
    /** The short commit of a detached HEAD */
    detachedAt?: string;
    origin?: string;
    /** What Run Changed compares with */
    compare?: { baseRef: string; mergeBase: string; onDefaultBranch: boolean } | { error: string };
    /** Only in API mode, where the pushed commit is what compiles */
    api?: {
        repository?: string;
        repositoryFrom: 'setting' | 'origin';
        /** Where the repository is, as the user chose it when the Dataform API was first used */
        location?: string;
        /** The branch on the remote this one tracks. Unset when it tracks none */
        upstream?: string;
        /** Commits the upstream does not have */
        unpushed?: number;
    };
}

/** The remote as shown: without a user name or a token that its address may carry */
export function withoutCredentials(remote: string): string {
    return remote.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, (_all, scheme: string) => (scheme.toLowerCase().startsWith('ssh') ? `${scheme}git@` : scheme));
}

/** The page of a git remote in the browser, where its address says which host and path. Undefined for a local path */
export function remoteWebUrl(remote: string): string | undefined {
    const scp = /^[^@/\s]+@([^:/\s]+):(.+?)(?:\.git)?\/?$/.exec(remote);
    if (scp && !remote.includes('://')) {
        return `https://${scp[1]}/${scp[2]}`;
    }
    const url = /^(?:https?|ssh|git):\/\/(?:[^/@]*@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i.exec(remote);
    return url ? `https://${url[1]}/${url[2]}` : undefined;
}

// ---- The slice

export interface ProjectInfoInput {
    root: string;
    backend: BackendName;
    /** The settings file that makes the directory a Project of the Backend, e.g. `workflow_settings.yaml` */
    settingsFile?: string;
    /** The directory is the root of a Project of the other Backend too */
    sharedRoot?: boolean;
    /** Of a Dataform Project */
    compilationMode?: CompilationMode;
    /** Of a dbt Project: what `dbt_project.yml`, the profile and the last compile said */
    dbt?: {
        name?: string;
        profile?: string;
        warehouse?: string;
        target?: { name?: string; overridden: boolean; profileDefault?: string; setting?: string };
    };
    extensionVersion: string;
    tools: ToolInfo[];
    settings: SettingInfo[];
    /** Unset while they are being looked up. `credentials` is what the extension's own Google calls sign in with */
    google?: { credentials: Credentials; gcloud: GcloudAccount };
    /** Unset while it is being read */
    git?: GitInfo;
}

const BACKEND_TEXT: Record<BackendName, string> = { dataform: 'Dataform', dbt: 'dbt' };
const LOOKING = 'looking…';

/** `file` as shown: from the Project's root when it is inside it */
function shown(root: string, file: string): string {
    const relative = path.relative(root, file);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : file;
}

function projectSection(input: ProjectInfoInput): InfoSection {
    const rows: InfoRow[] = [{ label: 'root', value: input.root, link: { kind: 'path', path: input.root } }];
    const from = [input.settingsFile ? `from ${input.settingsFile}` : '', input.sharedRoot ? `this folder is also a ${BACKEND_TEXT[input.backend === 'dbt' ? 'dataform' : 'dbt']} Project` : ''].filter(Boolean).join('; ');
    rows.push({
        label: 'backend',
        value: BACKEND_TEXT[input.backend],
        ...(from ? { note: from } : {}),
        ...(input.settingsFile ? { noteLink: { kind: 'path', path: path.join(input.root, input.settingsFile) } } : {}),
    });
    if (input.backend === 'dataform' && input.compilationMode) {
        rows.push({
            label: 'compilation mode',
            value: input.compilationMode === 'api' ? 'API' : 'CLI',
            note: input.compilationMode === 'api' ? 'compiles the pushed commit with the Dataform API' : 'compiles the working tree with the Dataform CLI',
        });
    }
    if (input.backend === 'dbt') {
        const { name, profile, warehouse, target } = input.dbt ?? {};
        if (name) {
            rows.push({ label: 'dbt project', value: name, ...(profile ? { note: `profile ${profile}` } : {}) });
        }
        rows.push(target?.name
            ? { label: 'dbt target', value: target.name, ...(targetNote(target) ? { note: targetNote(target) } : {}) }
            : { label: 'dbt target', value: 'dbt chooses; it has not said which yet', absent: true });
        rows.push(warehouse ? { label: 'warehouse', value: warehouse } : { label: 'warehouse', value: 'not known yet', absent: true });
    }
    return { name: 'project', title: 'Project', looking: false, rows };
}

/** Why the dbt target is the one it is */
function targetNote(target: NonNullable<NonNullable<ProjectInfoInput['dbt']>['target']>): string {
    if (target.overridden) {
        const fallback = target.setting ?? target.profileDefault;
        return `chosen in the panel${fallback ? `; the default is ${fallback}` : ''}`;
    }
    if (target.setting === target.name) {
        return 'the dbtTarget setting';
    }
    return target.profileDefault === target.name ? 'profile default' : '';
}

function toolRows(tool: ToolInfo): InfoRow[] {
    const rows: InfoRow[] = [];
    if (tool.path) {
        rows.push({
            label: tool.name,
            value: tool.path,
            link: { kind: 'path', path: tool.path },
            ...(tool.foundBy ? { note: tool.foundBy } : {}),
            ...(tool.problem ? { warning: tool.problem } : {}),
        });
        if (tool.version) {
            rows.push({ label: '', value: tool.version });
        } else if (tool.looking) {
            rows.push({ label: '', value: 'reading its version…', absent: true });
        }
    } else if (tool.looking) {
        rows.push({ label: tool.name, value: LOOKING, absent: true });
    } else {
        rows.push({ label: tool.name, value: '(not found)', absent: true, ...(tool.optional ? { note: tool.optional } : { warning: tool.problem ?? `set the ${tool.name}ExecutablePath setting to where it is` }) });
        for (const place of tool.lookedIn ?? []) {
            rows.push({ label: '', value: place, absent: true, note: 'looked here' });
        }
    }
    for (const line of tool.more ?? []) {
        rows.push({ label: '', value: line.value, ...(line.note ? { note: line.note } : {}), ...(line.path ? { link: { kind: 'path', path: line.path } } : {}) });
    }
    return rows;
}

function binariesSection(input: ProjectInfoInput): InfoSection {
    const rows = input.tools.flatMap(toolRows);
    rows.push({ label: 'extension', value: input.extensionVersion });
    return { name: 'binaries', title: 'Binaries', looking: input.tools.some((tool) => tool.looking === true), rows };
}

function settingRow(root: string, setting: SettingInfo): InfoRow {
    const row: InfoRow = { label: setting.key, value: settingText(setting.value), note: setting.file ? shown(root, setting.file) : SOURCE_TEXT[setting.source] };
    if (isUnset(setting.value)) {
        row.absent = true;
    }
    if (setting.source !== 'panel') {
        row.noteLink = { kind: 'setting', key: setting.key };
    }
    if (setting.over && setting.source === 'panel') {
        row.note = `${row.note}; ${isUnset(setting.over.value) ? 'the setting is not set' : `the setting says ${settingText(setting.over.value)}`}`;
    } else if (setting.over) {
        row.warning = `${SOURCE_TEXT[setting.over.source]} say ${settingText(setting.over.value)}, and the Project's own file comes first`;
    }
    return row;
}

function settingsSection(input: ProjectInfoInput): InfoSection {
    return { name: 'settings', title: 'Settings', note: 'the value in effect, and where it is set', looking: false, rows: input.settings.map((setting) => settingRow(input.root, setting)) };
}

const USES = 'extension uses';

function credentialRows(credentials: Credentials, input: ProjectInfoInput): InfoRow[] {
    const signIn: InfoRow = { label: '', value: SIGN_IN_COMMAND, note: 'put it in a terminal', link: { kind: 'sign in' } };
    if (credentials.error && !credentials.type) {
        return [{ label: USES, value: '(not signed in)', absent: true, warning: credentials.error }, signIn];
    }
    const rows: InfoRow[] = [];
    if (credentials.error) {
        rows.push({ label: USES, value: credentials.account ?? '(unknown account)', ...(credentials.account ? {} : { absent: true }), warning: `sign-in failed: ${credentials.error}` });
        // A key file is not signed in to: the hint is for a login
        if (credentials.type !== 'service_account') {
            rows.push(signIn);
        }
    } else {
        rows.push(credentials.account ? { label: USES, value: credentials.account } : { label: USES, value: '(unknown account)', absent: true });
    }
    rows.push({
        label: '',
        value: credentialTypeText(credentials.type ?? ''),
        ...(input.backend === 'dbt' ? { note: "for the extension's own calls; dbt signs in as profiles.yml says" } : {}),
    });
    if (credentials.source) {
        rows.push({ label: '', value: credentials.source, link: { kind: 'path', path: credentials.source }, ...(credentials.sourceFrom ? { note: credentials.sourceFrom } : {}) });
    }
    const jobsProject = input.settings.find((setting) => setting.key === 'gcpProjectId')?.value;
    const quota: InfoRow = credentials.quotaProject ? { label: 'quota', value: credentials.quotaProject } : { label: 'quota', value: '(no quota project)', absent: true };
    if (credentials.quotaProject && typeof jobsProject === 'string' && jobsProject && jobsProject !== credentials.quotaProject) {
        quota.warning = `the gcpProjectId setting is ${jobsProject}`;
    }
    rows.push(quota);
    return rows;
}

function gcloudRows(gcloud: GcloudAccount, credentials: Credentials): InfoRow[] {
    if (gcloud.error) {
        return [{ label: 'gcloud', value: '(unknown)', absent: true, note: gcloud.error }];
    }
    const row: InfoRow = gcloud.account ? { label: 'gcloud', value: gcloud.account } : { label: 'gcloud', value: '(no account)', absent: true };
    if (gcloud.project) {
        row.note = `project ${gcloud.project}`;
    }
    if (gcloud.account && credentials.account && gcloud.account.toLowerCase() !== credentials.account.toLowerCase()) {
        row.warning = 'not the account the extension uses';
    }
    return [row];
}

function googleSection(input: ProjectInfoInput): InfoSection {
    const section: InfoSection = { name: 'google cloud', title: 'Google Cloud', looking: !input.google, rows: [] };
    section.rows = input.google
        ? [...credentialRows(input.google.credentials, input), ...gcloudRows(input.google.gcloud, input.google.credentials)]
        : [{ label: USES, value: LOOKING, absent: true }];
    return section;
}

function gitSection(input: ProjectInfoInput): InfoSection {
    const section: InfoSection = { name: 'git', title: 'Git', looking: !input.git, rows: [] };
    const git = input.git;
    if (!git) {
        section.rows = [{ label: 'branch', value: LOOKING, absent: true }];
        return section;
    }
    if (git.error) {
        section.rows = [{ label: 'branch', value: `(${git.error})`, absent: true }];
        return section;
    }
    const rows: InfoRow[] = [git.branch ? { label: 'branch', value: git.branch } : { label: 'branch', value: `(detached${git.detachedAt ? ` at ${git.detachedAt}` : ''})`, absent: true }];
    if (git.origin) {
        const web = remoteWebUrl(git.origin);
        rows.push({ label: 'origin', value: withoutCredentials(git.origin), ...(web ? { link: { kind: 'url', url: web } } : {}) });
    } else {
        rows.push({ label: 'origin', value: '(no remote named origin)', absent: true });
    }
    if (git.compare && 'error' in git.compare) {
        rows.push({ label: 'compares with', value: '(nothing)', absent: true, warning: git.compare.error });
    } else if (git.compare) {
        const { baseRef, mergeBase, onDefaultBranch } = git.compare;
        rows.push({
            label: 'compares with',
            value: baseRef,
            note: onDefaultBranch ? 'the branch you are on: Run Changed sees only what is not committed' : `Run Changed looks for what changed since ${mergeBase.slice(0, 7)}, where the branch left it`,
        });
    }
    if (git.api) {
        const { repository, repositoryFrom, location, upstream, unpushed } = git.api;
        rows.push(repository
            ? { label: 'Dataform repository', value: repository, note: repositoryFrom === 'setting' ? 'the gitRepoName setting' : "from origin's name" }
            : { label: 'Dataform repository', value: '(unknown)', absent: true, warning: 'set gitRepoName: origin does not name one' });
        rows.push(location
            ? { label: 'location', value: location, note: 'as you chose it when first asked' }
            : { label: 'location', value: '(not chosen yet)', absent: true, note: 'asked for on the first use of the Dataform API' });
        if (!upstream) {
            rows.push({ label: 'pushed', value: '(the branch tracks none on the remote)', absent: true, warning: 'API mode compiles the pushed commit: push the branch' });
        } else if (unpushed) {
            rows.push({ label: 'pushed', value: `${unpushed} commit${unpushed === 1 ? '' : 's'} not on ${upstream}`, warning: 'API mode compiles the pushed commit' });
        } else {
            rows.push({ label: 'pushed', value: `yes, to ${upstream}` });
        }
    }
    section.rows = rows;
    return section;
}

/** The `project info` slice: five sections, the same ones for both Backends */
export function projectInfoSlice(input: ProjectInfoInput): ProjectInfoSlice {
    return { root: input.root, sections: [projectSection(input), binariesSection(input), googleSection(input), gitSection(input), settingsSection(input)] };
}

/** Every link of a slice: what a click in the panel may ask the host to follow */
export function linksOf(slice: ProjectInfoSlice | undefined): InfoLink[] {
    return (slice?.sections ?? []).flatMap((section) => section.rows).flatMap((row) => [row.link, row.noteLink]).filter((link): link is InfoLink => link !== undefined);
}

/** How many rows of a slice are marked as a likely mistake */
export function warningsOf(slice: ProjectInfoSlice | undefined): number {
    return (slice?.sections ?? []).flatMap((section) => section.rows).filter((row) => row.warning).length;
}
