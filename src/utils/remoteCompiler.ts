import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { load as loadYaml } from 'js-yaml';
import type { DataformTools } from "@ashishalex/dataform-tools";
import { loadDataformTools } from "../lazySdk";
import { GitService } from '../gitClient';
import { logger } from '../logger';
import { CodeCompilationConfig, DataformCompiledJson, ExecutionMode, GraphError } from '../types';
import { getCachedDataformRepositoryLocation } from './gcpUtils';
import { toDataformCompiledJson, ApiCompilationResult, ApiCompilationResultAction } from './remoteCompileAdapter';
import { DEFAULT_CONFIG_KEY, getRemoteCompile, initRemoteCompileCache, saveRemoteCompile, RemoteCompileEntry } from './remoteCompileCache';
import { initRemoteModeStatusBar, refreshRemoteModeStatusBar, updateRemoteModeStatusBar } from './remoteModeStatusBar';
import { createCompilerOptionsObjectForApi } from './dataformCompiler';
import { clearCompiled, currentDataformRoot, setCompiled } from '../project';
import { setCompilationInfo } from './compilationInfo';
import type { DataformOptions } from '../backend/dataform/options';
import type { CompilationMode } from '../project/tools';
import { initDataformOptions, getSelectedReleaseConfig, isCompilationModeExplicitlySet, isRemoteMode, resolveDataformOptions, setCompilationMode, setSelectedReleaseConfig } from '../project/dataformOptions';

/*
 * Remote mode (beta): compiles the pushed commit of the current branch with the Dataform API
 * instead of the local Dataform CLI, and serves the result from a cache keyed by commit SHA.
 *
 * What a compile depends on arrives as `DataformOptions`; the commands at the end of the file are the host's and
 * resolve them (src/project/dataformOptions.ts).
 */

const REMOTE_COMPILE_CANCELLED = "Remote compilation cancelled";

let extensionContext: vscode.ExtensionContext | undefined;
let inFlightCompile: Promise<RemoteCompileOutcome> | undefined;
let inFlightCompileSha: string | undefined;
let onRemoteCompileCompleted: (() => Promise<void> | void) | undefined;

/** Called after an explicit remote compile so open views can redraw from the new result. */
export function setOnRemoteCompileCompleted(callback: () => Promise<void> | void) {
    onRemoteCompileCompleted = callback;
}

export type RemoteCompileOutcome = {
    dataformCompiledJson: DataformCompiledJson | undefined;
    errors: GraphError[] | undefined;
    compilationTimeMs: number | undefined;
};

async function switchCompilationBackend(value?: CompilationMode) {
    if (!value) {
        const current: CompilationMode = isRemoteMode() ? "api" : "cli";
        const items: (vscode.QuickPickItem & { value: CompilationMode })[] = [
            { label: "$(terminal) CLI", description: current === "cli" ? "current" : undefined, detail: "Compile locally with the Dataform CLI", value: "cli" },
            { label: "$(cloud) Dataform API (beta)", description: current === "api" ? "current" : undefined, detail: "Compile the pushed commit of the current branch with the Dataform API; no CLI needed", value: "api" },
        ];
        value = (await vscode.window.showQuickPick(items, { placeHolder: "Compile the Dataform project with" }))?.value;
    }
    if (value) {
        await setCompilationMode(value);
    }
}

function syncRemoteModeContext() {
    const remote = isRemoteMode();
    vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.remoteMode', remote);
    refreshRemoteModeStatusBar(remote, isCompilationModeExplicitlySet());
}

