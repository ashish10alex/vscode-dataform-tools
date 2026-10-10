import fs from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { manifestChanges } from './changes';
import { DbtManifest, buildDbtGraph } from './graph';
import type { ManifestWork } from './manifest';

/*
 * The worker thread that reads a dbt manifest (see manifest.ts). A manifest is tens of megabytes for a large
 * Project: parsing it here keeps the extension host's thread free, and only the Compiled Graph is posted back, so
 * the manifest is never held there. Changed Actions are worked out here too, from two manifests. Bundled as its own
 * file, dist/dbtManifestWorker.js.
 */

const { manifestPath, changes } = workerData as ManifestWork;
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as DbtManifest;
parentPort!.postMessage(changes ? manifestChanges(read(changes.basePath), read(manifestPath), changes.selected) : buildDbtGraph(read(manifestPath)));
