import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { DbtCompileResult, DbtOptions } from '../backend/dbt';
import { logger } from '../logger';
import type { CompileState } from '../panel/slices';
import { actionsInFile, homeAction, isTestKind, siblingsOf } from '../shared/compiledGraph';
import { dbtTool } from './dbtTool';
import type { ProjectState } from './registry';

/*
 * The compile loop of a dbt Project (ADR 0003). The panel asks for a compile when it is first opened, when a file is
 * saved and when another file is shown; this decides whether one is needed and runs it.
 *
 * - One compile per Project at a time, and the latest request wins: a newer one ends the dbt that is running.
 * - A save always compiles, and only the saved file's actions, so showing a file whose actions have no compiled SQL
 *   compiles again, for that file.
 * - A test file's compile is followed by a second one, of the models its tests are shown with, so that those and
 *   their other tests have compiled SQL too (`completeDbtCompile`). The test is on show after the first.
 * - dbt writes its artifacts and logs under the extension's storage for the workspace, one directory per Project,
 *   dbt binary and dbt target, never into the Project's own `target/`.
 */

/** Why a compile is asked for */
export type CompileReason = 'open' | 'save' | 'switch';

const ARTIFACTS = 'dbt';
const LAST_USED = 'last-used';
const UNUSED_DAYS = 30;

let storageRoot: string | undefined;
/** Where the dbt target chosen in the panel is kept: private to this workspace on this machine, never in a settings file */
let workspaceState: vscode.Memento | undefined;
const TARGET_OVERRIDES = 'dbtTargetOverrides';
const states = new Map<string, CompileState>();
/** By Project: what the last compile was run with. Another dbt, dbt target or variables make its result another Project's, in effect */
const compiledWith = new Map<string, string>();
const optionsKey = ({ binary, flavour, target, vars, profilesDir, compileWithHooks }: DbtOptions) => JSON.stringify([binary, flavour, target, vars, profilesDir, compileWithHooks]);
const running = new Map<string, AbortController>();
/** By Project: the files its last second compile was for, until its next first one. They are not compiled twice for one result */
const completedFor = new Map<string, string>();
const changed = new vscode.EventEmitter<string>();
/** Fires with a Project's root when how its compile stands changes: started, finished, or failed */
export const onDidChangeDbtCompile = changed.event;

/** How the Project's compile stands, for the panel's compile status. Before any compile: in a Project, nothing compiled */
export function dbtCompileState(root: string): CompileState {
    return states.get(root) ?? { inProject: true, errors: [] };
}

function setState(root: string, state: CompileState) {
    states.set(root, state);
    changed.fire(root);
}

function setting<T>(root: string, key: string): T | undefined {
    return vscode.workspace.getConfiguration('vscode-dataform-tools', vscode.Uri.file(root)).get<T>(key) ?? undefined;
}

/**
 * Where dbt writes for this Project, binary and dbt target. The binary is its path with symbolic links followed, so
 * that dbt-core and dbt v2 never share partial-parse state, and an upgrade that repoints a link starts afresh.
 */
function artifactDir(root: string, binary: string, target: string | undefined): string {
    let real = binary;
    try {
        real = fs.realpathSync(binary);
    } catch {
        // As given
    }
    const name = createHash('sha256').update(`${root}\n${real}\n${target ?? ''}`).digest('hex').slice(0, 12);
    return path.join(storageRoot!, ARTIFACTS, name);
}

/** The dbt target chosen in the panel for the Project, which overrides the `dbtTarget` setting (xf#50). Undefined when none is */
export function dbtTargetOverride(root: string): string | undefined {
    return workspaceState?.get<Record<string, string>>(TARGET_OVERRIDES)?.[root] || undefined;
}

/** Chooses a dbt target for the Project in this workspace; null goes back to the `dbtTarget` setting */
export async function setDbtTargetOverride(root: string, name: string | null): Promise<void> {
    const overrides = { ...(workspaceState?.get<Record<string, string>>(TARGET_OVERRIDES) ?? {}) };
    if (name === null || name.trim() === '') {
        delete overrides[root];
    } else {
        overrides[root] = name.trim();
    }
    await workspaceState?.update(TARGET_OVERRIDES, overrides);
}