export function initRemoteCompiler(context: vscode.ExtensionContext) {
    extensionContext = context;
    initDataformOptions(context);
    initRemoteCompileCache(context);
    initRemoteModeStatusBar(context);
    syncRemoteModeContext();

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.compilationBackend')) {
                syncRemoteModeContext();
                // Force the next compile to go through the newly selected backend
                clearCompiled();
            }
        }),
        vscode.commands.registerCommand('vscode-dataform-tools.compileRemotely', async () => {
            await compileRemotelyAndReport();
        }),
        vscode.commands.registerCommand('vscode-dataform-tools.remoteModeActions', remoteModeActions),
        vscode.commands.registerCommand('vscode-dataform-tools.switchCompilationBackend', switchCompilationBackend),
    );
}

function getContext(): vscode.ExtensionContext {
    if (!extensionContext) {
        throw new Error("Remote compiler used before initialisation");
    }
    return extensionContext;
}

function readDefaultProjectFromSettings(workspaceFolder: string): string | undefined {
    try {
        const workflowSettingsPath = path.join(workspaceFolder, "workflow_settings.yaml");
        if (fs.existsSync(workflowSettingsPath)) {
            const settings = loadYaml(fs.readFileSync(workflowSettingsPath, "utf8")) as { defaultProject?: string } | undefined;
            return settings?.defaultProject;
        }
        const dataformJsonPath = path.join(workspaceFolder, "dataform.json");
        if (fs.existsSync(dataformJsonPath)) {
            return JSON.parse(fs.readFileSync(dataformJsonPath, "utf8"))?.defaultDatabase;
        }
    } catch (error) {
        logger.error(`Failed to read default project from Dataform settings: ${error}`);
    }
    return undefined;
}

async function getGitInfo(): Promise<{ git: GitService, branch: string, repositoryName: string }> {
    const git = new GitService();
    const gitInfo = await git.getGitBranchAndRepoName();
    if (!gitInfo?.gitBranch || !gitInfo.gitRepoName) {
        throw new Error("Unable to determine the git branch and Dataform repository name");
    }
    return { git, branch: gitInfo.gitBranch, repositoryName: gitInfo.gitRepoName };
}

async function createDataformClient(workspaceFolder: string, options: DataformOptions, repositoryName: string): Promise<DataformTools> {
    const projectId = options.api.gcpProjectId
        || readDefaultProjectFromSettings(workspaceFolder);
    if (!projectId) {
        throw new Error("Unable to determine the GCP project. Set `vscode-dataform-tools.gcpProjectId` or `defaultProject` in workflow_settings.yaml");
    }
    const location = await getCachedDataformRepositoryLocation(getContext(), repositoryName);
    if (!location) {
        throw new Error("Location of the Dataform repository not provided");
    }
    const serviceAccountJsonPath = options.api.serviceAccountJsonPath;
    const clientOptions = serviceAccountJsonPath ? { projectId, keyFilename: serviceAccountJsonPath } : { projectId };
    return new (await loadDataformTools())(projectId, location, clientOptions);
}

/** Dataform client for the repository named after the current git repository. */
export async function createDataformClientForCurrentRepository(): Promise<{ dataformClient: DataformTools, repositoryName: string }> {
    const workspaceFolder = currentDataformRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        throw new Error("No workspace folder open");
    }
    const { repositoryName } = await getGitInfo();
    return { dataformClient: await createDataformClient(workspaceFolder, resolveDataformOptions(workspaceFolder), repositoryName), repositoryName };
}

/**
 * Remote compilation only sees pushed commits. Warns when the local branch differs from its upstream
 * and offers to push. Returns false when the user cancels.
 */
