import path from 'path';
import { Worker } from 'worker_threads';
import type { DbtChangedActions } from './changes';
import type { DbtGraph } from './graph';

/** What the worker thread is asked for: the Compiled Graph of a manifest, or its Changed Actions against a base */
export interface ManifestWork {
    manifestPath: string;
    /** The manifest of the Project at the base, and dbt's IDs of the resources it listed as changed */
    changes?: { basePath: string; selected: string[] };
}

/** Runs the worker beside this file, compiled (out/) or bundled (dist/), and gives what it posts back */
function inWorker<Result>(work: ManifestWork, signal?: AbortSignal): Promise<Result> {
    const { manifestPath } = work;
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        const worker = new Worker(path.join(__dirname, 'dbtManifestWorker.js'), { workerData: work });
        const onAbort = () => {
            void worker.terminate();
            reject(signal!.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const settle = () => signal?.removeEventListener('abort', onAbort);
        worker.once('message', (result: Result) => {
            settle();
            resolve(result);
        });
        worker.once('error', (error) => {
            settle();
            reject(new Error(`Could not read the dbt manifest ${manifestPath}: ${error.message}`, { cause: error }));
        });
        worker.once('exit', (code) => {
            settle();
            // Too late to matter when a message or an error came first
            reject(new Error(`Reading the dbt manifest ${manifestPath} stopped with code ${code}`));
        });
    });
}

/**
 * Reads the manifest dbt wrote at `manifestPath` in a worker thread and gives its Compiled Graph. Rejects when the
 * file is missing or is not a manifest, and with the signal's reason when `signal` is aborted, which also stops the
 * worker.
 */
export function readManifest(manifestPath: string, signal?: AbortSignal): Promise<DbtGraph> {
    return inWorker<DbtGraph>({ manifestPath }, signal);
}

/**
 * Reads the manifest at `manifestPath` and that of the base at `basePath` in a worker thread, and gives the Changed
 * Actions among the resources dbt listed (`selected`). Rejects as `readManifest` does.
 */
export function readManifestChanges(manifestPath: string, basePath: string, selected: string[], signal?: AbortSignal): Promise<DbtChangedActions> {
    return inWorker<DbtChangedActions>({ manifestPath, changes: { basePath, selected } }, signal);
}
