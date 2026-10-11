import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { DbtOptions } from '../backend/dbt';
import { ChangeBase, getStorageRoot } from '../changedActions';
import { logger } from '../logger';
import { extractSnapshot, mirrorTree } from '../utils/gitSnapshot';
import type { ProjectState } from './registry';

/*
 * The manifests of a dbt Project as it is at a commit. The extension takes the commit out of git into a directory
 * of its own, parses it there, and keeps the manifest by commit, dbt, dbt target and variables. Run Changed compares
 * with the one parsed with the user's dbt target (dbtChanges.ts); defer to prod reads from the one parsed with the
 * prod dbt target (dbtDefer.ts).
 */

const MAX_CACHED_BASES_PER_PROJECT = 5;
/** Written last into a base's directory: one without it was cut short */
const COMPLETE = 'complete';
const PACKAGES_DIR = 'dbt_packages';
/** What says which packages a Project installs, and at which versions */
const PACKAGE_FILES = ['packages.yml', 'dependencies.yml', 'package-lock.yml'];

const basesInFlight = new Map<string, Promise<string>>();

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
export async function ensureDbtBase(project: ProjectState, options: DbtOptions, base: ChangeBase): Promise<string> {
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

/** Deletes the manifest kept for the base, so that the next asking parses it again: what it was parsed with, such as the profile, has changed */
export async function removeDbtBase(root: string, options: DbtOptions, base: ChangeBase): Promise<void> {
    const dir = baseDir(root, base.mergeBaseSha, options);
    await basesInFlight.get(dir)?.catch(() => undefined);
    await fs.promises.rm(dir, { recursive: true, force: true });
}