export async function confirmRemoteMatchesLocal(git: GitService, branch: string): Promise<boolean> {
    const aheadBehind = await git.getAheadBehind();
    const dirty = await git.isDirty();

    if (!aheadBehind) {
        const choice = await vscode.window.showWarningMessage(
            `Branch "${branch}" has no upstream. Remote mode compiles pushed commits only.`,
            { modal: true },
            "Push & compile"
        );
        if (choice !== "Push & compile") {
            return false;
        }
        await git.pushBranch(branch);
        return true;
    }

    const problems: string[] = [];
    if (aheadBehind.ahead > 0) {
        problems.push(`${aheadBehind.ahead} unpushed commit(s)`);
    }
    if (dirty) {
        problems.push("uncommitted changes");
    }
    if (problems.length === 0) {
        return true;
    }

    const actions = aheadBehind.ahead > 0 ? ["Push & compile", "Compile remote anyway"] : ["Compile remote anyway"];
    const choice = await vscode.window.showWarningMessage(
        `Local branch "${branch}" has ${problems.join(" and ")}, which remote compilation will not include.`,
        { modal: true },
        ...actions
    );
    if (choice === "Push & compile") {
        await git.pushBranch(branch);
        return true;
    }
    return choice === "Compile remote anyway";
}

/** In remote mode, runs that would shell out to `dataform run` go through the Dataform API instead. */
export function resolveExecutionMode(executionMode: ExecutionMode): ExecutionMode {
    return executionMode === "cli" && isRemoteMode() ? "api" : executionMode;
}

/** Before an API run in remote mode, confirms the pushed commit is what the user means to run. */
export async function confirmRemoteRun(): Promise<boolean> {
    if (!isRemoteMode()) {
        return true;
    }
    const { git, branch } = await getGitInfo();
    return confirmRemoteMatchesLocal(git, branch);
}

function outcomeFromEntry(entry: RemoteCompileEntry): RemoteCompileOutcome {
    const graphErrors = entry.compiledJson.graphErrors?.compilationErrors ?? [];
    if (graphErrors.length > 0) {
        return {
            dataformCompiledJson: undefined,
            errors: graphErrors.map((e) => ({ error: e.message, fileName: e.fileName, stack: e.stack })),
            compilationTimeMs: undefined,
        };
    }
    return { dataformCompiledJson: entry.compiledJson, errors: undefined, compilationTimeMs: undefined };
}

async function describeStaleness(git: GitService, entry: RemoteCompileEntry): Promise<string | undefined> {
    const headSha = await git.getHeadSha();
    if (headSha && headSha !== entry.sha) {
        return "Local HEAD differs from the compiled commit.";
    }
    if (await git.isDirty()) {
        return "Uncommitted local changes are not included.";
    }
    return undefined;
}

async function reportEntry(git: GitService, entry: RemoteCompileEntry, durationMs?: number) {
    const reason = await describeStaleness(git, entry);
    const hasErrors = (entry.compiledJson.graphErrors?.compilationErrors?.length ?? 0) > 0;
    updateRemoteModeStatusBar({ state: "compiled", sha: entry.sha, stale: !!reason, reason, hasErrors });
    setCompilationInfo({
        mode: "api",
        compiledAt: entry.compiledAt,
        durationMs,
        fromCache: durationMs === undefined,
        sha: entry.sha,
        stale: !!reason,
        staleReason: reason,
        releaseConfig: entry.configKey === DEFAULT_CONFIG_KEY ? undefined : entry.configKey.split("/").pop(),
        hasErrors,
    });
}

const GIT_REMOTE_ATTEMPTS = 3;
const GIT_REMOTE_RETRY_DELAY_MS = 1000;

/**
 * Dataform fetches the commit from the connected git remote on every compilation. When that fetch
 * times out (seen intermittently with self-hosted git servers) the API fails with INVALID_ARGUMENT
 * "Error during remote operation: `Connection time out`" / "`Read timed out`"; a retry usually succeeds.
 */
export function isTransientGitRemoteError(error: { code?: number, details?: string, message?: string }): boolean {
    const text = `${error.details ?? ""} ${error.message ?? ""}`;
    if (error.code === 4 || error.code === 14) {
        return true; // DEADLINE_EXCEEDED, UNAVAILABLE
    }
    return error.code === 3 && /error during remote operation/i.test(text) && /time[sd]? ?out/i.test(text);
}