/**
 * How the Project is compiled and run, from the settings and the panel's choice of dbt target. Each is unset when
 * nothing names it. `settingTarget` is the team's default, which `target` is unless the panel overrides it.
 */
export function dbtSettings(root: string): { target?: string; settingTarget?: string; overridden: boolean; vars?: string; profilesDir?: string; compileWithHooks: boolean } {
    const settingTarget = setting<string>(root, 'dbtTarget') || undefined;
    const override = dbtTargetOverride(root);
    return {
        target: override ?? settingTarget,
        settingTarget,
        overridden: override !== undefined,
        vars: setting<string>(root, 'dbtVars') || undefined,
        profilesDir: setting<string>(root, 'dbtProfilesDir') || undefined,
        compileWithHooks: setting<boolean>(root, 'dbtCompileWithHooks') === true,
    };
}

/** The options of a compile or a run of the Project, from the settings and the dbt that was found. Undefined when there is no usable dbt */
export async function dbtOptions(root: string): Promise<DbtOptions | undefined> {
    const tool = await dbtTool(root);
    if (tool.status !== 'found' || !storageRoot) {
        return undefined;
    }
    const { target, vars, profilesDir, compileWithHooks } = dbtSettings(root);
    return {
        binary: tool.path,
        flavour: tool.probe.flavour,
        label: tool.probe.label,
        target,
        vars,
        profilesDir,
        compileWithHooks,
        artifactDir: artifactDir(root, tool.path, target),
    };
}

/**
 * Whether showing `file` needs a compile: there is no result yet, the last one was made with other options (another
 * dbt, dbt target or variables), or an action of the file has a query that the last compile did not compile. The
 * tests shown with the file's actions count as the file's. A Project that was only parsed, for its on-run hooks or
 * its errors, is not compiled for a showing: nothing but a save changes what a compile of it gives.
 */
function needsCompile(project: ProjectState, file: string | undefined, options: DbtOptions): boolean {
    const last = project.dbtBackend?.lastResult;
    if (!last || compiledWith.get(project.root) !== optionsKey(options)) {
        return true;
    }
    if (last.parsedOnly || !file) {
        return false;
    }
    // The file's actions, and the tests of those: dbt compiles a model's tests with it. Not what a test of the
    // file is shown with, its model and that model's other tests: selecting the test's file does not compile those.
    // They are for the second compile, see `completeDbtCompile`
    const own = actionsInFile(last.graph, file);
    const wanted = new Set(own);
    for (const action of own.filter((candidate) => !isTestKind(candidate.kind))) {
        siblingsOf(last.graph, action).filter((sibling) => isTestKind(sibling.kind)).forEach((test) => wanted.add(test));
    }
    return [...wanted].some((action) => !action.sqlPresent);
}

/**
 * The files a second compile is wanted for, after the one of `file`: those of the models the file's tests are shown
 * with, where such a model or one of its other tests has no compiled SQL. Empty when the last compile was only a
 * parse or left errors (the second would only meet them again), and when these files have been compiled for this
 * result already.
 */
function filesToComplete(project: ProjectState, file: string, options: DbtOptions): string[] {
    const { root } = project;
    const last = project.dbtBackend?.lastResult;
    const state = dbtCompileState(root);
    if (!last || last.parsedOnly || !state.compiled || state.errors.length > 0 || compiledWith.get(root) !== optionsKey(options)) {
        return [];
    }
    const files = new Set<string>();
    for (const test of actionsInFile(last.graph, file).filter((action) => isTestKind(action.kind))) {
        const home = homeAction(last.graph, test);
        if (home?.fileName && home.fileName !== file && siblingsOf(last.graph, home).some((sibling) => !sibling.sqlPresent)) {
            files.add(home.fileName);
        }
    }
    const wanted = [...files].sort();
    return completedFor.get(root) === wanted.join('\n') ? [] : wanted;
}

