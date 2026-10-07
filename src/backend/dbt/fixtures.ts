import fs from 'fs';
import path from 'path';

/*
 * The dbt fixtures the Backend's tests read, copied from xf (see src/test/fixtures/xf-examples/README.md). For tests
 * only: nothing the extension ships imports this.
 */

/** A manifest as xf recorded it: the manifest dbt wrote, cut down to what xf reads, with the errors of the compile that wrote it */
export interface RecordedManifest {
    metadata: { dbt_version: string; project_name?: string };
    nodes: Record<string, Record<string, unknown>> | null;
    sources: Record<string, Record<string, unknown>> | null;
    exposures: Record<string, Record<string, unknown>> | null;
    unit_tests: Record<string, Record<string, unknown>> | null;
    disabled: Record<string, unknown> | null;
    /** The Project's macros and its packages'. Absent from the recordings of a failed compile */
    macros?: Record<string, Record<string, unknown>>;
    /** What xf made of dbt's errors, for the recordings of a failed compile */
    xf_errors?: Array<{ FileName: string; Message: string; Stack: string }>;
}

/** dbt-core 1.x and dbt v2 (the Fusion engine), each recorded on macOS and, for path separators, as Windows gives it */
export const RECORDINGS = [
    'dbt-core', 'dbt-core-windows', 'dbt-core-broken', 'dbt-core-broken-windows',
    'dbt-v2', 'dbt-v2-windows', 'dbt-v2-broken', 'dbt-v2-broken-windows',
] as const;
export type Recording = (typeof RECORDINGS)[number];

/** The example dbt Projects: `dbt` is what the recordings without "broken" compiled, `dbt-broken` the others; `dbt-hooks` has on-run hooks and no recording */
export const EXAMPLE_PROJECTS = ['dbt', 'dbt-broken', 'dbt-hooks'] as const;
export type ExampleProject = (typeof EXAMPLE_PROJECTS)[number];

function fixturesDir(): string {
    // From the source file or its compiled copy under out/, up to the repository
    let dir = __dirname;
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`No package.json above ${__dirname}`);
        }
        dir = parent;
    }
    return path.join(dir, 'src', 'test', 'fixtures', 'xf-examples');
}

export function recordedManifestPath(name: Recording): string {
    return path.join(fixturesDir(), `${name}.json`);
}

export function readRecordedManifest(name: Recording): RecordedManifest {
    return JSON.parse(fs.readFileSync(recordedManifestPath(name), 'utf8'));
}

/** The root of an example dbt Project */
export function exampleProjectRoot(name: ExampleProject): string {
    return path.join(fixturesDir(), 'projects', name);
}

/**
 * Whole manifests, recorded from a real dbt by scripts/dbt/record-manifests.mjs (see
 * src/test/fixtures/dbt-manifests/README.md): `dbt compile` of the example Project `dbt`, and `dbt parse` of
 * `dbt-hooks`, which has nothing compiled and the Project's on-run hooks.
 */
export const FULL_MANIFESTS = ['dbt-core', 'dbt-v2', 'dbt-core-hooks-parsed', 'dbt-v2-hooks-parsed'] as const;
export type FullManifest = (typeof FULL_MANIFESTS)[number];

export function fullManifestPath(name: FullManifest): string {
    return path.join(fixturesDir(), '..', 'dbt-manifests', `${name}.json`);
}
