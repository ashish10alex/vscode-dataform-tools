import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { listDbtTargets } from '../backend/dbt';
import { resolveChangeBase } from '../changedActions';
import { logger } from '../logger';
import { GitInfo, INFO_SETTINGS, ProjectInfoInput, SettingInfo, SettingsFiles, ToolInfo, linksOf, projectInfoSlice, settingInfo, withPanelChoice } from '../panel/projectInfo';
import type { InfoLink, ProjectInfoSlice } from '../shared/panelContract';
import type { ExecutableSource } from '../types';
import { readDataformCoreVersion } from '../utils/dataformHelpers';
import { getSqlfluffConfigPathFromSettings, resolveExecutable } from '../utils/executableResolver';
import { Credentials, GcloudAccount, SIGN_IN_COMMAND, lookUpCredentials, lookUpGcloud } from '../utils/googleAccounts';
import { dbtSettings } from './dbtCompile';
import { dbtToolNow } from './dbtTool';
import { SETTINGS_FILES, isWithin } from './detection';
import { ProjectState, projects } from './index';
import { extensionConfiguration } from './settings';
import { SETTINGS_SECTION, projectFileSettings, settingsFileOf } from './settingsFile';

/*
 * The host's side of the Project tab of the compiled-query panel: looks up what the tab shows of a Project and of
 * the user's setup, and keeps it current while the tab is on show. What is cheap (settings, the tools' paths) is
 * read on every change; git is asked again then too; the Google accounts are asked for once, and again on Refresh.
 * The rows themselves are worked out in src/panel/projectInfo.ts.
 */

const FOUND_BY: Record<ExecutableSource, string> = {
    setting: 'the executable path setting',
    projectLocal: "the Project's node_modules",
    path: 'PATH',
    commonLocation: 'a common install location',
};

const COMMAND_TIMEOUT_MS = 15000;

function run(binary: string, args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // A `.cmd` file, as some of these are on Windows, is not run without a shell
        const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary);
        execFile(binary, args, { cwd, timeout: COMMAND_TIMEOUT_MS, windowsHide: true, shell }, (error, stdout) => (error ? reject(error) : resolve(stdout.trim())));
    });
}

/** One `--version` per executable as it is on disk: a new file at the same path is asked again */
const versions = new Map<string, Promise<string | undefined>>();

function versionOf(binary: string): Promise<string | undefined> {
    let stamp = '';
    try {
        const stat = fs.statSync(binary);
        stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
        // Asked anyway: no version is what it then gives
    }
    const key = `${binary}:${stamp}`;
    let version = versions.get(key);
    if (!version) {
        version = run(binary, ['--version'])
            .then((printed) => printed.split(/\r?\n/).map((line) => line.trim()).find(Boolean))
            .catch((error) => {
                logger.debug(`Project info: ${binary} --version failed: ${error instanceof Error ? error.message : String(error)}`);
                return undefined;
            });
        versions.set(key, version);
    }
    return version;
}

/** The settings files a value of the Project at `root` can be in */
function settingsFilesOf(root: string): Omit<SettingsFiles, 'project'> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === 'file').map((folder) => folder.uri.fsPath);
    const folder = folders.filter((candidate) => isWithin(candidate, root)).sort((a, b) => b.length - a.length)[0];
    const workspaceFile = vscode.workspace.workspaceFile;
    const ofFolder = folder ? settingsFileOf(folder) : undefined;
    return {
        // Without a workspace file the workspace's settings are the one folder's
        workspace: workspaceFile?.scheme === 'file' ? workspaceFile.fsPath : ofFolder,
        folder: ofFolder,
    };
}

function settingsOf(project: ProjectState): SettingInfo[] {
    const configuration = extensionConfiguration(vscode.Uri.file(project.root));
    const files = settingsFilesOf(project.root);
    // The Project's own file is read by the extension only where VS Code does not read it as a folder's
    const ownFile = files.folder === settingsFileOf(project.root) ? {} : projectFileSettings(project.root);
    return INFO_SETTINGS[project.backend].map((key) => {
        const inOwnFile = Object.prototype.hasOwnProperty.call(ownFile, key);
        const setting = settingInfo(key, configuration.inspect(key), { ...files, ...(inOwnFile ? { project: settingsFileOf(project.root) } : {}) });
        if (key === 'dbtTarget') {
            const dbt = dbtSettings(project.root);
            return withPanelChoice(setting, dbt.overridden ? dbt.target : undefined);
        }
        return setting;
    });
}