/**
 * The second compile of a test file (ADR 0003): the models the file's tests are shown with, which brings those
 * models' other tests, so that every action on show has compiled SQL to dry-run. It is asked for after
 * `compileDbtProject` has resolved for the file, and does nothing when no such model lacks SQL. Meanwhile the first
 * result stays on show, and `dbtCompileState` says `completing`; a newer compile ends it.
 *
 * Resolves to true when its result replaced the first one. A second compile that failed, or lost the file's own
 * SQL, leaves the first result in place, and its errors are reported as those of the models' files. It never rejects.
 */
export async function completeDbtCompile(project: ProjectState, file: string): Promise<boolean> {
    const { root, dbtBackend } = project;
    if (!dbtBackend || running.has(root)) {
        return false;
    }
    const options = await dbtOptions(root);
    // A compile asked for meanwhile is followed by its own
    if (!options || running.has(root)) {
        return false;
    }
    const files = filesToComplete(project, file, options);
    const first = dbtBackend.lastResult;
    if (files.length === 0 || !first) {
        return false;
    }
    const controller = new AbortController();
    running.set(root, controller);
    const isLatest = () => running.get(root) === controller;
    const { completing: _before, ...settled } = dbtCompileState(root);
    const completing = { startedAt: Date.now(), files };
    setState(root, { ...settled, completing });
    /** An error that names no file is one of the compile of these files, not of the file on show */
    const elsewhere = (errors: DbtCompileResult['errors']) => errors.map((error) => (error.fileName ? error : { ...error, fileName: files[0] }));
    try {
        const result = await dbtBackend.compile({ root, file, withFiles: files, options, logger, signal: controller.signal });
        if (!isLatest()) {
            dbtBackend.keep(first);
            return false;
        }
        completedFor.set(root, files.join('\n'));
        logger.info(`dbt: ${result.commands.map((args) => args[0]).join(', then ')} of ${root} for ${files.join(', ')} took ${Date.now() - completing.startedAt} ms, ${result.errors.length} error(s)`);
        const own = actionsInFile(result.graph, file);
        if (result.parsedOnly || own.length === 0 || own.some((action) => !action.sqlPresent)) {
            dbtBackend.keep(first);
            setState(root, { ...settled, errors: elsewhere(result.errors) });
            return false;
        }
        project.compileNumber++;
        // The time of the compile stays the first one's: that is when the file on show was compiled
        setState(root, { ...settled, errors: elsewhere(result.errors) });
        return true;
    } catch (error) {
        if (!isLatest() || controller.signal.aborted) {
            return false;
        }
        completedFor.set(root, files.join('\n'));
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`dbt: the compile of ${files.join(', ')} of ${root} failed: ${message}`);
        setState(root, { ...settled, errors: [{ message, fileName: files[0] }] });
        return false;
    } finally {
        if (isLatest()) {
            running.delete(root);
        }
        // Replaced by a compile that was not needed: nothing else says that this one has ended
        if (states.get(root)?.completing === completing) {
            setState(root, { ...states.get(root)!, completing: undefined });
        }
    }
}

/**
 * Compiles the Project for `file` (relative to its root, with forward slashes) if `reason` calls for it. Resolves when
 * the compile has ended, or at once when none was needed or it was replaced by a newer request. It never rejects:
 * how it went is in `dbtCompileState`, and the result in the Project's Backend.
 */
export async function compileDbtProject(project: ProjectState, file: string | undefined, reason: CompileReason): Promise<void> {
    const { root, dbtBackend } = project;
    if (!dbtBackend) {
        return;
    }
    // Before anything is awaited, so that of two requests in a row the first is the one that gives way
    running.get(root)?.abort(new Error('Replaced by a newer compile'));
    const controller = new AbortController();
    running.set(root, controller);
    const isLatest = () => running.get(root) === controller;
    try {
        await compileIfNeeded(project, dbtBackend, file, reason, controller, isLatest);
    } finally {
        if (isLatest()) {
            running.delete(root);
        }
    }
}

/** Whether a compile of the Project has been asked for and has not ended */
export function dbtCompilePending(root: string): boolean {
    return running.has(root);
}

