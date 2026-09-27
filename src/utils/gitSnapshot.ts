import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

/* Materialises a commit of the Dataform project on disk so it can be compiled next to the working tree. */

/** Run from the Dataform folder, `git archive` includes only that folder, with paths relative to it. */
export function extractSnapshot(workspaceFolder: string, sha: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const archive = spawn('git', ['archive', '--format=tar', sha], { cwd: workspaceFolder });
        const tar = spawn('tar', ['-x', '-C', destination]);
        let stderr = '';
        archive.stderr.on('data', (data) => { stderr += data.toString(); });
        tar.stderr.on('data', (data) => { stderr += data.toString(); });
        archive.on('error', reject);
        tar.on('error', reject);
        archive.stdout.pipe(tar.stdin);
        const exited = (child: typeof archive) => new Promise<number | null>((done) => child.on('close', done));
        Promise.all([exited(archive), exited(tar)]).then(([archiveCode, tarCode]) => {
            if (archiveCode === 0 && tarCode === 0) {
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
            await fsp.symlink(await fsp.readlink(from), to);
        } else if (entry.isFile()) {
            try {
                await fsp.link(from, to);
            } catch {
                await fsp.copyFile(from, to);
            }
        }
    }
}
