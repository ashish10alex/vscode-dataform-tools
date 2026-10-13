import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, test } from 'mocha';
import { affectsCompile, backendParts } from '..';
import { DBT_COMPILE_FILES, DbtBackend } from './backend';
import { fullManifestPath } from './fixtures';

const logger = { info: () => undefined, debug: () => undefined, error: () => undefined };

suite('the dbt Backend', () => {
    test('says which files affect a compile', () => {
        const affects = (file: string) => affectsCompile(DBT_COMPILE_FILES, file);
        for (const file of [
            'models/marts/fct_orders.sql', 'models/staging/_sources.yml', 'seeds/country_codes.csv', 'macros/audit.sql', 'models/docs.md',
            'snapshots/customers_snapshot.yml', 'analyses/revenue_by_country.sql', 'tests/assert_positive_order_totals.sql', 'models/forecast.py',
            // A Project names its own directories, and an installed package's files are compiled too
            'transform/core/orders.SQL', 'dbt_packages/dbt_utils/macros/sql/star.sql',
            'dbt_project.yml', 'packages.yml', 'dependencies.yml', 'selectors.yml', 'profiles.yml',
        ]) {
            assert.strictEqual(affects(file), true, file);
        }
        for (const file of [
            // dbt's own output, and what is not read
            'target/compiled/shop/models/orders.sql', 'target/manifest.json', 'logs/dbt.log', 'README.md', 'models/notes.txt', '.venv/lib/dbt/x.sql', '../other/models/a.sql',
        ]) {
            assert.strictEqual(affects(file), false, file);
        }
    });

    test('can run and can list Changed Actions', () => {
        assert.deepStrictEqual(backendParts(new DbtBackend()), { runner: true, changes: true });
        assert.strictEqual(new DbtBackend().name, 'dbt');
    });

    test('compiles, keeps what it learnt, and runs actions by the names of that compile', async function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-backend-')));
        try {
            const fake = path.join(dir, 'fake-dbt');
            fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), target = args[args.indexOf('--target-path') + 1];
if (process.env.FAKE_HANG) { setInterval(() => {}, 1000); return; }
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(${JSON.stringify(fullManifestPath('dbt-core'))}, path.join(target, 'manifest.json'));
process.stdout.write(JSON.stringify({ data: { target_name: 'dev' }, info: { level: 'info', name: 'ConcurrencyLine' } }) + '\\n');
`, { mode: 0o755 });
            const options = { binary: fake, flavour: 'dbt-core' as const, artifactDir: path.join(dir, 'artifacts'), target: 'ci' };
            const backend = new DbtBackend();
            const orders = 'alex-personal-dev-01.xf_example.fct_orders';
            const run = { actions: [orders], tags: [], includeDependencies: false, includeDependents: true, fullRefresh: false };

            // Read through a function, so that the compiler does not take the first answer for the only one
            const last = () => backend.lastResult;

            // Before a compile nothing is known of the actions
            assert.strictEqual(last(), undefined);
            assert.throws(() => backend.runner.command({ root: dir, options, run }), /dbt cannot select/);
            assert.match(backend.runner.command({ root: dir, options, run: { ...run, actions: [], tags: ['daily'] } }), /build --select tag:daily\+ --target ci$/);

            const result = await backend.compile({ root: dir, file: 'models/marts/fct_orders.sql', options, logger, signal: new AbortController().signal });
            assert.strictEqual(result.graph.actions[orders].kind, 'incremental');
            assert.strictEqual(result.target, 'dev');
            assert.strictEqual(last(), result);
            assert.strictEqual(last()?.dbt?.projectName, 'xf_example');
            assert.match(backend.runner.command({ root: dir, options, run }), /fake-dbt build --select xf_example\.marts\.fct_orders\+ --target ci$/);

            // A cancelled compile leaves the last result in place
            const controller = new AbortController();
            const cancelled = backend.compile({ root: dir, options: { ...options, env: { ...process.env, FAKE_HANG: '1' } }, logger, signal: controller.signal });
            setTimeout(() => controller.abort(new Error('superseded')), 100);
            await assert.rejects(cancelled, /superseded/);
            assert.strictEqual(last(), result);

            backend.forget();
            assert.strictEqual(last(), undefined);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
