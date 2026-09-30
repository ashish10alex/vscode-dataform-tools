import * as vscode from 'vscode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';

/*
 * The last successful Dataform CLI compilation of each project, persisted so the compiled query panel can
 * show it straight after VS Code starts instead of waiting for `dataform compile`. An entry is only reused
 * as-is while its fingerprint (compile inputs, CLI, compiler options and day) still matches.
 */

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Directories the Dataform CLI reads action definitions and includes from */
const INPUT_DIRS = ['definitions', 'includes'];
/** Files at the project root (or in node_modules) whose changes alter the compiled output */
const INPUT_FILES = [
    'workflow_settings.yaml',
    'dataform.json',
    'package.json',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    path.join('node_modules', '@dataform', 'core', 'package.json'),
];

export type CompileFingerprint = {
    /** Hash of the path, size and mtime of every compile input */
    files: string;
    /** The Dataform CLI that compiles, with its version when it can be read */
    cli: string;
    /** The compilerOptions setting */
    options: string;
    /** UTC day; includes/ often derive values from the current date */
    day: string;
};

export type CliCompileEntryMeta = {
    workspaceFolder: string;
    fingerprint: CompileFingerprint;
    compiledAt: number;
};

let storageRoot: string | undefined;

export function initCliCompileCache(context: vscode.ExtensionContext) {
    storageRoot = path.join(context.globalStorageUri.fsPath, 'cli-compile');
}

export function isPersistCompilationEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-dataform-tools').get<boolean>('persistCompilation') ?? true;
}

function shortHash(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

/** Same day as `baseCacheDay` in changedActions, which cannot be imported here without an import cycle */
function today(now = new Date()): string {
    return now.toISOString().slice(0, 10);
}

async function statLine(workspaceFolder: string, relativePath: string): Promise<string> {
    try {
        const stats = await fsp.stat(path.join(workspaceFolder, relativePath));
        return `${relativePath}\t${stats.size}\t${stats.mtimeMs}`;
    } catch {
        return `${relativePath}\tmissing`;
    }
}

async function listFiles(root: string, relativeDir: string, out: string[]) {
    let entries: fs.Dirent[];
    try {
        entries = await fsp.readdir(path.join(root, relativeDir), { withFileTypes: true });
    } catch {
        return;
    }
    await Promise.all(entries.map(async (entry) => {
        if (entry.name.startsWith('.')) {
            return; // The CLI skips them, and .DS_Store or editor swap files would change the fingerprint
        }
        const relativePath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            await listFiles(root, relativePath, out);
        } else {
            out.push(relativePath);
        }
    }));
}

/**
 * The installed version of the CLI behind `cliPath`, found from the package.json of `@dataform/cli` above
 * the resolved executable (or beside an npm shim on Windows). Falls back to the executable's size and mtime.
 */
async function describeCli(cliPath: string): Promise<string> {
    let resolved: string;
    try {
        resolved = await fsp.realpath(cliPath);
    } catch {
        return `${cliPath}\tmissing`;
    }
    const candidates: string[] = [path.join(path.dirname(cliPath), 'node_modules', '@dataform', 'cli', 'package.json')];
    for (let dir = path.dirname(resolved); dir !== path.dirname(dir); dir = path.dirname(dir)) {
        candidates.push(path.join(dir, 'package.json'));
    }
    for (const candidate of candidates) {
        try {
            const pkg = JSON.parse(await fsp.readFile(candidate, 'utf8'));
            if (pkg?.name === '@dataform/cli' && pkg.version) {
                return `${cliPath}\t${pkg.version}`;
            }
        } catch {
            // Not the CLI's package.json, keep looking
        }
    }
    try {
        const stats = await fsp.stat(resolved);
        return `${cliPath}\t${stats.size}\t${stats.mtimeMs}`;
    } catch {
        return `${cliPath}\tmissing`;
    }
}

