import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { shellJoin } from '../shellQuote';
import { fullManifestPath } from './fixtures';
import { buildDbtGraph } from './graph';
import { dbtRunArguments, dbtRunCommand } from './run';

const P = 'alex-personal-dev-01';
const { names } = buildDbtGraph(JSON.parse(fs.readFileSync(fullManifestPath('dbt-core'), 'utf8'))).dbt;
const scope = { includeDependencies: false, includeDependents: false, fullRefresh: false };
const run = (overrides: Partial<Parameters<typeof dbtRunArguments>[0]['run']>) => ({ actions: [], tags: [], ...scope, ...overrides });
const options = { binary: 'dbt' };

suite('the command line of a dbt run', () => {
    test('builds the actions by their fully qualified names', () => {
        const actions = [`${P}.xf_example.fct_orders`, `${P}.xf_example.customer_segments_v2`, `${P}.xf_example_reference.country_codes`];
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ actions }) }, names), [
            'build', '--select', 'xf_example.marts.fct_orders', 'xf_example.marts.customer_segments.v2', 'xf_example.country_codes',
        ]);
    });

    test('adds what the selection reads from and what reads from it, and a full refresh', () => {
        const actions = [`${P}.xf_example.fct_orders`];
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ actions, includeDependencies: true }) }, names).slice(2), ['+xf_example.marts.fct_orders']);
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ actions, includeDependents: true, fullRefresh: true }) }, names).slice(2), ['xf_example.marts.fct_orders+', '--full-refresh']);
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ actions, includeDependencies: true, includeDependents: true }) }, names).slice(2), ['+xf_example.marts.fct_orders+']);
    });

    test('selects by tag instead when the run has tags', () => {
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ tags: ['daily', 'hourly'], includeDependencies: true }) }, names), ['build', '--select', '+tag:daily', '+tag:hourly']);
    });

    test('a run of what changed selects state:modified against the base', () => {
        const changed = { base: '/store/base/target' };
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ changed }) }, names), ['build', '--select', 'state:modified', '--state', '/store/base/target']);
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ changed, includeDependencies: true, includeDependents: true, fullRefresh: true }) }, names), [
            'build', '--select', '+state:modified+', '--state', '/store/base/target', '--full-refresh',
        ]);
    });

    test('kept to some actions, it selects those of them that still differ, each by its name', () => {
        const changed = { base: '/store/base/target' };
        const actions = [`${P}.xf_example.fct_orders`, `${P}.xf_example_reference.country_codes`];
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ changed, actions }) }, names), [
            'build', '--select', 'state:modified,xf_example.marts.fct_orders', 'state:modified,xf_example.country_codes', '--state', '/store/base/target',
        ]);
        // The + goes on both sides: what a changed action reads from is what it and the changes read from
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ changed, actions: [actions[0]], includeDependencies: true }) }, names).slice(2, 3), ['+state:modified,+xf_example.marts.fct_orders']);
        assert.deepStrictEqual(dbtRunArguments({ options, run: run({ changed, actions: [actions[0]], includeDependents: true }) }, names).slice(2, 3), ['state:modified+,xf_example.marts.fct_orders+']);
        assert.throws(() => dbtRunArguments({ options, run: run({ changed, actions: ['exposure.revenue_dashboard'] }) }, names), /dbt cannot select exposure\.revenue_dashboard/);
    });

    test('the base and an intersection are quoted for the shell that needs it', () => {
        const request = { root: '/work/shop', options: { binary: 'dbt' }, run: run({ changed: { base: '/Application Support/base/target' }, actions: [`${P}.xf_example.fct_orders`] }) };
        assert.strictEqual(dbtRunCommand(request, names, 'darwin'), `dbt build --select state:modified,xf_example.marts.fct_orders --state '/Application Support/base/target'`);
        assert.strictEqual(dbtRunCommand(request, names, 'win32'), `dbt build --select "state:modified,xf_example.marts.fct_orders" --state "/Application Support/base/target"`);
    });

    test('runs with the dbt target, variables and profiles directory of compiles', () => {
        const all = { binary: 'dbt', target: 'ci', vars: '{"day": "2024-01-01"}', profilesDir: '/work/profiles' };
        assert.deepStrictEqual(dbtRunArguments({ options: all, run: run({ tags: ['daily'] }) }, names).slice(3), [
            '--target', 'ci', '--vars', '{"day": "2024-01-01"}', '--profiles-dir', '/work/profiles',
        ]);
    });

    test('refuses what dbt cannot select', () => {
        assert.throws(() => dbtRunArguments({ options, run: run({ actions: ['exposure.revenue_dashboard', `${P}.xf_example.fct_orders`] }) }, names), /dbt cannot select exposure\.revenue_dashboard: no dbt name is known for it/);
        assert.throws(() => dbtRunArguments({ options, run: run({}) }, names), /Nothing to run/);
    });

    test('the command line can be pasted into a shell', () => {
        const request = { root: '/work/shop', options: { binary: 'dbt', target: 'ci', vars: '{"day": "2024-01-01"}' }, run: run({ actions: [`${P}.xf_example.fct_orders`], includeDependencies: true }) };
        assert.strictEqual(dbtRunCommand(request, names, 'darwin'), `dbt build --select +xf_example.marts.fct_orders --target ci --vars '{"day": "2024-01-01"}'`);
        assert.strictEqual(dbtRunCommand(request, names, 'win32'), `dbt build --select +xf_example.marts.fct_orders --target ci --vars '{"day": "2024-01-01"}'`);
    });

    test("names the Project's own dbt by its path from the root", () => {
        const root = path.resolve('/work/shop');
        const command = (binary: string) => dbtRunCommand({ root, options: { binary }, run: run({ tags: ['daily'] }) }, names, 'linux').split(' build')[0];
        assert.strictEqual(command(path.join(root, '.venv', 'bin', 'dbt')), path.join('.venv', 'bin', 'dbt'));
        assert.strictEqual(command(path.join(root, 'dbt')), `.${path.sep}dbt`);
        assert.strictEqual(command(path.resolve('/opt/homebrew/bin/dbt')), path.resolve('/opt/homebrew/bin/dbt'));
        assert.strictEqual(command('dbt'), 'dbt');
    });

    test('quoting, for POSIX shells and for PowerShell and cmd', () => {
        assert.strictEqual(shellJoin(['dbt', 'a b', "it's", '', 'tag:x', '+a.b+'], 'linux'), `dbt 'a b' 'it'\\''s' '' tag:x +a.b+`);
        assert.strictEqual(shellJoin(['dbt', 'a b', 'C:\\Program Files\\dbt.exe', '$x', "o'k \"q\"", ''], 'win32'), `dbt "a b" "C:\\Program Files\\dbt.exe" '$x' 'o''k "q"' ""`);
    });
});
