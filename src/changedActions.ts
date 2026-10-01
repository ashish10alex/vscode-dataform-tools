import * as vscode from 'vscode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import util from 'util';
import { execFile } from 'child_process';
import { logger } from './logger';
import { changedFileKey, describeComparison } from './shared/changeComparison';
import { ChangedActionsView, DataformCompiledJson, ExecutionMode, LastRunRequest } from './types';
import { ChangedAction, CompiledGraphDiff, diffCompiledGraphs } from './utils/compiledGraphDiff';
import { compileDataform, getDataformCompilerOptions, isCompilationStale, parseCompiledString, runCompilation } from './utils/dataformCompiler';
import { compileRemoteCommit, isRemoteMode } from './utils/remoteCompiler';
import { runIncludedTargets } from './utils/dataformHelpers';
import { extractSnapshot, mirrorTree } from './utils/gitSnapshot';

/*
 * "Run changed": runs only the actions whose compiled output differs from the merge-base with the
 * default branch, like dbt's `state:modified`. Locally the base is compiled from a `git archive` snapshot
 * with the same CLI and compiler options; in remote mode both sides are compiled with the Dataform API.
 * Base graphs are cached by commit, so after the first compile a diff only costs the normal compile.
 */

const execFilePromise = util.promisify(execFile);
const MAX_CACHED_BASES_PER_PROJECT = 5;

let storageRoot: string | undefined;

export function initChangedActions(context: vscode.ExtensionContext) {
    storageRoot = path.join(context.globalStorageUri.fsPath, 'changed-actions');
}

function getStorageRoot(): string {
    if (!storageRoot) {
        throw new Error('Changed actions used before initialisation');
    }
    return storageRoot;
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFilePromise('git', args, { cwd });
    return stdout.trim();
}

export async function isGitRepo(workspaceFolder: string): Promise<boolean> {
    try {
        return (await git(workspaceFolder, ['rev-parse', '--is-inside-work-tree'])) === 'true';
    } catch {
        return false;
    }
}

/** Read for the Dataform folder, so a folder-level setting applies in multi-root workspaces. */
function getDefaultBranch(workspaceFolder: string): string {
    return vscode.workspace.getConfiguration('vscode-dataform-tools', vscode.Uri.file(workspaceFolder)).get<string>('defaultBranch')?.trim() || 'main';
}

