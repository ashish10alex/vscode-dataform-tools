import path from 'path';
import { Worker } from 'worker_threads';
import type { DbtGraph } from './graph';

/**
 * Reads the manifest dbt wrote at `manifestPath` in a worker thread and gives its Compiled Graph. Rejects when the
 * file is missing or is not a manifest, and with the signal's reason when `signal` is aborted, which also stops the
 * worker.
 */
export function readManifest(manifestPath: string, signal?: AbortSignal): Promise<DbtGraph> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason);
            return;
        }
        // The worker is beside this file, compiled (out/) or bundled (dist/)
        const worker = new Worker(path.join(__dirname, 'dbtManifestWorker.js'), { workerData: { manifestPath } });
        const onAbort = () => {
            void worker.terminate();
            reject(signal!.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        const settle = () => signal?.removeEventListener('abort', onAbort);
        worker.once('message', (result: DbtGraph) => {
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
