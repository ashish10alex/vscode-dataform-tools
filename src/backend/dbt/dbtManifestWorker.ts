import fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { buildDbtGraph } from './graph';

/*
 * The worker thread that reads a dbt manifest (see manifest.ts). A manifest is tens of megabytes for a large
 * Project: parsing it here keeps the extension host's thread free, and only the Compiled Graph is posted back, so
 * the manifest is never held there. Bundled as its own file, dist/dbtManifestWorker.js.
 */

const { manifestPath } = workerData as { manifestPath: string };
parentPort!.postMessage(buildDbtGraph(JSON.parse(fs.readFileSync(manifestPath, 'utf8'))));
