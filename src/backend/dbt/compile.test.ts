import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, setup, test } from 'mocha';
import { DbtCompiler, hookFingerprint } from './compile';
import { exampleProjectRoot, fullManifestPath, readDbtLog } from './fixtures';
import type { DbtOptions } from './options';
import { probeDbt } from './probe';

const logger = { info: () => undefined, debug: () => undefined, error: () => undefined };
const P = 'alex-personal-dev-01';

suite('compiling a dbt Project', () => {
    let dir: string;
    let fake: string;
    let root: string;
    /** What the stand-in does for a command: the manifest it writes, what it prints, its exit status */
    const plan = (command: 'parse' | 'compile', what: { manifest?: string; stdout?: string; exit?: number }) => {
        for (const suffix of ['json', 'stdout', 'exit']) {
            fs.rmSync(path.join(dir, `${command}.${suffix}`), { force: true });
        }
        if (what.manifest) {
            fs.copyFileSync(what.manifest, path.join(dir, `${command}.json`));
        }
        fs.writeFileSync(path.join(dir, `${command}.stdout`), what.stdout ?? '');
        fs.writeFileSync(path.join(dir, `${command}.exit`), String(what.exit ?? 0));
    };
    /** The commands the stand-in was run with, each as its command and what came after the common arguments */
    const ran = (): string[][] => fs.existsSync(path.join(dir, 'ran.jsonl'))
        ? fs.readFileSync(path.join(dir, 'ran.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]).map((args) => [args[0], ...args.slice(10)])
        : [];
    const request = (overrides: Partial<DbtOptions> & { file?: string; withFiles?: string[] } = {}) => {
        const { file, withFiles, ...options } = overrides;
        return {
            root,
            file,
            withFiles,
            options: { binary: fake, flavour: 'dbt v2' as const, label: 'dbt 2.0.6', artifactDir: path.join(dir, 'artifacts'), env: { ...process.env, FAKE_DBT_DIR: dir }, ...options },
            logger,
            signal: new AbortController().signal,
        };
    };

    suiteSetup(function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-compile-')));
        root = path.join(dir, 'project');
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, 'dbt_project.yml'), 'name: shop\n');
        fake = path.join(dir, 'fake-dbt');
        fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), dir = process.env.FAKE_DBT_DIR;
fs.appendFileSync(path.join(dir, 'ran.jsonl'), JSON.stringify(args) + '\\n');
const target = args[args.indexOf('--target-path') + 1];
const planned = (suffix) => path.join(dir, args[0] + '.' + suffix);
if (fs.existsSync(planned('json'))) {
    fs.mkdirSync(target, { recursive: true });
    fs.copyFileSync(planned('json'), path.join(target, 'manifest.json'));
}
process.stdout.write(fs.readFileSync(planned('stdout'), 'utf8'));
process.exitCode = Number(fs.readFileSync(planned('exit'), 'utf8'));
`, { mode: 0o755 });
    });

    setup(() => {
        fs.rmSync(path.join(dir, 'ran.jsonl'), { force: true });
    });

    suiteTeardown(() => {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    suite('dbt v2', () => {
        test('parses first, and compiles only the actions of the file on show when the Project has no on-run hook', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2') });
            plan('compile', { manifest: fullManifestPath('dbt-v2') });
            const compiler = new DbtCompiler();
            const result = await compiler.compile(request({ file: 'models/marts/fct_orders.sql' }));
            const selected = ['compile', '--select', `path:${path.join('models', 'marts', 'fct_orders.sql')}`];
            assert.deepStrictEqual(ran(), [['parse'], selected]);
            assert.deepStrictEqual(result.commands.map((args) => args[0]), ['parse', 'compile']);
            assert.strictEqual(result.parsedOnly, false);
            assert.strictEqual(result.notice, undefined);
            assert.deepStrictEqual(result.errors, []);
            assert.strictEqual(result.graph.actions[`${P}.xf_example.fct_orders`].sqlPresent, true);
            assert.strictEqual(result.dbt?.projectName, 'xf_example');

            // The parse is not repeated while the files that could add a hook are as they were
            await compiler.compile(request({ file: 'models/marts/fct_orders.sql' }));
            assert.deepStrictEqual(ran(), [['parse'], selected, selected]);
            const later = new Date(Date.now() + 5000);
            fs.utimesSync(path.join(root, 'dbt_project.yml'), later, later);
            await compiler.compile(request({ file: 'models/marts/fct_orders.sql' }));
            assert.deepStrictEqual(ran().slice(3), [['parse'], selected]);
        });

        test('the files asked for with the file on show are selected with it', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2') });
            plan('compile', { manifest: fullManifestPath('dbt-v2') });
            await new DbtCompiler().compile(request({ file: 'tests/assert_positive_order_totals.sql', withFiles: ['models/marts/fct_orders.sql'] }));
            assert.deepStrictEqual(ran().at(-1), ['compile', '--select', `path:${path.join('tests', 'assert_positive_order_totals.sql')}`, `path:${path.join('models', 'marts', 'fct_orders.sql')}`]);
        });

        test('with no file on show it parses once, and never compiles the whole Project', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2') });
            const compiler = new DbtCompiler();
            const result = await compiler.compile(request());
            assert.deepStrictEqual(ran(), [['parse']]);
            assert.deepStrictEqual([result.parsedOnly, result.notice], [false, undefined]);
            // Known to have no hook, it is parsed all the same
            await compiler.compile(request());
            assert.deepStrictEqual(ran(), [['parse'], ['parse']]);
        });

        test('a Project with on-run hooks is left parsed, and the notice says why', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2-hooks-parsed') });
            plan('compile', { manifest: fullManifestPath('dbt-v2') });
            const compiler = new DbtCompiler();
            const result = await compiler.compile(request());
            assert.deepStrictEqual(ran(), [['parse']]);
            assert.strictEqual(result.parsedOnly, true);
            assert.strictEqual(result.notice, 'SQL not compiled: dbt 2.0.6 runs on-run-start and on-run-end hooks when it compiles, and this Project has 2 (in dbt_project.yml).');
            assert.strictEqual(result.graph.actions[`${P}.xf_example.order_amounts`].sqlPresent, false);
            // Asked again, it is parsed again: nothing was learnt that rules hooks out
            await compiler.compile(request());
            assert.deepStrictEqual(ran(), [['parse'], ['parse']]);
        });

        test('with compileWithHooks it compiles the file on show without parsing first', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2-hooks-parsed') });
            plan('compile', { manifest: fullManifestPath('dbt-v2') });
            const result = await new DbtCompiler().compile(request({ compileWithHooks: true, file: 'models/orders.sql' }));
            assert.deepStrictEqual(ran(), [['compile', '--select', `path:${path.join('models', 'orders.sql')}`]]);
            assert.strictEqual(result.parsedOnly, false);
            assert.strictEqual(result.notice, undefined);
        });

        test('errors come with the graph of what did parse, and nothing is compiled', async () => {
            const broken = path.join(dir, 'broken.json');
            fs.copyFileSync(path.join(path.dirname(fullManifestPath('dbt-v2')), '..', 'xf-examples', 'dbt-v2-broken.json'), broken);
            plan('parse', { manifest: broken, stdout: readDbtLog('dbt-v2-broken').stdout, exit: 1 });
            const result = await new DbtCompiler().compile(request());
            assert.deepStrictEqual(ran(), [['parse']]);
            assert.strictEqual(result.parsedOnly, true);
            assert.deepStrictEqual(result.errors.map((error) => [error.fileName, error.line, error.code]), [['models/order_totals.sql', 4, 'dbt1048']]);
            // dbt v2 says which dbt target it used even when it fails
            assert.strictEqual(result.target, 'dev');
            assert.deepStrictEqual(Object.keys(result.graph.actions).sort(), [`${P}.xf_example.order_totals`, `${P}.xf_example.orders`]);
            assert.strictEqual(result.notice, undefined);
        });

        test('errors of a compile that still wrote a manifest come with its graph', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-v2') });
            plan('compile', { manifest: fullManifestPath('dbt-v2'), stdout: readDbtLog('dbt-v2-macro').stdout, exit: 1 });
            const result = await new DbtCompiler().compile(request({ file: 'models/marts/fct_orders.sql' }));
            assert.deepStrictEqual(result.errors.map((error) => error.code), ['dbt1501']);
            assert.strictEqual(result.graph.actions[`${P}.xf_example.fct_orders`].sqlPresent, true);
        });
    });

    suite('dbt-core', () => {
        test("compiles only the actions of the file on show, by its path", async () => {
            plan('compile', { manifest: fullManifestPath('dbt-core') });
            const result = await new DbtCompiler().compile(request({ flavour: 'dbt-core', file: 'models/marts/fct_orders.sql' }));
            assert.deepStrictEqual(ran(), [['compile', '--select', `path:${path.join('models', 'marts', 'fct_orders.sql')}`]]);
            assert.strictEqual(result.parsedOnly, false);
            assert.strictEqual(result.dbt?.dbtVersion, '1.12.5');
        });

        test('with no file on show it parses, and never compiles the whole Project', async () => {
            plan('parse', { manifest: fullManifestPath('dbt-core-hooks-parsed') });
            const result = await new DbtCompiler().compile(request({ flavour: 'dbt-core' }));
            assert.deepStrictEqual(ran(), [['parse']]);
            // Its hooks do not matter: dbt-core does not run them when it compiles
            assert.strictEqual(result.notice, undefined);
            assert.strictEqual(result.parsedOnly, false);
        });

        test('an error that left no manifest comes with an empty graph', async () => {
            plan('compile', { stdout: readDbtLog('dbt-core-broken').stdout, exit: 2 });
            const result = await new DbtCompiler().compile(request({ flavour: 'dbt-core', file: 'models/orders.sql' }));
            assert.deepStrictEqual(result.graph.actions, {});
            assert.strictEqual(result.dbt, undefined);
            assert.deepStrictEqual(result.errors.map((error) => error.fileName), ['models/order_totals.sql']);
        });
    });

    test('rejects when dbt left neither a manifest nor an error to show', async () => {
        plan('parse', { exit: 0 });
        await assert.rejects(new DbtCompiler().compile(request({ flavour: 'dbt-core' })), /parse wrote no manifest/);
        plan('parse', { exit: 3 });
        await assert.rejects(new DbtCompiler().compile(request({ flavour: 'dbt-core' })), /parse failed with exit status 3 and reported no error/);
    });

    test("the hook files' fingerprint follows the Project's and its packages' dbt_project.yml", () => {
        const project = fs.mkdtempSync(path.join(dir, 'fingerprint-'));
        const before = hookFingerprint(project);
        fs.writeFileSync(path.join(project, 'dbt_project.yml'), 'name: a\n');
        const withProject = hookFingerprint(project);
        assert.notStrictEqual(withProject, before);
        fs.mkdirSync(path.join(project, 'dbt_packages', 'utils'), { recursive: true });
        fs.writeFileSync(path.join(project, 'dbt_packages', 'utils', 'dbt_project.yml'), 'name: utils\n');
        assert.notStrictEqual(hookFingerprint(project), withProject);
        assert.strictEqual(hookFingerprint(project), hookFingerprint(project));
    });

    // DBT_E2E_BINARIES=/path/to/dbt-core:/path/to/dbt runs each real dbt. Only parses, which connect to nothing:
    // dbt-core with no file on show, and dbt v2 on the Project with hooks, which must not be compiled
    for (const binary of (process.env.DBT_E2E_BINARIES ?? '').split(path.delimiter).filter(Boolean)) {
        test(`a real dbt parses the Project with hooks and runs none: ${binary}`, async function () {
            this.timeout(60_000);
            const probe = await probeDbt(binary);
            const project = exampleProjectRoot('dbt-hooks');
            const result = await new DbtCompiler().compile({
                root: project,
                options: { binary, flavour: probe.flavour, label: probe.label, artifactDir: path.join(dir, `e2e-${path.basename(binary)}`), profilesDir: project },
                logger,
                signal: new AbortController().signal,
            });
            assert.deepStrictEqual(result.commands.map((args) => args[0]), ['parse']);
            assert.deepStrictEqual(result.errors, []);
            assert.strictEqual(result.parsedOnly, probe.flavour === 'dbt v2');
            assert.strictEqual(!!result.notice, probe.flavour === 'dbt v2', result.notice);
            assert.strictEqual(Object.values(result.graph.actions).filter((action) => action.kind === 'operation').length, 2);
        });
    }
});
