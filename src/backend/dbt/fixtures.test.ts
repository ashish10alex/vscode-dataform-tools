import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { EXAMPLE_PROJECTS, RECORDINGS, RecordedManifest, exampleProjectRoot, readRecordedManifest } from './fixtures';

/** How many nodes the manifest has of each resource type */
function resourceTypes(manifest: RecordedManifest): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const node of Object.values(manifest.nodes ?? {})) {
        const type = String(node.resource_type);
        counts[type] = (counts[type] ?? 0) + 1;
    }
    return counts;
}

suite('dbt fixtures', () => {
    test('every recording is there and is a manifest', () => {
        for (const name of RECORDINGS) {
            const manifest = readRecordedManifest(name);
            assert.strictEqual(typeof manifest.metadata.dbt_version, 'string', name);
            assert.strictEqual(!!manifest.xf_errors?.length, name.includes('broken'), `${name}: errors only from the broken Project`);
        }
    });

    test('both engines recorded the same example Project', () => {
        for (const name of ['dbt-core', 'dbt-core-windows', 'dbt-v2', 'dbt-v2-windows'] as const) {
            const manifest = readRecordedManifest(name);
            assert.strictEqual(manifest.metadata.project_name, 'xf_example', name);
            assert.deepStrictEqual(resourceTypes(manifest), { analysis: 1, model: 10, seed: 1, snapshot: 1, test: 12 }, name);
            assert.strictEqual(Object.keys(manifest.sources ?? {}).length, 3, name);
            assert.strictEqual(Object.keys(manifest.exposures ?? {}).length, 1, name);
            assert.strictEqual(Object.keys(manifest.unit_tests ?? {}).length, 1, name);
            assert.strictEqual(Object.keys(manifest.macros ?? {}).length, 3, name);
        }
        assert.ok(readRecordedManifest('dbt-core').metadata.dbt_version.startsWith('1.'));
        assert.ok(readRecordedManifest('dbt-v2').metadata.dbt_version.startsWith('2.'));
    });

    test('a Windows recording differs in its path separators', () => {
        const file = (name: 'dbt-core' | 'dbt-core-windows') => readRecordedManifest(name).nodes!['model.xf_example.fct_orders'].original_file_path;
        assert.strictEqual(file('dbt-core'), 'models/marts/fct_orders.sql');
        assert.strictEqual(file('dbt-core-windows'), 'models\\marts\\fct_orders.sql');
    });

    test('a failed compile leaves no manifest with dbt-core, and a parsed one with dbt v2', () => {
        assert.strictEqual(readRecordedManifest('dbt-core-broken').nodes, null);
        assert.deepStrictEqual(Object.keys(readRecordedManifest('dbt-v2-broken').nodes ?? {}).sort(), ['model.xf_broken.order_totals', 'model.xf_broken.orders']);
    });

    test('every example Project is there, and the files the recordings name are in it', () => {
        for (const name of EXAMPLE_PROJECTS) {
            assert.ok(fs.existsSync(path.join(exampleProjectRoot(name), 'dbt_project.yml')), name);
        }
        for (const [recording, project] of [['dbt-core', 'dbt'], ['dbt-v2', 'dbt'], ['dbt-v2-broken', 'dbt-broken']] as const) {
            for (const node of Object.values(readRecordedManifest(recording).nodes ?? {})) {
                const file = String(node.original_file_path);
                assert.ok(fs.existsSync(path.join(exampleProjectRoot(project), file)), `${recording}: ${file}`);
            }
        }
        assert.match(fs.readFileSync(path.join(exampleProjectRoot('dbt-hooks'), 'dbt_project.yml'), 'utf8'), /^on-run-start:/m);
    });
});