/** The tools of the Project as they are found now. `read` says which versions have been read: a tool not in it is still being asked */
function toolsOf(project: ProjectState, apiMode: boolean, read: Map<string, string | undefined>, coreVersion: string | undefined): ToolInfo[] {
    const { root } = project;
    const withVersion = (tool: ToolInfo): ToolInfo => {
        if (!tool.path) {
            return tool;
        }
        if (!read.has(tool.path)) {
            return { ...tool, looking: true };
        }
        const version = read.get(tool.path);
        return version ? { ...tool, version } : tool;
    };
    const found = (name: string, optional?: string): ToolInfo => {
        const { path: toolPath, foundBy } = resolveExecutable(name, root);
        if (!toolPath) {
            return { name, ...(optional ? { optional } : {}) };
        }
        return withVersion({ name, path: toolPath, ...(foundBy ? { foundBy: foundBy === 'setting' ? `the ${name}ExecutablePath setting` : FOUND_BY[foundBy] } : {}) });
    };
    const tools: ToolInfo[] = [];
    if (project.backend === 'dataform') {
        const dataform = found('dataform', apiMode ? 'not needed in API mode' : undefined);
        if (coreVersion) {
            dataform.more = [{ value: `@dataform/core ${coreVersion}`, note: "the Project's dataformCoreVersion" }];
        }
        tools.push(dataform);
    } else {
        const dbt = dbtToolNow(root);
        if (!dbt || dbt.status === 'looking') {
            tools.push({ name: 'dbt', looking: true });
        } else if (dbt.status === 'found') {
            tools.push({ name: 'dbt', path: dbt.path, foundBy: dbt.foundBy, version: dbt.probe.label });
        } else if (dbt.status === 'unusable') {
            tools.push({ name: 'dbt', path: dbt.path, foundBy: dbt.foundBy, problem: dbt.reason });
        } else {
            tools.push({ name: 'dbt', lookedIn: dbt.looked });
        }
    }
    tools.push(found('gcloud', 'only asked which account it is signed in as'));
    if (project.backend === 'dataform') {
        const configuration = extensionConfiguration(vscode.Uri.file(root));
        if (configuration.get<string>('formattingCli') === 'dataform') {
            tools[0].more = [...(tools[0].more ?? []), { value: 'also formats', note: 'the formattingCli setting' }];
        } else {
            const sqlfluff = found('sqlfluff', 'only needed to format and lint');
            const config = getSqlfluffConfigPathFromSettings();
            const configPath = path.isAbsolute(config) ? config : path.join(root, config);
            sqlfluff.more = [{ value: config, note: fs.existsSync(configPath) ? 'its config file' : 'its config file, written on the first format', ...(fs.existsSync(configPath) ? { path: configPath } : {}) }];
            tools.push(sqlfluff);
        }
    }
    return tools;
}

/** The branch, remote and compare base of the checkout that holds `root`. `apiMode`: also what a compile through the Dataform API needs */
async function readGit(root: string, apiMode: boolean, context: vscode.ExtensionContext): Promise<GitInfo> {
    const git = (...args: string[]) => run('git', args, root);
    const quiet = (...args: string[]) => git(...args).catch(() => '');
    if ((await quiet('rev-parse', '--is-inside-work-tree')) !== 'true') {
        return { error: 'not a git repository' };
    }
    const info: GitInfo = {};
    const [branch, origin] = await Promise.all([quiet('symbolic-ref', '--quiet', '--short', 'HEAD'), quiet('remote', 'get-url', 'origin')]);
    if (branch) {
        info.branch = branch;
    } else {
        info.detachedAt = (await quiet('rev-parse', '--short', 'HEAD')) || undefined;
    }
    if (origin) {
        info.origin = origin;
    }
    try {
        const base = await resolveChangeBase(root, apiMode);
        info.compare = { baseRef: base.baseRef, mergeBase: base.mergeBaseSha, onDefaultBranch: base.onDefaultBranch };
    } catch (error) {
        info.compare = { error: error instanceof Error ? error.message.split('\n')[0] : String(error) };
    }
    if (apiMode) {
        const named = extensionConfiguration(vscode.Uri.file(root)).get<string>('gitRepoName')?.trim();
        const repository = named || /([^/:]+?)(?:\.git)?$/.exec(origin)?.[1];
        const upstream = await quiet('rev-parse', '--abbrev-ref', '@{u}');
        const unpushed = upstream ? Number(await quiet('rev-list', '--count', '@{u}..HEAD')) || 0 : 0;
        const location = repository ? context.globalState.get<string>(`vscode_dataform_tools_${repository}`) : undefined;
        info.api = {
            repositoryFrom: named ? 'setting' : 'origin',
            ...(repository ? { repository } : {}),
            ...(location ? { location } : {}),
            ...(upstream ? { upstream, unpushed } : {}),
        };
    }
    return info;
}