async function createCompilationResultWithRetry<T>(create: () => Promise<T>, report: (message: string) => void): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        report(attempt === 1 ? "Creating compilation result…" : `Git remote timed out, retrying (${attempt}/${GIT_REMOTE_ATTEMPTS})…`);
        try {
            return await create();
        } catch (error: any) {
            if (!isTransientGitRemoteError(error)) {
                throw error;
            }
            logger.info(`Remote compilation attempt ${attempt} failed with a git remote timeout: ${error.details ?? error.message}`);
            if (attempt >= GIT_REMOTE_ATTEMPTS) {
                throw new Error(`Dataform could not fetch the branch from your git remote after ${GIT_REMOTE_ATTEMPTS} attempts (${error.details ?? error.message}). This is a connection problem between Dataform and your git server; try again shortly.`);
            }
            await new Promise((resolve) => setTimeout(resolve, GIT_REMOTE_RETRY_DELAY_MS * attempt));
        }
    }
}

/**
 * Compiles `gitCommitish` with the Dataform API using `configOverride` when given, else the settings of
 * `releaseConfig`, else `compilerOptions`.
 */
async function createRemoteCompileEntry(
    dataformClient: DataformTools,
    repositoryName: string,
    gitCommitish: string,
    releaseConfig: string | undefined,
    compilerOptions: string,
    report: (message: string) => void,
    configOverride?: CodeCompilationConfig,
): Promise<RemoteCompileEntry> {
    let codeCompilationConfig: CodeCompilationConfig = configOverride ?? createCompilerOptionsObjectForApi([compilerOptions]);
    if (releaseConfig && !configOverride) {
        report("Reading release config…");
        const [config] = await dataformClient.client.getReleaseConfig({ name: releaseConfig });
        codeCompilationConfig = (config.codeCompilationConfig ?? {}) as typeof codeCompilationConfig;
    }

    const result = await createCompilationResultWithRetry(
        () => dataformClient.createCompilationResult(repositoryName, codeCompilationConfig, undefined, gitCommitish),
        report,
    );
    let actions: ApiCompilationResultAction[] = [];
    if (result.name) {
        report("Fetching compiled actions…");
        actions = await dataformClient.queryCompilationResultActions(result.name) as ApiCompilationResultAction[];
    }

    return {
        repositoryName,
        sha: result.resolvedGitCommitSha ?? "unknown",
        configKey: releaseConfig ?? DEFAULT_CONFIG_KEY,
        compiledAt: Date.now(),
        compiledJson: toDataformCompiledJson(result as ApiCompilationResult, actions),
    };
}

/**
 * Compiled JSON of another pushed commit, such as the merge-base with the default branch, using the same
 * compilation settings as the current branch. Cached by SHA (and `cacheTag`, when given), but never
 * replaces the current compilation. With `cachedOnly`, returns undefined instead of calling the API
 * when the commit is not cached.
 */