/** Stats the compile inputs rather than reading them, so this takes milliseconds even on large projects. */
export async function computeCompileFingerprint(workspaceFolder: string, cliPath: string, compilerOptions: string): Promise<CompileFingerprint> {
    const inputFiles: string[] = [];
    await Promise.all(INPUT_DIRS.map((dir) => listFiles(workspaceFolder, dir, inputFiles)));
    const [lines, cli] = await Promise.all([
        Promise.all([...inputFiles.sort(), ...INPUT_FILES].map((file) => statLine(workspaceFolder, file))),
        describeCli(cliPath),
    ]);
    return { files: shortHash(lines.join('\n')), cli, options: compilerOptions, day: today() };
}

export function fingerprintsMatch(a: CompileFingerprint, b: CompileFingerprint): boolean {
    return a.files === b.files && a.cli === b.cli && a.options === b.options && a.day === b.day;
}

/** Why a saved compilation no longer matches the project, or undefined when it still does. */
export function staleReason(saved: CompileFingerprint, current: CompileFingerprint): string | undefined {
    if (saved.files !== current.files) {
        return "Project files changed since this compilation; recompiling";
    }
    if (saved.cli !== current.cli) {
        return "The Dataform CLI changed since this compilation; recompiling";
    }
    if (saved.options !== current.options) {
        return "compilerOptions changed since this compilation; recompiling";
    }
    if (saved.day !== current.day) {
        return "Compiled on an earlier day; recompiling";
    }
    return undefined;
}

function entryPaths(workspaceFolder: string): { meta: string, compiled: string } | undefined {
    if (!storageRoot) {
        return undefined;
    }
    const key = shortHash(path.resolve(workspaceFolder));
    return { meta: path.join(storageRoot, `${key}.meta.json`), compiled: path.join(storageRoot, `${key}.compiled.json`) };
}

/** Another window on the same project may read the file meanwhile, so it must never see it half written */
async function writeFileAtomically(file: string, content: string) {
    const temporary = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
        await fsp.writeFile(temporary, content);
        await fsp.rename(temporary, file);
    } catch (error) {
        await fsp.rm(temporary, { force: true });
        throw error;
    }
}

/** The raw `dataform compile --json` output is saved as-is, which avoids serialising several MB of JSON again. */
export async function saveCliCompile(meta: CliCompileEntryMeta, compiledString: string): Promise<void> {
    const paths = entryPaths(meta.workspaceFolder);
    if (!paths || !storageRoot) {
        return;
    }
    try {
        await fsp.mkdir(storageRoot, { recursive: true });
        // Written last, so a meta file is only ever next to the output it describes
        await fsp.rm(paths.meta, { force: true });
        await writeFileAtomically(paths.compiled, compiledString);
        await writeFileAtomically(paths.meta, JSON.stringify(meta));
        await pruneOldEntries();
    } catch (error) {
        logger.error(`Failed to persist the CLI compilation: ${error}`);
    }
}

export async function loadCliCompile(workspaceFolder: string): Promise<{ meta: CliCompileEntryMeta, compiledString: string } | undefined> {
    const paths = entryPaths(workspaceFolder);
    if (!paths) {
        return undefined;
    }
    try {
        const meta = JSON.parse(await fsp.readFile(paths.meta, 'utf8')) as CliCompileEntryMeta;
        const compiledString = await fsp.readFile(paths.compiled, 'utf8');
        return { meta, compiledString };
    } catch {
        return undefined;
    }
}

/** Entries of projects not compiled for a month, e.g. deleted or moved ones */
async function pruneOldEntries() {
    if (!storageRoot) {
        return;
    }
    const now = Date.now();
    for (const name of await fsp.readdir(storageRoot)) {
        const file = path.join(storageRoot, name);
        try {
            if (now - (await fsp.stat(file)).mtimeMs > MAX_AGE_MS) {
                await fsp.rm(file, { force: true });
            }
        } catch {
            // Removed concurrently
        }
    }
}