async function compileIfNeeded(project: ProjectState, dbtBackend: NonNullable<ProjectState['dbtBackend']>, file: string | undefined, reason: CompileReason, controller: AbortController, isLatest: () => boolean): Promise<void> {
    const { root } = project;
    const previous = dbtCompileState(root);

    const tool = await dbtTool(root);
    if (!isLatest()) {
        return;
    }
    if (tool.status === 'missing') {
        setState(root, { inProject: true, errors: [], missingTool: { tool: 'dbt', lookedIn: tool.looked } });
        return;
    }
    if (tool.status === 'unusable') {
        project.compileNumber++;
        setState(root, { inProject: true, errors: [{ message: `${tool.reason}\n\ndbt was found by ${tool.foundBy}, at ${tool.path}.` }] });
        return;
    }
    if (tool.status === 'found' && tool.probe.unsupported) {
        setState(root, { inProject: true, errors: [], unsupportedVersion: { tool: 'dbt', version: tool.probe.version, message: tool.probe.unsupported } });
        return;
    }
    const options = await dbtOptions(root);
    if (!options || !isLatest()) {
        return;
    }
    if (reason !== 'save' && !needsCompile(project, file, options)) {
        // What a tool that has since been found or fixed left behind is no longer true
        if (previous.missingTool || previous.unsupportedVersion) {
            setState(root, { ...previous, missingTool: undefined, unsupportedVersion: undefined });
        }
        return;
    }

    const startedAt = Date.now();
    completedFor.delete(root);
    setState(root, { inProject: true, errors: previous.errors, compiled: previous.compiled, compiling: { showingPrevious: !!dbtBackend.lastResult, startedAt, file } });
    try {
        await fs.promises.mkdir(options.artifactDir, { recursive: true });
        await fs.promises.writeFile(path.join(options.artifactDir, LAST_USED), new Date(startedAt).toISOString());
        const result: DbtCompileResult = await dbtBackend.compile({ root, file, options, logger, signal: controller.signal });
        if (!isLatest()) {
            return;
        }
        project.compileNumber++;
        compiledWith.set(root, optionsKey(options));
        logger.info(`dbt: ${result.commands.map((args) => args[0]).join(', then ')} of ${root} took ${Date.now() - startedAt} ms, ${result.errors.length} error(s)`);
        setState(root, {
            inProject: true,
            errors: result.errors,
            compiled: { compiledAt: Date.now(), durationMs: Date.now() - startedAt, ...(result.notice ? { notice: result.notice } : {}) },
        });
    } catch (error) {
        if (!isLatest() || controller.signal.aborted) {
            return;
        }
        // No graph at all: the last result is not shown as this compile's
        dbtBackend.forget();
        project.compileNumber++;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`dbt: the compile of ${root} failed: ${message}`);
        setState(root, { inProject: true, errors: [{ message }] });
    }
}

/** Deletes the artifact directories that no compile has used for 30 days */
async function pruneArtifacts() {
    if (!storageRoot) {
        return;
    }
    const base = path.join(storageRoot, ARTIFACTS);
    const names = await fs.promises.readdir(base).catch(() => [] as string[]);
    for (const name of names) {
        const directory = path.join(base, name);
        const used = await fs.promises.stat(path.join(directory, LAST_USED)).catch(() => fs.promises.stat(directory).catch(() => undefined));
        if (used && Date.now() - used.mtimeMs > UNUSED_DAYS * 24 * 60 * 60 * 1000) {
            logger.info(`dbt: deleting artifacts unused for ${UNUSED_DAYS} days: ${directory}`);
            await fs.promises.rm(directory, { recursive: true, force: true }).catch((error) => logger.error(`dbt: could not delete ${directory}: ${error}`));
        }
    }
}

/** Deletes every artifact directory of this workspace: what `clearExtensionCache` does for dbt. The next compile starts from nothing */
export async function clearDbtArtifacts() {
    if (storageRoot) {
        await fs.promises.rm(path.join(storageRoot, ARTIFACTS), { recursive: true, force: true });
    }
}

export function initDbtCompile(context: vscode.ExtensionContext) {
    // The workspace's own storage; a window with a single file open has none
    storageRoot = (context.storageUri ?? context.globalStorageUri).fsPath;
    workspaceState = context.workspaceState;
    context.subscriptions.push(changed);
    pruneArtifacts().catch((error) => logger.error(`dbt: could not prune artifacts: ${error}`));
}
