import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { exampleProjectRoot } from './fixtures';
import { DbtRunOptions as DbtOptions, dbtArguments, invokeDbt, manifestPathIn } from './invoke';

const logger = { info: () => undefined, debug: () => undefined, error: () => undefined };

/** Whether a process is still there */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('running dbt', () => {
    let dir: string;
    let fake: string;
    const options = (overrides: Partial<DbtOptions> = {}): DbtOptions => ({ binary: fake, artifactDir: path.join(dir, 'artifacts'), ...overrides });
    const request = (overrides: Partial<DbtOptions> = {}, signal = new AbortController().signal) => ({ root: dir, options: options(overrides), logger, signal });

    suiteSetup(function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-invoke-')));
        fake = path.join(dir, 'fake-dbt');
        // What FAKE_DBT says: "manifest" writes one; "fail" exits 2; "hang" starts a child, says so and waits
        fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const args = process.argv.slice(2);
const target = args[args.indexOf('--target-path') + 1];
const mode = (process.env.FAKE_DBT || '').split(',');
process.stdout.write(JSON.stringify({ info: { msg: 'cwd ' + process.cwd() } }) + '\\n{"info":{"msg":"half');
process.stdout.write(' a line"}}\\r\\n');
process.stderr.write('a warning\\n');
if (mode.includes('manifest')) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({ metadata: { args } }));
}
if (mode.includes('hang')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    process.stdout.write(JSON.stringify({ pids: [process.pid, child.pid] }) + '\\n');
    setInterval(() => {}, 1000);
} else {
    process.stdout.write('last line, unfinished');
    process.exitCode = mode.includes('fail') ? 2 : 0;
}
`, { mode: 0o755 });
    });

    suiteTeardown(() => {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('the arguments keep dbt out of the Project and make its log readable', () => {
        const artifacts = path.join('/storage', 'ab12');
        assert.deepStrictEqual(dbtArguments('compile', '/work/shop', { binary: 'dbt', artifactDir: artifacts }), [
            'compile', '--project-dir', '/work/shop', '--target-path', path.join(artifacts, 'target'), '--log-path', path.join(artifacts, 'logs'),
            '--log-format', 'json', '--no-version-check',
        ]);
        assert.deepStrictEqual(
            dbtArguments('parse', '/work/shop', { binary: 'dbt', artifactDir: artifacts, target: 'ci', vars: '{"day": "2024-01-01"}', profilesDir: '/work/profiles' }, ['--select', 'shop.orders']).slice(10),
            ['--profiles-dir', '/work/profiles', '--target', 'ci', '--vars', '{"day": "2024-01-01"}', '--select', 'shop.orders'],
        );
        // Blank variables are no variables
        assert.ok(!dbtArguments('parse', '/work/shop', { binary: 'dbt', artifactDir: artifacts, vars: '  ' }).includes('--vars'));
    });

    test('runs from the Project root and gives what dbt printed and the manifest it wrote', async () => {
        const lines: string[] = [];
        const invocation = await invokeDbt(request({ env: { ...process.env, FAKE_DBT: 'manifest' } }), 'compile', ['--select', 'x'], (line) => lines.push(line));
        assert.strictEqual(invocation.exitCode, 0);
        assert.strictEqual(invocation.manifestPath, manifestPathIn(options().artifactDir));
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(invocation.manifestPath!, 'utf8')).metadata.args, invocation.args);
        assert.deepStrictEqual(invocation.args.slice(-2), ['--select', 'x']);
        assert.strictEqual(invocation.stderr, 'a warning\n');
        // Whole lines, however the output was cut up, without the carriage return Windows adds, and the last one too
        assert.deepStrictEqual(lines, [JSON.stringify({ info: { msg: `cwd ${dir}` } }), '{"info":{"msg":"half a line"}}', 'last line, unfinished']);
        assert.strictEqual(invocation.stdout.split('\n').length, 3);
    });

    test('a failed run is not a failure to run, and never leaves the last manifest behind', async () => {
        await invokeDbt(request({ env: { ...process.env, FAKE_DBT: 'manifest' } }), 'compile');
        assert.ok(fs.existsSync(manifestPathIn(options().artifactDir)));
        const invocation = await invokeDbt(request({ env: { ...process.env, FAKE_DBT: 'fail' } }), 'parse');
        assert.strictEqual(invocation.exitCode, 2);
        assert.strictEqual(invocation.manifestPath, undefined);
        assert.ok(!fs.existsSync(manifestPathIn(options().artifactDir)));
    });

    test('the SQL an earlier run compiled is deleted first, so dbt v2 does not write it into the next manifest', async () => {
        const compiled = path.join(path.dirname(manifestPathIn(options().artifactDir)), 'compiled', 'shop', 'models');
        fs.mkdirSync(compiled, { recursive: true });
        fs.writeFileSync(path.join(compiled, 'orders.sql'), 'select 1');
        await invokeDbt(request({ env: { ...process.env, FAKE_DBT: 'manifest' } }), 'parse');
        assert.ok(!fs.existsSync(path.join(compiled, 'orders.sql')));
    });

    test('rejects when dbt cannot be started', async () => {
        await assert.rejects(invokeDbt(request({ binary: path.join(dir, 'no-such-dbt') }), 'parse'), /Could not run .*no-such-dbt/);
    });

    test('a cancel ends dbt and what dbt started, and rejects with the reason', async () => {
        const controller = new AbortController();
        let pids: number[] = [];
        const running = invokeDbt(request({ env: { ...process.env, FAKE_DBT: 'manifest,hang' } }, controller.signal), 'compile', [], (line) => {
            if (line.startsWith('{"pids"')) {
                pids = JSON.parse(line).pids;
                controller.abort(new Error('superseded'));
            }
        });
        await assert.rejects(running, /superseded/);
        assert.strictEqual(pids.length, 2);
        for (let waited = 0; pids.some(alive) && waited < 2000; waited += 50) {
            await sleep(50);
        }
        assert.deepStrictEqual(pids.map(alive), [false, false]);
        // Nothing is started for a request that is already unwanted
        await assert.rejects(invokeDbt(request({}, controller.signal), 'compile'), /superseded/);
    });

    // DBT_E2E_BINARIES=/path/to/dbt-core:/path/to/dbt runs each real dbt once. A parse connects to nothing
    for (const binary of (process.env.DBT_E2E_BINARIES ?? '').split(path.delimiter).filter(Boolean)) {
        test(`a real dbt parses the example Project: ${binary}`, async function () {
            this.timeout(60_000);
            const root = exampleProjectRoot('dbt');
            const invocation = await invokeDbt({ root, options: options({ binary, artifactDir: path.join(dir, `e2e-${path.basename(binary)}`), profilesDir: root }), logger, signal: new AbortController().signal }, 'parse');
            assert.strictEqual(invocation.exitCode, 0, invocation.stdout + invocation.stderr);
            assert.strictEqual(JSON.parse(fs.readFileSync(invocation.manifestPath!, 'utf8')).metadata.project_name, 'xf_example');
            assert.doesNotThrow(() => invocation.stdout.trim().split('\n').map((line) => JSON.parse(line)));
            // The Project's own target/ is left alone
            assert.ok(!fs.existsSync(path.join(root, 'target', 'manifest.json')));
        });
    }
});
