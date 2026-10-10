#!/usr/bin/env node
// Records the manifest a real dbt writes for the example Projects, as fixtures for the dbt Backend's manifest reader
// (src/test/fixtures/dbt-manifests). `just record-dbt-manifests` runs it.
//
//   node scripts/dbt/record-manifests.mjs <dbt binary>...
//
// Each binary records under the name of its engine: dbt-core for 1.x, dbt-v2 for 2.x. For each it writes
//   <engine>.json               `dbt compile` of projects/dbt. This connects to BigQuery, as any compile does.
//   <engine>-hooks-parsed.json  `dbt parse` of projects/dbt-hooks. A parse runs nothing, so its hooks do not run.
// dbt's own target/ and logs go to a temporary directory, never into the Projects.
//
// A manifest is kept as dbt wrote it but for three cuts, so that it can be committed: the SQL of dbt's own macros
// (nine tenths of the file), the absolute path of the Project, and the anonymous user id.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const projects = path.join(repo, 'src', 'test', 'fixtures', 'xf-examples', 'projects');
const out = path.join(repo, 'src', 'test', 'fixtures', 'dbt-manifests');
const RECORDINGS = [
    { project: 'dbt', command: 'compile', suffix: '' },
    { project: 'dbt-hooks', command: 'parse', suffix: '-hooks-parsed' },
];
const DBT_OWN_PACKAGES = /^dbt(_|$)/;

const binaries = process.argv.slice(2);
if (binaries.length === 0) {
    console.error('usage: record-manifests.mjs <dbt binary>...');
    process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

for (const binary of binaries) {
    for (const { project, command, suffix } of RECORDINGS) {
        const root = path.join(projects, project);
        const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-record-'));
        try {
            execFileSync(binary, [command, '--project-dir', root, '--profiles-dir', root, '--target-path', path.join(scratch, 'target'), '--log-path', path.join(scratch, 'logs'), '--log-format', 'json'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
            const manifest = JSON.parse(fs.readFileSync(path.join(scratch, 'target', 'manifest.json'), 'utf8'));
            const major = String(manifest.metadata.dbt_version).split('.')[0];
            const engine = major === '1' ? 'dbt-core' : major === '2' ? 'dbt-v2' : undefined;
            if (!engine) {
                throw new Error(`${binary} is dbt ${manifest.metadata.dbt_version}: neither dbt-core 1.x nor dbt v2`);
            }
            for (const macro of Object.values(manifest.macros ?? {})) {
                if (DBT_OWN_PACKAGES.test(macro.package_name)) {
                    macro.macro_sql = '';
                }
            }
            if (manifest.metadata.user_id) {
                manifest.metadata.user_id = null;
            }
            const file = path.join(out, `${engine}${suffix}.json`);
            fs.writeFileSync(file, `${JSON.stringify(manifest).split(JSON.stringify(root).slice(1, -1)).join(`/xf-examples/projects/${project}`)}\n`);
            console.log(`wrote ${path.relative(repo, file)} (dbt ${manifest.metadata.dbt_version}, ${command}, ${fs.statSync(file).size} bytes)`);
        } finally {
            fs.rmSync(scratch, { recursive: true, force: true });
        }
    }
}
