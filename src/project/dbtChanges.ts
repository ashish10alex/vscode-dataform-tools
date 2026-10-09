import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { ChangedActions } from '../backend/backend';
import { ChangeBase, getStorageRoot, isGitRepo, noChangesMessage, resolveChangeBase } from '../changedActions';
import { logger } from '../logger';
import { changedFileKey, describeComparison } from '../shared/changeComparison';
import { isMadeUpTarget } from '../shared/compiledGraph';
import type { ChangedActionsView } from '../types';
import { extractSnapshot, mirrorTree } from '../utils/gitSnapshot';
import type { DbtOptions } from '../backend/dbt';
import { dbtOptions } from './dbtCompile';
import { DbtRun, lastDbtRun, repeatDbtRun, runDbt } from './dbtRun';
import type { ProjectState } from './registry';

/*
 * Run Changed for a dbt Project: the actions that differ from the merge-base with the default branch, as dbt finds
 * them (`state:modified`). The extension gives dbt the base to compare with: it takes the merge-base out of git
 * into a directory of its own, parses it there with the same dbt, dbt target and variables as the Project, and
 * keeps the manifest by commit. The Project's own `target/` is never read or written.
 *
 * Nothing here runs unasked: the list is worked out when the panel's popover opens or a command asks, since each
 * time is a dbt process.
 */

const MAX_CACHED_BASES_PER_PROJECT = 5;
/** Written last into a base's directory: one without it was cut short */
const COMPLETE = 'complete';
const PACKAGES_DIR = 'dbt_packages';
/** What says which packages a Project installs, and at which versions */
const PACKAGE_FILES = ['packages.yml', 'dependencies.yml', 'package-lock.yml'];

/** The Changed Actions of a dbt Project, and what they were compared with */
export interface DbtChangesResult extends ChangedActions, Omit<ChangeBase, 'remote'> {
    /** What a run of what changed takes as its base: the directory of the base's manifest */
    stateDir: string;
}

interface ProjectChanges {
    view: ChangedActionsView;
    result?: DbtChangesResult;
    /** Counts the listings asked for, so that one a later one overtook is dropped */
    seq: number;
    running?: AbortController;
}

const states = new Map<string, ProjectChanges>();
const changed = new vscode.EventEmitter<string>();
/** Fires with a Project's root when what is known of its Changed Actions has changed */
export const onDidChangeDbtChanges = changed.event;
const basesInFlight = new Map<string, Promise<string>>();

function setView(root: string, state: ProjectChanges, view: ChangedActionsView, result?: DbtChangesResult) {
    state.view = view;
    state.result = result;
    changed.fire(root);
}

/**
 * The "Run changed" state of the Project for the panel. Undefined until it is known whether the Project is in a git
 * repository, which is then looked up: the panel shows no button meanwhile.
 */
export function dbtChangesView(root: string): ChangedActionsView | undefined {
    const state = states.get(root);
    if (state) {
        return state.view;
    }
    const pending: ProjectChanges = { view: { status: 'unavailable' }, seq: 0 };
    states.set(root, pending);
    void isGitRepo(root).then((inRepo) => {
        if (inRepo && pending.view.status === 'unavailable') {
            setView(root, pending, { status: 'idle' });
        }
    });
    return undefined;
}

/** The list the panel shows for the Project, when it shows one */
export function dbtChangesResult(root: string): DbtChangesResult | undefined {
    return states.get(root)?.result;
}

/**
 * Forgets the list of the Project `file` is in, of every Project in the git repository at `repository`, or of every
 * Project: the files, the branch or the dbt target it was made for are no longer those. A list being worked out is
 * left to end.
 */
export function forgetDbtChanges(where: { file?: string; repository?: string } = {}) {
    for (const [root, state] of states) {
        const meant = where.file !== undefined ? where.file.startsWith(root + path.sep)
            : where.repository !== undefined ? root === where.repository || root.startsWith(where.repository + path.sep)
            : true;
        if (meant && (state.view.status === 'ready' || state.view.status === 'error')) {
            setView(root, state, { status: 'idle' });
        }
    }
}

