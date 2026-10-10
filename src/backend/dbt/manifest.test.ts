import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, test } from 'mocha';
import { fullManifestPath } from './fixtures';
import { buildDbtGraph } from './graph';
import { readManifest } from './manifest';

suite('reading a dbt manifest in a worker', () => {
    test('gives what reading it here gives', async () => {
        const file = fullManifestPath('dbt-v2');
        assert.deepStrictEqual(await readManifest(file), buildDbtGraph(JSON.parse(fs.readFileSync(file, 'utf8'))));
    });

    test('rejects when the manifest is missing or is not JSON', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-manifest-'));
        try {
            await assert.rejects(readManifest(path.join(dir, 'manifest.json')), /Could not read the dbt manifest .*manifest\.json/);
            fs.writeFileSync(path.join(dir, 'manifest.json'), '{"metadata":');
            await assert.rejects(readManifest(path.join(dir, 'manifest.json')), /Could not read the dbt manifest/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('rejects with the reason when it is no longer wanted', async () => {
        const controller = new AbortController();
        const reading = readManifest(fullManifestPath('dbt-core'), controller.signal);
        controller.abort(new Error('superseded'));
        await assert.rejects(reading, /superseded/);
        await assert.rejects(readManifest(fullManifestPath('dbt-core'), controller.signal), /superseded/);
    });
});
