import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream';

/* Materialises a commit of the Dataform project on disk so it can be compiled next to the working tree. */

/** Run from the Dataform folder, `git archive` includes only that folder, with paths relative to it. */
export function extractSnapshot(workspaceFolder: string, sha: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const archive = spawn('git', ['archive', '--format=tar', sha], { cwd: workspaceFolder });
        const tar = spawn('tar', ['-x', '-C', destination]);
        let stderr = '';
        archive.stderr.on('data', (data) => { stderr += data.toString(); });
        tar.stderr.on('data', (data) => { stderr += data.toString(); });
        // A process that cannot start (e.g. no tar) stops the other, so neither is left waiting on the pipe
        let spawnError: Error | undefined;
        const onSpawnError = (error: Error) => {
            spawnError ??= error;
            archive.kill();
            tar.kill();
        };
        archive.on('error', onSpawnError);
        tar.on('error', onSpawnError);
        // pipeline handles EPIPE when tar exits early; the exit codes below decide the outcome
        pipeline(archive.stdout, tar.stdin, () => undefined);
        // 'close' is not guaranteed after a spawn error, so an error also counts as finished
        const exited = (child: typeof archive) => new Promise<number | null>((done) => {
            child.on('close', done);
            child.on('error', () => done(null));
        });
        Promise.all([exited(archive), exited(tar)]).then(([archiveCode, tarCode]) => {
            if (spawnError) {
                reject(new Error(`Could not extract ${sha.slice(0, 7)}: ${spawnError.message}`));
            } else if (archiveCode === 0 && tarCode === 0) {
                resolve();
            } else {
                reject(new Error(`Could not extract ${sha.slice(0, 7)}: ${stderr.trim()}`));
            }
        });
    });
}

/**
 * Recreates `source` under `destination` with hardlinks (copies across volumes). A symlink to the real
 * node_modules does not work: newer Dataform CLIs resolve the real path of every required module and
 * reject anything outside the project directory. Symlinks inside the tree (`.bin`, pnpm) are kept as is.
 */
export async function mirrorTree(source: string, destination: string): Promise<void> {
    await fsp.mkdir(destination, { recursive: true });
    for (const entry of await fsp.readdir(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            await mirrorTree(from, to);
        } else if (entry.isSymbolicLink()) {
            try {
                await fsp.symlink(await fsp.readlink(from), to);
            } catch {
                // Windows without Developer Mode cannot create symlinks: copy what the link points to.
                // A dangling link has nothing to copy and cannot be required anyway, so it is skipped.
                await fsp.cp(from, to, { recursive: true, dereference: true }).catch(() => undefined);
            }
        } else if (entry.isFile()) {
            try {
                await fsp.link(from, to);
            } catch {
                await fsp.copyFile(from, to);
            }
        }
    }
}