function shortHash(value: string): string {
    return createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function realPath(file: string): string {
    try {
        return fs.realpathSync(file);
    } catch {
        return file;
    }
}

/** Where dbt looks for `profiles.yml` when it parses the copy of the base: where it does for the Project, which the copy's own directory would hide */
function profilesDirFor(root: string, options: DbtOptions): string | undefined {
    if (options.profilesDir) {
        return path.resolve(root, options.profilesDir);
    }
    return fs.existsSync(path.join(root, 'profiles.yml')) ? root : undefined;
}

/** A parsed base depends on the dbt, the dbt target and the variables as well as the commit */
function baseDir(root: string, sha: string, options: DbtOptions): string {
    const made = shortHash([realPath(options.binary), options.target ?? '', options.vars ?? '', profilesDirFor(root, options) ?? ''].join('\n'));
    return path.join(getStorageRoot(), 'dbt', shortHash(path.resolve(root)), `${sha}__${made}`);
}

function read(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

/**
 * Gives the copy of the base the Project's installed packages, which git does not have. False when it could not:
 * the Project has none installed, or the base asks for other packages or versions, and dbt must then install them.
 */
async function sharePackages(root: string, snapshotDir: string): Promise<boolean> {
    const installed = path.join(root, PACKAGES_DIR);
    if (!fs.existsSync(installed) || PACKAGE_FILES.some((file) => read(path.join(root, file)) !== read(path.join(snapshotDir, file)))) {
        return false;
    }
    try {
        await fs.promises.symlink(installed, path.join(snapshotDir, PACKAGES_DIR), 'junction');
    } catch {
        // No links here: hardlinks, or copies across volumes
        await mirrorTree(installed, path.join(snapshotDir, PACKAGES_DIR));
    }
    return true;
}

async function pruneBases(dir: string) {
    try {
        const parent = path.dirname(dir);
        const entries = await Promise.all((await fs.promises.readdir(parent)).map(async (name) => ({ dir: path.join(parent, name), mtime: (await fs.promises.stat(path.join(parent, name))).mtimeMs })));
        entries.sort((a, b) => b.mtime - a.mtime);
        for (const stale of entries.slice(MAX_CACHED_BASES_PER_PROJECT)) {
            await fs.promises.rm(stale.dir, { recursive: true, force: true });
        }
    } catch (error) {
        logger.error(`dbt: could not remove old bases: ${error}`);
    }
}

async function parseBase(project: ProjectState, options: DbtOptions, base: ChangeBase, dir: string): Promise<string> {
    const { root } = project;
    const snapshotDir = path.join(getStorageRoot(), 'snapshots', `${base.mergeBaseSha.slice(0, 12)}-${Date.now()}`);
    await fs.promises.mkdir(snapshotDir, { recursive: true });
    try {
        await extractSnapshot(root, base.mergeBaseSha, snapshotDir);
        if (!fs.existsSync(path.join(snapshotDir, 'dbt_project.yml'))) {
            throw new Error(`${base.baseRef} @ ${base.mergeBaseSha.slice(0, 7)} has no dbt project here, so there is nothing to compare with.`);
        }
        const declaresPackages = ['packages.yml', 'dependencies.yml'].some((file) => fs.existsSync(path.join(snapshotDir, file)));
        const install = !(await sharePackages(root, snapshotDir)) && declaresPackages;
        await fs.promises.rm(dir, { recursive: true, force: true });
        const stateDir = await project.dbtBackend!.parseBase({ root: snapshotDir, options: { ...options, profilesDir: profilesDirFor(root, options), artifactDir: dir }, logger, signal: new AbortController().signal }, install);
        await fs.promises.writeFile(path.join(dir, COMPLETE), new Date().toISOString());
        await pruneBases(dir);
        return stateDir;
    } finally {
        // A link to the Project's packages is removed without touching what it points to
        await fs.promises.rm(snapshotDir, { recursive: true, force: true }).catch((error) => logger.error(`dbt: could not remove the copy of the base: ${error}`));
    }
}

/**
 * The directory of the base's manifest, parsed first when it has not been for this commit, dbt, dbt target and
 * variables. A parse is never cut short: whoever asks next for the same base waits for it, and it is kept.
 */
async function ensureBase(project: ProjectState, options: DbtOptions, base: ChangeBase): Promise<string> {
    const dir = baseDir(project.root, base.mergeBaseSha, options);
    const pending = basesInFlight.get(dir);
    if (pending) {
        return pending;
    }
    const stateDir = path.join(dir, 'target');
    if (fs.existsSync(path.join(dir, COMPLETE)) && fs.existsSync(path.join(stateDir, 'manifest.json'))) {
        // Used now, so it is the last to be removed
        const now = new Date();
        await fs.promises.utimes(dir, now, now).catch(() => undefined);
        return stateDir;
    }
    const parse = Promise.resolve(vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `dbt: parsing ${base.baseRef} @ ${base.mergeBaseSha.slice(0, 7)}` },
        () => parseBase(project, options, base, dir),
    )).finally(() => basesInFlight.delete(dir));
    basesInFlight.set(dir, parse);
    return parse;
}

async function usableOptions(root: string): Promise<DbtOptions> {
    const options = await dbtOptions(root);
    if (!options) {
        throw new Error('dbt was not found for this project. The compiled query panel says where it was looked for.');
    }
    return options;
}

function targetText(action: ChangedActions['deleted'][number]): string {
    const { database, schema, name } = action.target;
    return isMadeUpTarget(action.target) ? name : `${database}.${schema}.${name}`;
}

export function toDbtChangesView(result: DbtChangesResult): ChangedActionsView {
    return {
        status: 'ready',
        baseRef: result.baseRef,
        mergeBaseSha: result.mergeBaseSha,
        headLabel: result.headLabel,
        headRef: result.headRef,
        defaultBranch: result.defaultBranch,
        onDefaultBranch: result.onDefaultBranch,
        changed: result.changed.map((action) => ({ target: targetText(action), fileName: action.fileName, type: action.kind, reasons: action.reasons })),
        deleted: result.deleted.map((action) => ({ target: targetText(action), fileName: action.fileName, type: action.kind })),
    };
}

