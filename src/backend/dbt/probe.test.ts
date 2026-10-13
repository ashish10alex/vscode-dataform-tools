import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, test } from 'mocha';
import { parseDbtVersion, probeDbt } from './probe';

// As dbt-core 1.12.5 and dbt v2 2.0.6 print it
const CORE = 'Core:\n  - installed: 1.12.5\n  - latest:    1.12.5 - \x1b[32mUp to date!\x1b[0m\n\nPlugins:\n  - bigquery: 1.12.1 - \x1b[32mUp to date!\x1b[0m\n\n\n';
const V2 = 'dbt 2.0.6\n';

suite('probing a dbt binary', () => {
    test('dbt-core with the BigQuery adapter', () => {
        assert.deepStrictEqual(parseDbtVersion(CORE), { flavour: 'dbt-core', version: '1.12.5', label: 'dbt-core 1.12.5', recognised: true, bigQueryAdapter: true });
    });

    test('dbt-core without it is still dbt-core', () => {
        const probe = parseDbtVersion('Core:\n  - installed: 1.9.0-b2\n  - latest:    1.12.5 - Update available!\n\nPlugins:\n  - snowflake: 1.9.0 - Up to date!\n  - postgres: 1.9.0\n');
        assert.deepStrictEqual([probe.flavour, probe.version, probe.bigQueryAdapter, probe.unsupported], ['dbt-core', '1.9.0-b2', false, undefined]);
    });

    test('dbt v2 has its adapters built in', () => {
        assert.deepStrictEqual(parseDbtVersion(V2), { flavour: 'dbt v2', version: '2.0.6', label: 'dbt 2.0.6', recognised: true, bigQueryAdapter: true });
        assert.strictEqual(parseDbtVersion('dbt 2.0.0-beta.12\n').version, '2.0.0-beta.12');
    });

    test('dbt-core below 1.8 is refused, with the version found and the one needed', () => {
        assert.match(parseDbtVersion('Core:\n  - installed: 1.7.19\n\nPlugins:\n  - bigquery: 1.7.9\n').unsupported ?? '', /dbt-core 1\.7\.19\. dbt-core 1\.8 or later is needed, or dbt v2/);
        // As dbt-core printed it before 1.5
        assert.match(parseDbtVersion('installed version: 0.21.1\n   latest version: 1.0.0\n\nPlugins:\n  - bigquery: 0.21.1\n').unsupported ?? '', /0\.21\.1/);
        assert.strictEqual(parseDbtVersion('Core:\n  - installed: 1.8.0\n').unsupported, undefined);
        assert.strictEqual(parseDbtVersion('Core:\n  - installed: 1.10.4\n').unsupported, undefined);
    });

    test('output that is neither engine\'s is taken for dbt v2', () => {
        assert.deepStrictEqual(parseDbtVersion('\n  some wrapper 3\nmore\n'), { flavour: 'dbt v2', version: '', label: 'some wrapper 3', recognised: false, bigQueryAdapter: true });
        assert.strictEqual(parseDbtVersion('').label, 'dbt');
    });

    test('runs the binary once, and says why when it cannot', async function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-probe-'));
        try {
            const script = (name: string, body: string) => {
                fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
                return path.join(dir, name);
            };
            assert.strictEqual((await probeDbt(script('v2', 'echo "dbt 2.0.6"'))).label, 'dbt 2.0.6');
            // On stderr
            assert.strictEqual((await probeDbt(script('core', 'echo "Core:\n  - installed: 1.8.2" >&2'))).label, 'dbt-core 1.8.2');
            await assert.rejects(probeDbt(script('broken', 'echo "No module named dbt" >&2; exit 1')), /Could not run .*broken --version: No module named dbt/);
            await assert.rejects(probeDbt(path.join(dir, 'none')), /Could not run .*none --version/);
            const controller = new AbortController();
            const probing = probeDbt(script('slow', 'sleep 5'), { signal: controller.signal });
            controller.abort(new Error('no longer wanted'));
            await assert.rejects(probing, /no longer wanted/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // DBT_E2E_BINARIES=/path/to/dbt-core:/path/to/dbt probes each real dbt
    for (const binary of (process.env.DBT_E2E_BINARIES ?? '').split(path.delimiter).filter(Boolean)) {
        test(`a real dbt is recognised: ${binary}`, async function () {
            this.timeout(30_000);
            const probe = await probeDbt(binary);
            assert.strictEqual(probe.recognised, true, probe.label);
            assert.strictEqual(probe.unsupported, undefined);
        });
    }
});
