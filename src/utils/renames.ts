import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import util from 'util';
import { execFile } from 'child_process';
import { ChangedAction, CompiledGraphDiff } from './compiledGraphDiff';

/*
 * Renamed actions, as xf pairs them (internal/changes/rename.go): an action whose file git calls renamed, or whose
 * file kept its path but gives it another schema or name, is the action it was rather than a new one and a deleted
 * one. Column impact compares it with the table it had, and judges its readers by their new SQL.
 */

const execFilePromise = util.promisify(execFile);

/** A file git calls renamed: its path at the merge-base, and how alike the two are, in percent */
export interface FileRename {
    from: string;
    score: number;
}

/** `git diff --name-status -z` output: "R095", the old path and the new one, each ended by a NUL. Others are skipped. */
export function parseRenames(out: string): Map<string, FileRename> {
    const renames = new Map<string, FileRename>();
    const fields = out.split('\0');
    for (let i = 0; i < fields.length; i++) {
        const status = fields[i];
        if (!status.startsWith('R') || i + 2 >= fields.length) {
            continue;
        }
        renames.set(fields[i + 2], { from: fields[i + 1], score: Number.parseInt(status.slice(1), 10) || 0 });
        i += 2;
    }
    return renames;
}

/** Whether `diff` has a new action and a deleted one, so that some may be a rename */
export function hasRenameCandidates(diff: CompiledGraphDiff): boolean {
    return diff.deleted.length > 0 && diff.changed.some((action) => action.reasons.includes('new'));
}

/**
 * Marks the actions of `diff` that were renamed: when a file git calls renamed has exactly one new action and its
 * old path exactly one deleted action, the new one was the old one, under the name of its new file. A file that
 * kept its path is paired the same way with itself: its one action is new and its old one deleted when the file gives
 * it another schema or name, which moves the table rather than making another. Built-in assertions, generated from a
 * table's config, are never paired: they follow their table. Returns `diff`.
 */
export function pairRenames<T extends CompiledGraphDiff>(diff: T, renames: Map<string, FileRename> = new Map()): T {
    const newIn = new Map<string, ChangedAction[]>();
    diff.changed.filter((action) => action.reasons.includes('new') && action.type !== 'assertion')
        .forEach((action) => newIn.set(action.fileName, [...(newIn.get(action.fileName) ?? []), action]));
    const deletedIn = new Map<string, CompiledGraphDiff['deleted']>();
    diff.deleted.filter((action) => action.type !== 'assertion')
        .forEach((action) => deletedIn.set(action.fileName, [...(deletedIn.get(action.fileName) ?? []), action]));
    const pair = (added: ChangedAction[] | undefined, removed: CompiledGraphDiff['deleted'] | undefined, score: number) => {
        if (added?.length !== 1 || removed?.length !== 1) {
            return;
        }
        const [action] = added;
        const [old] = removed;
        if (action.renamedFrom || old.renamedTo) {
            return;
        }
        action.renamedFrom = old.target;
        action.renamedFromFile = old.fileName;
        action.similarity = score;
        old.renamedTo = action.target;
    };
    renames.forEach((rename, file) => pair(newIn.get(file), deletedIn.get(rename.from), rename.score));
    newIn.forEach((added, file) => {
        if (file) {
            pair(added, deletedIn.get(file), 0);
        }
    });
    return diff;
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFilePromise('git', args, { cwd, env: env ? { ...process.env, ...env } : undefined, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
}

/**
 * The files of the project in `dir` that git calls renamed since `mergeBase`, by new path, both relative to `dir`.
 * It compares with `headSha`, or with the working tree when that is undefined. The working tree is compared through
 * a copy of the index: git diff rewrites the index it reads when files were saved since, and the index.lock that
 * takes can stop a Dataform compile copying the project. The files of `added` that git doesn't track yet count too:
 * they are added with intent-to-add to that copy.
 */
export async function renamedFiles(dir: string, mergeBase: string, headSha: string | undefined, added: string[]): Promise<Map<string, FileRename>> {
    const args = ['diff', '-M', '--diff-filter=R', '--name-status', '-z', '--relative', mergeBase];
    if (headSha) {
        return parseRenames(await git(dir, [...args, headSha, '--', '.']));
    }
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dataform-tools-index-'));
    try {
        const index = path.join(tmp, 'index');
        let source = (await git(dir, ['rev-parse', '--git-path', 'index'])).trim();
        if (!path.isAbsolute(source)) {
            source = path.join(dir, source);
        }
        try {
            await fs.copyFile(source, index);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') { // git reads no index as an empty one
                throw error;
            }
        }
        const env = { GIT_INDEX_FILE: index };
        if (added.length) {
            const untracked = (await git(dir, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...added])).split('\0').filter(Boolean);
            if (untracked.length) {
                await git(dir, ['add', '--intent-to-add', '--', ...untracked], env);
            }
        }
        return parseRenames(await git(dir, [...args, '--', '.'], env));
    } finally {
        await fs.rm(tmp, { recursive: true, force: true });
    }
}

/**
 * Pairs the renames of `diff`, a diff of the project in `dir` against `mergeBase`. Best effort: when git's renames
 * can't be read, only the actions whose file kept its path are paired.
 */
export async function withRenames<T extends CompiledGraphDiff>(diff: T, dir: string, mergeBase: string, headSha?: string): Promise<T> {
    if (!hasRenameCandidates(diff)) {
        return diff;
    }
    const added = [...new Set(diff.changed.filter((action) => action.reasons.includes('new') && action.fileName).map((action) => action.fileName))];
    let renames: Map<string, FileRename> | undefined;
    try {
        renames = await renamedFiles(dir, mergeBase, headSha, added);
    } catch {
        // Without them the renamed files stay new and deleted
    }
    return pairRenames(diff, renames);
}