/** `origin/<branch>` when it exists, else the local branch. Does not fetch. */
async function resolveBaseRef(workspaceFolder: string, branch: string): Promise<string> {
    for (const ref of [`origin/${branch}`, branch]) {
        try {
            await git(workspaceFolder, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
            return ref;
        } catch {
            // Try the next candidate
        }
    }
    throw new Error(`Neither origin/${branch} nor ${branch} exists. Set \`vscode-dataform-tools.defaultBranch\` to your default branch.`);
}

interface ChangeBase {
    baseRef: string;
    mergeBaseSha: string;
    headLabel: string;
    /** The branch being compared (its upstream in remote mode), or a short SHA on a detached HEAD */
    headRef: string;
    remote: boolean;
    /** The `defaultBranch` setting, e.g. `main` */
    defaultBranch: string;
    /** True when the checked-out branch is the one being compared against */
    onDefaultBranch: boolean;
}

/**
 * Locally the working tree is compared with the merge-base of the default branch and HEAD. Remote mode
 * compiles pushed commits only, so there it is the merge-base with the pushed commit.
 */
async function resolveChangeBase(workspaceFolder: string): Promise<ChangeBase> {
    const remote = isRemoteMode();
    const defaultBranch = getDefaultBranch(workspaceFolder);
    const baseRef = await resolveBaseRef(workspaceFolder, defaultBranch);
    // A detached HEAD reports "HEAD", so it counts as a feature branch
    const currentBranch = await git(workspaceFolder, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const onDefaultBranch = currentBranch === defaultBranch;
    let head = 'HEAD';
    let headLabel = 'working tree';
    let headRef = currentBranch === 'HEAD' ? await git(workspaceFolder, ['rev-parse', '--short', 'HEAD']) : currentBranch;
    if (remote) {
        try {
            head = await git(workspaceFolder, ['rev-parse', '@{u}']);
            headRef = await git(workspaceFolder, ['rev-parse', '--abbrev-ref', '@{u}']);
        } catch {
            throw new Error('The current branch is not pushed. Remote mode compares the pushed commit, so push the branch first.');
        }
        headLabel = `pushed commit ${head.slice(0, 7)}`;
    }
    const mergeBaseSha = await git(workspaceFolder, ['merge-base', baseRef, head]);
    return { baseRef, mergeBaseSha, headLabel, headRef, remote, defaultBranch, onDefaultBranch };
}

function shortHash(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function projectCacheDir(workspaceFolder: string): string {
    return path.join(getStorageRoot(), 'graphs', shortHash(path.resolve(workspaceFolder)));
}

/**
 * Projects often compute values from the current date in includes/ (e.g. `new Date()` minus six months),
 * so a commit compiled yesterday differs from the same commit compiled today. Base graphs are therefore
 * cached per UTC day, which keeps them comparable with the compile of the working tree.
 */
export function baseCacheDay(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** The compiled base depends on the compiler options (schema suffix, vars, ...) and the day as well as the commit. */
function localCacheFile(workspaceFolder: string, sha: string): string {
    return path.join(projectCacheDir(workspaceFolder), `${sha}__${shortHash(getDataformCompilerOptions())}__${baseCacheDay()}.json`);
}

const memoryCache = new Map<string, DataformCompiledJson>();
const inFlight = new Map<string, Promise<DataformCompiledJson | undefined>>();

async function compileLocalBase(workspaceFolder: string, sha: string): Promise<DataformCompiledJson> {
    const snapshotDir = path.join(getStorageRoot(), 'snapshots', `${sha.slice(0, 12)}-${Date.now()}`);
    await fsp.mkdir(snapshotDir, { recursive: true });
    try {
        await extractSnapshot(workspaceFolder, sha, snapshotDir);
        // Only projects with a package.json load @dataform/core (and a local CLI) from node_modules;
        // the others use the core bundled with the CLI
        const nodeModules = path.join(workspaceFolder, 'node_modules');
        if (fs.existsSync(path.join(snapshotDir, 'package.json')) && fs.existsSync(nodeModules)) {
            await mirrorTree(nodeModules, path.join(snapshotDir, 'node_modules'));
        }
        const { compiledString, errors } = await compileDataform(snapshotDir);
        if (!compiledString) {
            const details = (errors ?? []).slice(0, 3).map((e) => (e.fileName ? `${e.fileName}: ${e.error}` : e.error)).join('\n');
            throw new Error(`Could not compile ${sha.slice(0, 7)}: ${details || 'unknown error'}`);
        }
        return parseCompiledString(compiledString);
    } finally {
        // Hardlinks and symlinks are removed without touching what they point to
        await fsp.rm(snapshotDir, { recursive: true, force: true }).catch((error) => logger.error(`Failed to remove base snapshot: ${error}`));
    }
}

async function saveLocalBase(file: string, graph: DataformCompiledJson) {
    try {
        const dir = path.dirname(file);
        await fsp.mkdir(dir, { recursive: true });
        await fsp.writeFile(file, JSON.stringify(graph));
        const entries = await Promise.all((await fsp.readdir(dir))
            .filter((name) => name.endsWith('.json'))
            .map(async (name) => ({ file: path.join(dir, name), mtime: (await fsp.stat(path.join(dir, name))).mtimeMs })));
        entries.sort((a, b) => b.mtime - a.mtime);
        for (const { file: stale } of entries.slice(MAX_CACHED_BASES_PER_PROJECT)) {
            await fsp.rm(stale, { force: true });
        }
    } catch (error) {
        logger.error(`Failed to cache base compilation: ${error}`);
    }
}

async function readLocalBase(file: string): Promise<DataformCompiledJson | undefined> {
    const cached = memoryCache.get(file);
    if (cached) {
        return cached;
    }
    try {
        const graph = JSON.parse(await fsp.readFile(file, 'utf8')) as DataformCompiledJson;
        memoryCache.clear();
        memoryCache.set(file, graph);
        return graph;
    } catch {
        return undefined;
    }
}

/**
 * The compiled base graph. Without `allowCompile`, only a cached graph (or one already being compiled)
 * is returned, so refreshing the view never starts a compile on its own.
 */
async function getBaseGraph(workspaceFolder: string, base: ChangeBase, allowCompile: boolean): Promise<DataformCompiledJson | undefined> {
    const day = baseCacheDay();
    const key = base.remote ? `remote:${base.mergeBaseSha}@${day}` : localCacheFile(workspaceFolder, base.mergeBaseSha);
    const pending = inFlight.get(key);
    if (pending) {
        return pending;
    }

    if (base.remote) {
        if (!allowCompile) {
            return compileRemoteCommit(workspaceFolder, base.mergeBaseSha, true, day);
        }
    } else {
        const cached = await readLocalBase(key);
        if (cached || !allowCompile) {
            return cached;
        }
    }

    const compile = (async () => {
        if (base.remote) {
            return compileRemoteCommit(workspaceFolder, base.mergeBaseSha, false, day);
        }
        const graph = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Compiling ${base.baseRef} @ ${base.mergeBaseSha.slice(0, 7)}` },
            () => compileLocalBase(workspaceFolder, base.mergeBaseSha),
        );
        memoryCache.clear();
        memoryCache.set(key, graph);
        await saveLocalBase(key, graph);
        return graph;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, compile);
    return compile;
}

export interface ChangedActionsResult extends CompiledGraphDiff {
    baseRef: string;
    mergeBaseSha: string;
    headLabel: string;
    headRef: string;
    defaultBranch: string;
    onDefaultBranch: boolean;
}

/** Undefined when the base is not cached and `allowCompile` is false. */
export async function computeChangedActions(workspaceFolder: string, head: DataformCompiledJson, allowCompile: boolean): Promise<ChangedActionsResult | undefined> {
    const base = await resolveChangeBase(workspaceFolder);
    const baseGraph = await getBaseGraph(workspaceFolder, base, allowCompile);
    if (!baseGraph) {
        return undefined;
    }
    return { baseRef: base.baseRef, mergeBaseSha: base.mergeBaseSha, headLabel: base.headLabel, headRef: base.headRef, defaultBranch: base.defaultBranch, onDefaultBranch: base.onDefaultBranch, ...diffCompiledGraphs(baseGraph, head) };
}

export function toChangedActionsView(result: ChangedActionsResult): ChangedActionsView {
    const strip = ({ target, fileName, type, reasons }: ChangedAction) => ({ target, fileName, type, reasons });
    return {
        status: 'ready',
        baseRef: result.baseRef,
        mergeBaseSha: result.mergeBaseSha,
        headLabel: result.headLabel,
        headRef: result.headRef,
        defaultBranch: result.defaultBranch,
        onDefaultBranch: result.onDefaultBranch,
        changed: result.changed.map(strip),
        deleted: result.deleted,
    };
}

/**
 * The view for the compiled query panel. Without `allowCompile` it is `idle` until the base has been
 * compiled once, after which every compile refreshes it for free.
 */
export async function getChangedActionsView(workspaceFolder: string | undefined, allowCompile: boolean): Promise<ChangedActionsView> {
    if (!workspaceFolder || !(await isGitRepo(workspaceFolder))) {
        return { status: 'unavailable' };
    }
    const head = CACHED_COMPILED_DATAFORM_JSON;
    if (!head || isCompilationStale()) {
        return { status: 'idle' };
    }
    try {
        const result = await computeChangedActions(workspaceFolder, head, allowCompile);
        return result ? toChangedActionsView(result) : { status: 'idle' };
    } catch (error: any) {
        logger.error(`Failed to work out changed actions: ${error.message}`);
        return { status: 'error', error: error.message };
    }
}

/** Explains an empty result; on the default branch itself there is nothing to compare unless files were edited. */
export function noChangesMessage(result: Pick<ChangedActionsResult, 'baseRef' | 'headRef' | 'defaultBranch' | 'onDefaultBranch'>): string {
    return result.onDefaultBranch
        ? `You're on ${result.defaultBranch}, the branch Run Changed compares against, so there is nothing to compare. Switch to a feature branch, or edit files.`
        : `No changed actions ${describeComparison(result.headRef, result.baseRef)}`;
}

/**
 * Compiles the project and works out the changed actions, reporting failures to the user. Shows progress
 * straight away, since a compile of changed files or of a new base can take seconds before anything runs.
 */
export async function prepareChangedActions(workspaceFolder: string): Promise<ChangedActionsResult | undefined> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Working out changed actions…' },
        async () => {
            const { dataformCompiledJson, errors } = await runCompilation(workspaceFolder);
            if (!dataformCompiledJson) {
                vscode.window.showErrorMessage(`Dataform execution aborted: compilation failed. ${errors?.[0]?.error ?? ''}`.trim());
                return undefined;
            }
            try {
                return await computeChangedActions(workspaceFolder, dataformCompiledJson, true);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Could not work out changed actions: ${error.message}`);
                return undefined;
            }
        },
    );
}

export interface ChangedFileSelection {
    actions: ChangedAction[];
    /** A rerun must keep to the same files: some changed file was left out, or the files came from such a run */
    scoped: boolean;
    /** How many files have changed actions */
    changedFileCount: number;
    /** How many of those files are in `files`; equals `changedFileCount` when no files were given */
    selectedFileCount: number;
}

/**
 * The changed actions in `files` (keyed by `changedFileKey`), or all of them when `files` is undefined.
 * `replayed` marks files recorded by a run that left some out: they stay the scope even when every file
 * with changes right now is among them, so a file left out that changes again later still does not run.
 */
export function selectChangedFiles(changed: ChangedAction[], files: string[] | undefined, replayed = false): ChangedFileSelection {
    const changedFiles = new Set(changed.map((action) => changedFileKey(action.fileName)));
    if (!files) {
        return { actions: changed, scoped: false, changedFileCount: changedFiles.size, selectedFileCount: changedFiles.size };
    }
    const selected = new Set(files);
    const selectedChangedFiles = [...changedFiles].filter((file) => selected.has(file));
    return {
        actions: changed.filter((action) => selected.has(changedFileKey(action.fileName))),
        scoped: replayed || selectedChangedFiles.length < changedFiles.size,
        changedFileCount: changedFiles.size,
        selectedFileCount: selectedChangedFiles.length,
    };
}

/**
 * Runs the changed actions of `result`, or says there are none. With `files`, only the changes in those
 * files run; files that became changed since they were picked are left out, so nothing runs unseen.
 * `replayed` is set when `files` come from the last run, see `selectChangedFiles`.
 */
export async function dispatchChangedActions(
    context: vscode.ExtensionContext,
    workspaceFolder: string,
    result: ChangedActionsResult,
    includeDependencies: boolean,
    includeDependents: boolean,
    fullRefresh: boolean,
    executionMode: ExecutionMode,
    files?: string[],
    replayed = false,
): Promise<void> {
    if (result.changed.length === 0) {
        vscode.window.showInformationMessage(noChangesMessage(result));
        return;
    }
    const { actions, scoped, changedFileCount, selectedFileCount } = selectChangedFiles(result.changed, files, replayed);
    if (actions.length === 0) {
        vscode.window.showInformationMessage(`None of the selected files still have changes ${describeComparison(result.headRef, result.baseRef)}, so nothing was run.`);
        return;
    }
    const lastRunRequest: Omit<LastRunRequest, 'timestamp'> = {
        kind: 'changed',
        items: actions.map((action) => action.target),
        ...(scoped && files ? { files, changedFileCount, selectedFileCount } : {}),
        baseRef: result.baseRef,
        headRef: result.headRef,
        includeDependencies,
        includeDependents,
        fullRefresh,
        executionMode,
        workspaceFolder,
    };
    await runIncludedTargets(context, workspaceFolder, actions.map((action) => action.targetObj), includeDependencies, includeDependents, fullRefresh, executionMode, lastRunRequest);
}

/**
 * Compiles the project, works out the changed actions and runs them (only those in `files` when given).
 * Returns the result so the caller can refresh its view, or undefined when it could not be worked out.
 */
export async function runChangedActions(
    context: vscode.ExtensionContext,
    workspaceFolder: string,
    includeDependencies: boolean,
    includeDependents: boolean,
    fullRefresh: boolean,
    executionMode: ExecutionMode,
    files?: string[],
    replayed = false,
): Promise<ChangedActionsResult | undefined> {
    const result = await prepareChangedActions(workspaceFolder);
    if (result) {
        await dispatchChangedActions(context, workspaceFolder, result, includeDependencies, includeDependents, fullRefresh, executionMode, files, replayed);
    }
    return result;
}