export async function compileRemoteCommit(workspaceFolder: string, options: DataformOptions, sha: string, cachedOnly = false, cacheTag?: string): Promise<DataformCompiledJson | undefined> {
    const { repositoryName } = await getGitInfo();
    const releaseConfig = options.api.releaseConfig;
    const cacheKey = `${releaseConfig ?? DEFAULT_CONFIG_KEY}${cacheTag ? `@${cacheTag}` : ""}`;
    let entry = await getRemoteCompile(repositoryName, sha, cacheKey, false);
    if (!entry && cachedOnly) {
        return undefined;
    }
    if (!entry) {
        const dataformClient = await createDataformClient(workspaceFolder, options, repositoryName);
        entry = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Compiling ${sha.slice(0, 7)} with the Dataform API` },
            (progress) => createRemoteCompileEntry(dataformClient, repositoryName, sha, releaseConfig, options.compilerOptions, (message) => progress.report({ message })),
        );
        entry = { ...entry, configKey: cacheKey };
        await saveRemoteCompile(entry, false);
    }
    const graphErrors = entry.compiledJson.graphErrors?.compilationErrors ?? [];
    if (graphErrors.length > 0) {
        throw new Error(`${graphErrors[0].fileName ? `${graphErrors[0].fileName}: ` : ""}${graphErrors[0].message}`);
    }
    return entry.compiledJson;
}

function notPushedMessage(branch: string): string {
    return `Branch "${branch}" is not pushed or has no upstream branch set. API mode compiles the pushed commit, so push the branch (git push -u origin ${branch}) or switch to the Dataform CLI to compile your local changes.`;
}

/**
 * Compiled JSON of the pushed commit of the current branch with explicit compilation settings, such as the
 * prod options of defer to prod. Cached by SHA and `cacheTag`, but never replaces the current compilation.
 */
export async function compileRemoteHeadWithConfig(workspaceFolder: string, options: DataformOptions, codeCompilationConfig: CodeCompilationConfig, cacheTag: string): Promise<DataformCompiledJson> {
    const { git, branch, repositoryName } = await getGitInfo();
    const upstreamSha = await git.getUpstreamSha();
    if (!upstreamSha) {
        throw new Error(notPushedMessage(branch));
    }
    const cacheKey = `${DEFAULT_CONFIG_KEY}@${cacheTag}`;
    let entry = await getRemoteCompile(repositoryName, upstreamSha, cacheKey, false);
    if (!entry) {
        const dataformClient = await createDataformClient(workspaceFolder, options, repositoryName);
        entry = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: `Compiling ${upstreamSha.slice(0, 7)} with prod options` },
            (progress) => createRemoteCompileEntry(dataformClient, repositoryName, upstreamSha, undefined, options.compilerOptions, (message) => progress.report({ message }), codeCompilationConfig),
        );
        entry = { ...entry, configKey: cacheKey };
        await saveRemoteCompile(entry, false);
    }
    const graphErrors = entry.compiledJson.graphErrors?.compilationErrors ?? [];
    if (graphErrors.length > 0) {
        throw new Error(`${graphErrors[0].fileName ? `${graphErrors[0].fileName}: ` : ""}${graphErrors[0].message}`);
    }
    return entry.compiledJson;
}

async function compileRemotely(workspaceFolder: string, options: DataformOptions, interactive: boolean): Promise<RemoteCompileOutcome> {
    const { git, branch, repositoryName } = await getGitInfo();
    if (interactive) {
        if (!(await confirmRemoteMatchesLocal(git, branch))) {
            return { dataformCompiledJson: undefined, errors: [{ error: REMOTE_COMPILE_CANCELLED, fileName: "" }], compilationTimeMs: undefined };
        }
    } else if (!(await git.getUpstreamSha())) {
        // Compiles triggered by saves never prompt; divergence is surfaced in the status bar instead
        throw new Error(notPushedMessage(branch));
    }

    const dataformClient = await createDataformClient(workspaceFolder, options, repositoryName);
    // Resolved before the compile, so a config switch mid-compile cannot file this result under the other config
    const releaseConfig = options.api.releaseConfig;

    updateRemoteModeStatusBar({ state: "compiling" });
    const startTime = performance.now();
    try {
        return await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `Compiling ${branch} with the Dataform API` },
            async (progress) => {
                const entry = await createRemoteCompileEntry(dataformClient, repositoryName, branch, releaseConfig, options.compilerOptions, (message) => progress.report({ message }));
                await saveRemoteCompile(entry);
                const compilationTimeMs = performance.now() - startTime;
                await reportEntry(git, entry, compilationTimeMs);
                logger.info(`Remote compilation of ${branch} @ ${entry.sha} returned ${entry.compiledJson.targets.length} actions`);

                return { ...outcomeFromEntry(entry), compilationTimeMs };
            }
        );
    } catch (error: any) {
        updateRemoteModeStatusBar({ state: "error", message: error.message });
        throw error;
    }
}

/**
 * Compiled JSON for the current branch in remote mode. Served from the cache when the upstream commit
 * has already been compiled; otherwise (e.g. after checking out another branch) compiles it remotely.
 */
export async function getRemoteCompiledJson(workspaceFolder: string, options: DataformOptions): Promise<RemoteCompileOutcome> {
    const { git, repositoryName } = await getGitInfo();
    const upstreamSha = await git.getUpstreamSha();
    const cached = upstreamSha ? await getRemoteCompile(repositoryName, upstreamSha, options.api.releaseConfig ?? DEFAULT_CONFIG_KEY) : undefined;
    if (cached) {
        await reportEntry(git, cached);
        return outcomeFromEntry(cached);
    }

    // A compile of another commit (e.g. started before a branch switch) must not be reused
    if (!inFlightCompile || inFlightCompileSha !== upstreamSha) {
        const compile = compileRemotely(workspaceFolder, options, false).finally(() => {
            if (inFlightCompile === compile) {
                inFlightCompile = undefined;
            }
        });
        inFlightCompile = compile;
        inFlightCompileSha = upstreamSha;
    }
    return inFlightCompile;
}

/** Explicit compile from the command palette or status bar; always calls the API. */
async function compileRemotelyAndReport() {
    const workspaceFolder = currentDataformRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
    }
    try {
        const outcome = await compileRemotely(workspaceFolder, resolveDataformOptions(workspaceFolder), true);
        if (outcome.errors?.[0]?.error === REMOTE_COMPILE_CANCELLED) {
            return;
        }
        if (outcome.dataformCompiledJson) {
            setCompiled(workspaceFolder, outcome.dataformCompiledJson);
            vscode.window.showInformationMessage(`Compiled remotely: ${outcome.dataformCompiledJson.targets.length} actions`);
        } else if (outcome.errors?.length) {
            vscode.window.showErrorMessage(`Remote compilation failed: ${outcome.errors[0].error}`);
        }
        await onRemoteCompileCompleted?.();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Remote compilation failed: ${error.message}`);
    }
}

