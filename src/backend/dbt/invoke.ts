import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { BackendRequest } from '../backend';
import type { DbtOptions } from './options';

/*
 * Runs a dbt command: one that writes a manifest (`compile`, `parse`, `ls`), or `deps`. A port of xf's `invoke`
 * (internal/backend/dbt/dbt.go). It says what dbt left behind; what that means (the Compiled Graph, the errors) is
 * for its callers.
 */

/** What running dbt needs of the Backend's options */
export type DbtRunOptions = Pick<DbtOptions, 'binary' | 'target' | 'vars' | 'profilesDir' | 'artifactDir' | 'env'>;

/**
 * The dbt commands that are run here. `compile`, `parse` and `ls` write a manifest: a parse compiles no SQL and
 * connects to nothing, and neither does `ls`, which lists what a selection selects. `deps` installs the Project's
 * packages and writes none.
 */
export type DbtCommand = 'compile' | 'parse' | 'ls' | 'deps';

/** What a dbt command left behind */
export interface DbtInvocation {
    /** The arguments dbt was given, without the binary */
    args: string[];
    /** The manifest it wrote. Unset when it wrote none, as a dbt-core parse that fails does */
    manifestPath?: string;
    /** What it printed: on stdout its log, one JSON object per line */
    stdout: string;
    stderr: string;
    /** Its exit status. Null when a signal ended it */
    exitCode: number | null;
    durationMs: number;
}

export function manifestPathIn(artifactDir: string): string {
    return path.join(artifactDir, 'target', 'manifest.json');
}

/**
 * The arguments for `command` on the Project at `root`. The log is JSON so that errors can be read from it.
 * `--no-version-check` is passed as ADR 0003 decides; in dbt-core it also turns off the check of the Project's
 * `require-dbt-version`. `extra` comes after the command's own, e.g. `--select`. `deps` writes nothing to `target/`,
 * and dbt-core's does not take `--target-path`.
 */
export function dbtArguments(command: DbtCommand, root: string, options: DbtRunOptions, extra: string[] = []): string[] {
    const args = [
        command,
        '--project-dir', root,
        ...(command === 'deps' ? [] : ['--target-path', path.join(options.artifactDir, 'target')]),
        '--log-path', path.join(options.artifactDir, 'logs'),
        '--log-format', 'json',
        '--no-version-check',
    ];
    if (options.profilesDir) {
        args.push('--profiles-dir', options.profilesDir);
    }
    if (options.target) {
        args.push('--target', options.target);
    }
    if (options.vars?.trim()) {
        args.push('--vars', options.vars);
    }
    return [...args, ...extra];
}

/** Ends the process and every process it started: dbt-core runs worker threads, and a wrapper script runs dbt as its child */
function killTree(child: ChildProcess) {
    if (child.pid === undefined) {
        return;
    }
    if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
        return;
    }
    try {
        // The child leads a process group of its own (`detached`), which the negative pid names. SIGKILL: either
        // engine ends at once and the next compile works, while SIGINT takes dbt-core a second
        process.kill(-child.pid, 'SIGKILL');
    } catch {
        // Already gone
    }
}

/**
 * Runs `command` from the Project root and waits for it to end. The manifest of an earlier run is deleted first, so
 * what a failed run leaves is never taken for its own. So is the SQL an earlier run compiled: dbt v2 writes the
 * `compiled` files it finds into the manifest as the SQL of actions this run did not compile, even when their
 * source has changed since. `onLine` is given each line of stdout as it comes.
 *
 * Resolves whatever dbt's exit status: a Project with errors is not a failure to run. Rejects when dbt could not be
 * started, and with the signal's reason when the signal is aborted, which ends dbt's process tree.
 */
export async function invokeDbt(
    request: Pick<BackendRequest<DbtRunOptions>, 'root' | 'options' | 'logger' | 'signal'>,
    command: DbtCommand,
    extra: string[] = [],
    onLine?: (line: string) => void,
): Promise<DbtInvocation> {
    const { root, options, logger, signal } = request;
    signal.throwIfAborted();
    const manifestPath = manifestPathIn(options.artifactDir);
    await fs.promises.mkdir(options.artifactDir, { recursive: true });
    await fs.promises.rm(manifestPath, { force: true });
    await fs.promises.rm(path.join(path.dirname(manifestPath), 'compiled'), { recursive: true, force: true });

    const args = dbtArguments(command, root, options, extra);
    logger.debug(`dbt: ${options.binary} ${args.join(' ')}`);
    const started = Date.now();

    const exitCode = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(options.binary, args, {
            cwd: root,
            env: options.env ?? process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            // Its own process group on Unix, so that the whole tree can be ended
            detached: process.platform !== 'win32',
        });
        let stdout = '';
        let stderr = '';
        let unfinished = '';
        const onAbort = () => {
            killTree(child);
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
            stdout += chunk;
            if (onLine) {
                const lines = (unfinished + chunk).split('\n');
                unfinished = lines.pop()!;
                lines.forEach((line) => onLine(line.replace(/\r$/, '')));
            }
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
            stderr += chunk;
        });
        child.once('error', (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(new Error(`Could not run ${options.binary}: ${error.message}`, { cause: error }));
        });
        // 'close', not 'exit': the output has all been read by then
        child.once('close', (code) => {
            signal.removeEventListener('abort', onAbort);
            if (onLine && unfinished) {
                onLine(unfinished.replace(/\r$/, ''));
            }
            // Workers that outlive dbt are not left behind
            killTree(child);
            resolve({ code, stdout, stderr });
        });
    });
    signal.throwIfAborted();

    const invocation: DbtInvocation = { args, stdout: exitCode.stdout, stderr: exitCode.stderr, exitCode: exitCode.code, durationMs: Date.now() - started };
    if (fs.existsSync(manifestPath)) {
        invocation.manifestPath = manifestPath;
    }
    logger.debug(`dbt ${command} ended with ${invocation.exitCode} in ${invocation.durationMs} ms${invocation.manifestPath ? '' : ', no manifest'}`);
    return invocation;
}