/**
 * Works out the Project's Changed Actions and tells the panel: that it is being done, then the list or why there is
 * none. Rejects with the same reason. A listing asked for while one runs replaces it; the one replaced resolves to
 * undefined. `given` stands in for the options the settings and the dbt that was found give.
 */
export async function listDbtChangedActions(project: ProjectState, given?: DbtOptions): Promise<DbtChangesResult | undefined> {
    const { root } = project;
    let state = states.get(root);
    if (!state) {
        state = { view: { status: 'idle' }, seq: 0 };
        states.set(root, state);
    }
    state.running?.abort(new Error('A newer list of changed actions was asked for'));
    const running = new AbortController();
    const seq = ++state.seq;
    state.running = running;
    setView(root, state, { status: 'computing' });
    try {
        if (!(await isGitRepo(root))) {
            throw new Error('The dbt project is not in a git repository, so there is no default branch to compare with.');
        }
        const options = given ?? await usableOptions(root);
        const base = await resolveChangeBase(root, false);
        const stateDir = await ensureBase(project, options, base);
        running.signal.throwIfAborted();
        // In a directory of its own: a compile may run at the same time, and writes where compiles write
        const listed = await project.dbtBackend!.changes.changedActions({ root, options: { ...options, artifactDir: path.join(options.artifactDir, 'changes') }, logger, signal: running.signal, base: stateDir });
        if (seq !== state.seq) {
            return undefined;
        }
        const { remote: _remote, ...compared } = base;
        const result: DbtChangesResult = { ...compared, stateDir, changed: listed.changed, deleted: listed.deleted };
        setView(root, state, toDbtChangesView(result), result);
        return result;
    } catch (error) {
        if (seq !== state.seq) {
            return undefined;
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`dbt: could not work out the changed actions of ${root}: ${message}`);
        setView(root, state, { status: 'error', error: message });
        throw error;
    } finally {
        if (state.running === running) {
            state.running = undefined;
        }
    }
}

export interface DbtChangesRun {
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
    /** Only the changes in these files (keyed by `changedFileKey`). Unset runs all that changed */
    files?: string[];
}

/** The last runs of what changed, by Project root, with the files each was kept to */
const lastChangedRuns = new Map<string, { run: DbtRun; request: DbtChangesRun }>();

/**
 * Sends a run of what changed to the Project's terminal. dbt finds what changed when the run starts; with `files`
 * it is kept to the changed actions of those files, taken from `listed` when given, else from a list worked out now.
 * Resolves to undefined when nothing was run; the reason has then been shown to the user.
 */
export async function runDbtChangedActions(project: ProjectState, request: DbtChangesRun, listed?: DbtChangesResult): Promise<DbtRun | undefined> {
    const { root } = project;
    let stateDir: string;
    let actions: string[] = [];
    try {
        if (request.files) {
            const result = listed ?? await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Working out changed actions…' }, () => listDbtChangedActions(project));
            if (!result) {
                return undefined;
            }
            const files = new Set(request.files);
            const kept = result.changed.filter((action) => files.has(changedFileKey(action.fileName)));
            if (kept.length === 0) {
                vscode.window.showInformationMessage(result.changed.length === 0 ? noChangesMessage(result) : `None of the selected files still have changes ${describeComparison(result.headRef, result.baseRef)}, so nothing was run.`);
                return undefined;
            }
            if (listed && kept.length === result.changed.length) {
                // Every file on show was chosen: that is a run of all that changed, and is repeated as one
                request = { ...request, files: undefined };
            } else {
                actions = kept.map((action) => action.id);
            }
            stateDir = result.stateDir;
        } else if (listed) {
            stateDir = listed.stateDir;
        } else {
            stateDir = await ensureBase(project, await usableOptions(root), await resolveChangeBase(root, false));
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Could not work out changed actions: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
    const { includeDependencies, includeDependents, fullRefresh } = request;
    const run = await runDbt(project, { actions, tags: [], includeDependencies, includeDependents, fullRefresh, changed: { base: stateDir } });
    if (run) {
        lastChangedRuns.set(root, { run, request });
    }
    return run;
}

/**
 * Sends the Project's last run to the terminal again. A run of what changed is asked for anew, so that it compares
 * with the default branch as it is now, and keeps to the files it was kept to.
 */
export async function repeatLastDbtRun(project: ProjectState): Promise<DbtRun | undefined> {
    const last = lastChangedRuns.get(project.root);
    if (last && last.run === lastDbtRun(project.root)) {
        return runDbtChangedActions(project, last.request);
    }
    return repeatDbtRun(project);
}

export function initDbtChanges(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        changed,
        // The list was made for the files as they were
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (document.uri.scheme === 'file') {
                forgetDbtChanges({ file: document.uri.fsPath });
            }
        }),
    );
}