interface Known {
    project: ProjectState;
    google?: { credentials: Credentials; gcloud: GcloudAccount };
    git?: GitInfo;
    /** By executable path. A path that is not in it is still being asked */
    versions: Map<string, string | undefined>;
    coreVersion?: string;
}

/** Looks up the `project info` slice of one panel and sends it, while the Project tab is on show */
export class ProjectInfoWatch {
    private known: Known | undefined;
    private visible = false;
    /** Counts the lookups started from scratch, so that an answer to an earlier one is dropped */
    private generation = 0;
    private sent: ProjectInfoSlice | undefined;
    private settings: SettingInfo[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;
    /** A Project was noted while the tab was hidden: nothing has been looked up for it yet */
    private pending = false;

    /** @param send Sends the slice to the panel; null takes back the one it has */
    constructor(private readonly context: vscode.ExtensionContext, private readonly send: (slice: ProjectInfoSlice | null) => unknown) {}

    /** The tab is on show for `project`: what is known is sent at once, and the rest as it arrives */
    show(project: ProjectState | undefined) {
        this.visible = true;
        if (this.known?.project !== project) {
            this.setProject(project);
        } else if (this.known) {
            this.update();
        }
    }

    hide() {
        this.visible = false;
    }

    /** Everything is looked up again */
    refresh() {
        if (this.known) {
            versions.clear();
            this.start(this.known.project);
        }
    }

    /**
     * The Project the panel shows may be another one. What was sent of the last is taken back; the next is looked up
     * now when the tab is on show, else when it is shown.
     */
    setProject(project: ProjectState | undefined) {
        if (this.known?.project === project) {
            return;
        }
        if (project && this.visible) {
            this.start(project);
            return;
        }
        this.generation++;
        this.known = project ? { project, versions: new Map() } : undefined;
        this.pending = project !== undefined;
        if (this.sent) {
            this.sent = undefined;
            this.send(null);
        }
    }

    /** Something the tab shows may have changed: a setting, a compile, the branch. Several in a row are one */
    changed() {
        if (!this.visible || !this.known) {
            return;
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.update(), 200);
    }

    dispose() {
        clearTimeout(this.timer);
        this.generation++;
        this.visible = false;
    }

    private start(project: ProjectState) {
        this.generation++;
        this.pending = false;
        this.known = { project, versions: new Map() };
        this.post();
        this.lookUpGoogle();
        this.readSlow();
    }

    private update() {
        if (!this.known) {
            return;
        }
        if (this.pending) {
            this.start(this.known.project);
            return;
        }
        this.post();
        this.readSlow();
    }

    private apiMode(project: ProjectState): boolean {
        return project.backend === 'dataform' && extensionConfiguration(vscode.Uri.file(project.root)).get<string>('compilationBackend') === 'api';
    }

    private input(known: Known): ProjectInfoInput {
        const { project } = known;
        const { root, backend } = project;
        const apiMode = this.apiMode(project);
        const input: ProjectInfoInput = {
            root,
            backend,
            settingsFile: SETTINGS_FILES[backend].find((file) => fs.existsSync(path.join(root, file))),
            sharedRoot: projects.find(root, backend === 'dbt' ? 'dataform' : 'dbt') !== undefined,
            extensionVersion: String(this.context.extension.packageJSON.version ?? ''),
            tools: toolsOf(project, apiMode, known.versions, known.coreVersion),
            settings: settingsOf(project),
            ...(known.google ? { google: known.google } : {}),
            ...(known.git ? { git: known.git } : {}),
        };
        if (backend === 'dataform') {
            input.compilationMode = apiMode ? 'api' : 'cli';
        } else {
            const settings = dbtSettings(root);
            const last = project.dbtBackend?.lastResult;
            const targets = listDbtTargets(root, { profilesDir: settings.profilesDir });
            const name = settings.target ?? last?.target;
            input.dbt = {
                ...(last?.dbt?.projectName ? { name: last.dbt.projectName } : {}),
                ...(targets?.profile ? { profile: targets.profile } : {}),
                ...(last?.dbt?.adapterType ? { warehouse: last.dbt.adapterType } : {}),
                target: {
                    ...(name ? { name } : {}),
                    overridden: settings.overridden,
                    ...(targets?.defaultName ? { profileDefault: targets.defaultName } : {}),
                    ...(settings.settingTarget ? { setting: settings.settingTarget } : {}),
                },
            };
        }
        return input;
    }

    private post() {
        if (!this.known) {
            return;
        }
        const input = this.input(this.known);
        this.settings = input.settings;
        this.sent = projectInfoSlice(input);
        this.send(this.sent);
    }

    /** Whether an answer that has arrived is still wanted: nothing has been started from scratch since */
    private current(generation: number): Known | undefined {
        return generation === this.generation ? this.known : undefined;
    }

    private lookUpGoogle() {
        const generation = this.generation;
        const { root } = this.known!.project;
        const keyFile = extensionConfiguration(vscode.Uri.file(root)).get<string>('serviceAccountJsonPath')?.trim() || undefined;
        const gcloud = resolveExecutable('gcloud', root).path ?? undefined;
        Promise.all([lookUpCredentials(keyFile), lookUpGcloud(gcloud)])
            .then(([credentials, account]) => {
                const known = this.current(generation);
                if (known) {
                    known.google = { credentials, gcloud: account };
                    this.post();
                }
            })
            .catch((error) => logger.error(`Project info: the Google accounts could not be looked up: ${error}`));
    }

    /** Git and the tools' versions: asked again on every change, and what is shown stays until the answer is in */
    private readSlow() {
        const generation = this.generation;
        const { project } = this.known!;
        const { root } = project;
        readGit(root, this.apiMode(project), this.context)
            .catch((error): GitInfo => ({ error: error instanceof Error ? error.message : String(error) }))
            .then((git) => {
                const known = this.current(generation);
                if (known && JSON.stringify(known.git) !== JSON.stringify(git)) {
                    known.git = git;
                    this.post();
                }
            });
        const binaries = (project.backend === 'dataform' ? ['dataform', 'gcloud', 'sqlfluff'] : ['gcloud']).map((name) => resolveExecutable(name, root).path).filter((found): found is string => !!found && !this.known!.versions.has(found));
        const core = project.backend === 'dataform' ? readDataformCoreVersion(root).catch(() => undefined) : Promise.resolve(undefined);
        Promise.all([core, ...binaries.map(versionOf)]).then(([coreVersion, ...read]) => {
            const known = this.current(generation);
            if (!known) {
                return;
            }
            const before = JSON.stringify([known.coreVersion, [...known.versions]]);
            known.coreVersion = coreVersion ?? undefined;
            binaries.forEach((binary, index) => known.versions.set(binary, read[index]));
            if (JSON.stringify([known.coreVersion, [...known.versions]]) !== before) {
                this.post();
            }
        });
    }

    /** Does what a link of the tab asks for. A link that is not in the slice last sent is not followed */
    async follow(link: InfoLink) {
        if (!linksOf(this.sent).some((sent) => JSON.stringify(sent) === JSON.stringify(link))) {
            logger.debug(`Project info: not following a link that was not sent: ${JSON.stringify(link)}`);
            return;
        }
        switch (link.kind) {
            case 'url':
                await vscode.env.openExternal(vscode.Uri.parse(link.url));
                return;
            case 'sign in': {
                // Typed, not run: the user sees what it is before it opens a browser
                const terminal = vscode.window.createTerminal('Google Cloud sign-in');
                terminal.show();
                terminal.sendText(SIGN_IN_COMMAND, false);
                return;
            }
            case 'path':
                await showPath(link.path);
                return;
            case 'setting':
                await this.openSetting(link.key);
                return;
        }
    }

    private async openSetting(key: string) {
        const setting = this.settings.find((candidate) => candidate.key === key);
        const id = `${SETTINGS_SECTION}.${key}`;
        if (setting?.file && fs.existsSync(setting.file)) {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(setting.file));
            const at = document.getText().indexOf(`"${id}"`);
            const position = document.positionAt(Math.max(at, 0));
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false, selection: new vscode.Range(position, position) });
            return;
        }
        if (setting?.source === 'user') {
            await vscode.commands.executeCommand('workbench.action.openSettingsJson', { revealSetting: { key: id } });
            return;
        }
        await vscode.commands.executeCommand('workbench.action.openSettings', id);
    }
}

/** The files that are read as text: any other file, and a directory, is shown where it is */
const TEXT_FILE = /(\.(json|ya?ml|toml|cfg|ini|code-workspace)|[\\/]\.sqlfluff)$/i;

async function showPath(target: string) {
    let isFile = false;
    try {
        isFile = fs.statSync(target).isFile();
    } catch {
        void vscode.window.showWarningMessage(`${target} is not there any more.`);
        return;
    }
    if (isFile && TEXT_FILE.test(target) && !/credentials|service[-_]?account|key/i.test(path.basename(target))) {
        await vscode.window.showTextDocument(vscode.Uri.file(target), { viewColumn: vscode.ViewColumn.One, preview: true });
        return;
    }
    // A credential file is shown where it is, not opened: its content is a secret
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
}