async function pickReleaseConfig() {
    const workspaceFolder = currentDataformRoot() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        return;
    }
    try {
        const { repositoryName } = await getGitInfo();
        const dataformClient = await createDataformClient(workspaceFolder, resolveDataformOptions(workspaceFolder), repositoryName);
        const parent = `projects/${dataformClient.gcpProjectId}/locations/${dataformClient.gcpLocation}/repositories/${repositoryName}`;
        const [releaseConfigs] = await dataformClient.client.listReleaseConfigs({ parent });
        const items: (vscode.QuickPickItem & { value: string | undefined })[] = [
            { label: "Default settings", description: "workflow_settings.yaml + compilerOptions", value: undefined },
            ...releaseConfigs.map((config) => ({
                label: config.name?.split("/").pop() ?? "",
                description: config.gitCommitish ?? undefined,
                value: config.name ?? undefined,
            })),
        ];
        const picked = await vscode.window.showQuickPick(items, { placeHolder: "Compile with the settings of a release config" });
        if (!picked) {
            return;
        }
        await setSelectedReleaseConfig(picked.value);
        await compileRemotelyAndReport();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Unable to list release configs: ${error.message}`);
    }
}

async function remoteModeActions() {
    const releaseConfig = getSelectedReleaseConfig();
    const actions = [
        { label: "$(cloud-upload) Compile remotely now", run: compileRemotelyAndReport },
        {
            label: "$(settings) Compile with release config…",
            description: releaseConfig ? `current: ${releaseConfig.split("/").pop()}` : "current: default settings",
            run: pickReleaseConfig,
        },
        {
            label: "$(terminal) Switch to CLI mode",
            run: () => setCompilationMode("cli"),
        },
    ];
    const picked = await vscode.window.showQuickPick(actions, { placeHolder: "Dataform remote mode (beta)" });
    await picked?.run();
}
