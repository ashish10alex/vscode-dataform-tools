import * as vscode from 'vscode';
import { logger } from '../logger';
import { DataformCompiledJson } from '../types';

/*
 * Remote compilation results persisted per repository, keyed by the compiled commit SHA and the
 * release config whose compilation settings were used. The adapted JSON is several MB for larger
 * projects, so it lives in files under globalStorage rather than in workspaceState.
 */

const MAX_ENTRIES_PER_REPO = 5;
export const DEFAULT_CONFIG_KEY = "default";

export type RemoteCompileEntry = {
    repositoryName: string;
    sha: string;
    configKey: string;
    compiledAt: number;
    compiledJson: DataformCompiledJson;
};

let storageRoot: vscode.Uri | undefined;
let latestEntry: RemoteCompileEntry | undefined;

export function initRemoteCompileCache(context: vscode.ExtensionContext) {
    storageRoot = vscode.Uri.joinPath(context.globalStorageUri, "remote-compile");
}

function repoDir(repositoryName: string): vscode.Uri {
    if (!storageRoot) {
        throw new Error("Remote compile cache used before initialisation");
    }
    return vscode.Uri.joinPath(storageRoot, encodeURIComponent(repositoryName));
}

function entryFileName(sha: string, configKey: string) {
    return `${sha}__${encodeURIComponent(configKey)}.json`;
}

/** `trackAsLatest` is false for compiles of other commits (e.g. the merge-base), which must not become the current result. */
export async function saveRemoteCompile(entry: RemoteCompileEntry, trackAsLatest = true): Promise<void> {
    if (trackAsLatest) {
        latestEntry = entry;
    }
    const dir = repoDir(entry.repositoryName);
    try {
        await vscode.workspace.fs.createDirectory(dir);
        const file = vscode.Uri.joinPath(dir, entryFileName(entry.sha, entry.configKey));
        await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(entry)));
        await pruneOldEntries(dir);
    } catch (error) {
        logger.error(`Failed to persist remote compilation result: ${error}`);
    }
}

async function pruneOldEntries(dir: vscode.Uri) {
    const files = (await vscode.workspace.fs.readDirectory(dir))
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".json"))
        .map(([name]) => vscode.Uri.joinPath(dir, name));
    if (files.length <= MAX_ENTRIES_PER_REPO) {
        return;
    }
    const withTimes = await Promise.all(files.map(async (uri) => ({ uri, mtime: (await vscode.workspace.fs.stat(uri)).mtime })));
    withTimes.sort((a, b) => b.mtime - a.mtime);
    for (const { uri } of withTimes.slice(MAX_ENTRIES_PER_REPO)) {
        await vscode.workspace.fs.delete(uri);
    }
}

async function readEntry(uri: vscode.Uri): Promise<RemoteCompileEntry | undefined> {
    try {
        return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString()) as RemoteCompileEntry;
    } catch {
        return undefined;
    }
}

/** The result compiled from `sha` with the given config, if there is one. */
export async function getRemoteCompile(repositoryName: string, sha: string, configKey: string, trackAsLatest = true): Promise<RemoteCompileEntry | undefined> {
    if (latestEntry && latestEntry.repositoryName === repositoryName && latestEntry.configKey === configKey && latestEntry.sha === sha) {
        return latestEntry;
    }
    const exact = await readEntry(vscode.Uri.joinPath(repoDir(repositoryName), entryFileName(sha, configKey)));
    if (exact && trackAsLatest) {
        latestEntry = exact;
    }
    return exact;
}

export function getLatestRemoteCompile(): RemoteCompileEntry | undefined {
    return latestEntry;
}

export async function clearRemoteCompileCache(): Promise<void> {
    latestEntry = undefined;
    if (!storageRoot) {
        return;
    }
    try {
        await vscode.workspace.fs.delete(storageRoot, { recursive: true });
    } catch {
        // Nothing cached
    }
}
