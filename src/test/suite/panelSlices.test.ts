import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import type { Backend } from '../../backend';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import type { DryRunResult } from '../../bigquery/dryRunService';
import { SliceSender } from '../../panel/sliceSender';
import { bigQuerySlice, compileStatusSlice, fileSlice, projectSlice, runStatusSlice } from '../../panel/slices';
import { Action, buildCompiledGraph, madeUpTarget, targetId, titledSections } from '../../shared/compiledGraph';
import type { HostMessage } from '../../shared/panelContract';
import { findProjectRoot } from './helper';

const dataform = new DataformBackend(async () => ({}));
const graph = buildDataformGraph(JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'xf-examples', 'dataform.json'), 'utf8')));
const PROJECT = 'alex-personal-dev-01';

suite('panel slices: project', () => {
    test('names the root, the Backend, its optional parts and the tags of the Project', () => {
        const slice = projectSlice({ root: '/work/shop' }, dataform, graph, 4);
        assert.strictEqual(slice.compile, 4);
        assert.deepStrictEqual([slice.root, slice.backend, slice.parts], ['/work/shop', 'dataform', { runner: true, changes: false }]);
        assert.deepStrictEqual(slice.tags, [...new Set(Object.values(graph.actions).flatMap((action) => action.tags))].sort());
        assert.ok(slice.tags.length > 0);
    });

    test('before the first compile there are no tags', () => {
        assert.deepStrictEqual(projectSlice({ root: '/work/shop' }, dataform, undefined, 0).tags, []);
    });
});

suite('panel slices: file', () => {
    test('a file with a table and its assertions: each action with its SQL and its neighbours', () => {
        const slice = fileSlice(graph, dataform, 'definitions/marts/dim_customers.sqlx', 2);
        assert.deepStrictEqual([slice.compile, slice.file, slice.role], [2, 'definitions/marts/dim_customers.sqlx', 'actions']);
        assert.deepStrictEqual(slice.actions.map((action) => action.kind), ['table', 'assertion', 'assertion']);

        const [table, assertion] = slice.actions;
        assert.strictEqual(table.id, `${PROJECT}.xf_example.dim_customers`);
        assert.deepStrictEqual([table.buildsNothing, table.buildsTable, table.runnable, table.sqlPresent, table.disabled], [false, true, true, true, false]);
        assert.ok(table.description && table.columns?.length);
        assert.deepStrictEqual(table.sections.map((section) => section.title), ['pre_operations', 'query', 'post_operations']);
        // Neighbours are named, not sent whole
        assert.ok(table.dependencies.length > 0 && table.dependents.length > 0);
        for (const neighbour of [...table.dependencies, ...table.dependents]) {
            assert.deepStrictEqual(Object.keys(neighbour).sort(), ['fileName', 'kind', 'target']);
        }
        assert.ok(assertion.dependencies.some((dependency) => dependency.target.name === 'dim_customers'));
    });

    test('an operation builds a table only when it says it has output', () => {
        const builds = (file: string) => fileSlice(graph, dataform, file, 1).actions[0].buildsTable;
        assert.deepStrictEqual([builds('definitions/operations/audit_log.sqlx'), builds('definitions/operations/create_udf.sqlx')], [true, false]);
    });

    test('actions a file registers are shown after its own, once each', () => {
        const stgPayments = `${PROJECT}.xf_example.stg_payments`;
        const slice = fileSlice(graph, dataform, 'definitions/marts/legacy_orders.sqlx', 1, [stgPayments, `${PROJECT}.xf_example.legacy_orders`, 'no.such.action']);
        assert.deepStrictEqual(slice.actions.map((action) => action.target.name), ['legacy_orders', 'stg_payments']);
        // A file whose only actions are registered ones still shows them
        assert.deepStrictEqual(fileSlice(graph, dataform, 'includes/helpers.js', 1, [stgPayments]).role, 'actions');
    });

    test('its size does not grow with the Project', () => {
        const whole = JSON.stringify(graph).length;
        const slice = JSON.stringify(fileSlice(graph, dataform, 'definitions/staging/stg_payments.sqlx', 1)).length;
        assert.ok(slice < whole / 5, `${slice} of ${whole} characters`);
    });

    test('a file that defines no action says what it is to the Project', () => {
        const role = (file: string) => fileSlice(graph, dataform, file, 1).role;
        assert.strictEqual(role('workflow_settings.yaml'), 'project settings');
        assert.strictEqual(role('dataform.json'), 'project settings');
        assert.strictEqual(role('includes/helpers.js'), 'helper');
        assert.strictEqual(role('README.md'), 'not compiled');
        assert.strictEqual(role('scripts/load.py'), 'not compiled');
        // A settings file is one only at the root
        assert.strictEqual(role('definitions/workflow_settings.yaml'), 'helper');
        assert.deepStrictEqual(fileSlice(graph, dataform, 'README.md', 1).actions, []);
        assert.strictEqual(fileSlice(undefined, dataform, 'definitions/marts/dim_customers.sqlx', 0).role, 'helper');
    });

    test('a dbt model is shown with the tests that read it, though they are defined elsewhere', () => {
        const target = (name: string) => ({ database: 'p', schema: 'ds', name });
        const action = (kind: Action['kind'], name: string, rest: Partial<Action> = {}): Action => ({
            id: targetId(rest.target ?? target(name)), target: target(name), kind, fileName: `models/${name}.sql`, tags: [],
            sections: titledSections('query', ['select 1'], { compiled: true, dryRun: ['query'] }), sqlPresent: true, dependencyTargets: [], ...rest,
        });
        const dbtGraph = buildCompiledGraph([
            action('table', 'orders'),
            action('test', 'not_null_orders_id', { fileName: 'models/schema.yml', dependencyTargets: [target('orders')], parent: target('orders') }),
            action('unit test', 'orders_total', { target: madeUpTarget('unit test', 'orders_total'), fileName: 'models/unit.yml', dependencyTargets: [target('orders')], parent: target('orders'), sections: [] }),
            action('table', 'customers'),
        ]);
        const dbt = { name: 'dbt', compileFiles: { skip: ['target'], extensions: ['.sql', '.yml'], rootFiles: ['dbt_project.yml'] }, compile: async () => ({ graph: dbtGraph, errors: [] }) } as Backend<never>;
        const slice = fileSlice(dbtGraph, dbt, 'models/orders.sql', 1);
        assert.deepStrictEqual(slice.actions.map((shown) => [shown.kind, shown.target.name, shown.fileName]), [
            ['table', 'orders', 'models/orders.sql'],
            ['test', 'not_null_orders_id', 'models/schema.yml'],
            ['unit test', 'orders_total', 'models/unit.yml'],
        ]);
        assert.strictEqual(slice.actions[2].buildsNothing, true);
        assert.strictEqual(fileSlice(dbtGraph, dbt, 'dbt_project.yml', 1).role, 'project settings');
        assert.strictEqual(fileSlice(dbtGraph, dbt, 'macros/cents.sql', 1).role, 'helper');
        assert.strictEqual(fileSlice(dbtGraph, dbt, 'target/compiled/orders.sql', 1).role, 'not compiled');
    });
});

suite('panel slices: compile status', () => {
    const error = { message: 'Could not resolve "order_lines"', fileName: 'definitions/order_totals.sqlx' };
    const compiled = { compiledAt: 1000, durationMs: 250 };

    test('is exactly one of seven values, each with only its own details', () => {
        const none = { inProject: true, errors: [] };
        assert.deepStrictEqual(compileStatusSlice({ inProject: false, errors: [] }, 0), { compile: 0, status: 'no project' });
        assert.deepStrictEqual(compileStatusSlice({ ...none, missingTool: { tool: 'dbt', lookedIn: ['.venv', 'PATH'] } }, 0), { compile: 0, status: 'tool not found', tool: 'dbt', lookedIn: ['.venv', 'PATH'] });
        assert.deepStrictEqual(compileStatusSlice({ ...none, unsupportedVersion: { tool: 'dbt', version: '1.7.4', message: 'dbt-core 1.8 or later is needed' } }, 0), {
            compile: 0, status: 'version unsupported', tool: 'dbt', version: '1.7.4', message: 'dbt-core 1.8 or later is needed',
        });
        assert.deepStrictEqual(compileStatusSlice({ ...none, compiling: { showingPrevious: true, startedAt: 500, command: 'dbt compile' }, compiled }, 3), {
            compile: 3, status: 'compiling', showingPrevious: true, startedAt: 500, command: 'dbt compile',
        });
        assert.deepStrictEqual(compileStatusSlice({ ...none, compiled }, 3), { compile: 3, status: 'compiled', compiledAt: 1000, durationMs: 250, errors: [] });
        assert.deepStrictEqual(compileStatusSlice({ ...none, compiled: { compiledAt: 1000, notice: 'on-run hooks' } }, 3), {
            compile: 3, status: 'parsed only', compiledAt: 1000, notice: 'on-run hooks', errors: [],
        });
        assert.deepStrictEqual(compileStatusSlice({ inProject: true, errors: [error] }, 3), { compile: 3, status: 'failed', errors: [error] });
    });

    test('a compile that left a graph and errors is compiled, with its errors', () => {
        assert.deepStrictEqual(compileStatusSlice({ inProject: true, compiled: { compiledAt: 1000 }, errors: [error] }, 5), { compile: 5, status: 'compiled', compiledAt: 1000, errors: [error] });
    });

    test('a missing tool is said before anything about an old compile', () => {
        const status = compileStatusSlice({ inProject: true, missingTool: { tool: 'dataform', lookedIn: [] }, compiled, errors: [error] }, 2);
        assert.strictEqual(status.status, 'tool not found');
    });
});

suite('panel slices: BigQuery results and run status', () => {
    const result = (compile: number, script = 'query'): DryRunResult => ({ action: 'p.ds.orders', script, incremental: false, sections: [script], compile, sql: 'select 1', bytes: 10 });

    test('only the results of the compile on show are sent', () => {
        const slice = bigQuerySlice({ results: [result(6), result(7), result(7, 'post_operations')], dryRunning: [{ action: 'p.ds.customers', script: 'query', incremental: false }] }, 7);
        assert.deepStrictEqual(slice.results.map((sent) => [sent.compile, sent.script]), [[7, 'query'], [7, 'post_operations']]);
        assert.deepStrictEqual(slice.dryRunning, [{ action: 'p.ds.customers', script: 'query', incremental: false }]);
        assert.deepStrictEqual([slice.compile, slice.tables, slice.currencySymbol], [7, {}, '$']);
    });

    test('the state of the tables and the currency are passed on', () => {
        const tables = { 'p.ds.orders': { lastModified: '06 Oct 2026 10:00', modifiedToday: true } };
        assert.deepStrictEqual(bigQuerySlice({ results: [], tables, currencySymbol: '£' }, 1), { compile: 1, results: [], dryRunning: [], tables, currencySymbol: '£' });
    });

    test('the run status is the last run through the runner, or nothing', () => {
        assert.deepStrictEqual(runStatusSlice(undefined, 2), { compile: 2 });
        const lastRun = { request: { actions: ['p.ds.orders'], tags: [], includeDependencies: true, includeDependents: false, fullRefresh: false }, command: 'dbt build --select +shop.orders', startedAt: 99 };
        assert.deepStrictEqual(runStatusSlice(lastRun, 2), { compile: 2, lastRun });
    });
});

suite('panel slices: sent only when changed', () => {
    test('a slice that is the same as the panel has is not sent again', () => {
        const posted: HostMessage[] = [];
        const sender = new SliceSender((message) => posted.push(message));
        const project = () => projectSlice({ root: '/work/shop' }, dataform, graph, 1);

        assert.strictEqual(sender.send('project', project()), true);
        assert.strictEqual(sender.send('project', project()), false);
        assert.strictEqual(sender.send('file', fileSlice(graph, dataform, 'definitions/staging/stg_orders.sqlx', 1)), true);
        assert.deepStrictEqual(posted.map((message) => message.slice), ['project', 'file']);

        // A new compile changes the slice, so it goes again
        assert.strictEqual(sender.send('project', projectSlice({ root: '/work/shop' }, dataform, graph, 2)), true);
        // A dry-run result arriving resends the results, not the SQL
        assert.strictEqual(sender.send('file', fileSlice(graph, dataform, 'definitions/staging/stg_orders.sqlx', 1)), false);
        assert.strictEqual(sender.send('bigquery', bigQuerySlice({ results: [] }, 1)), true);
        assert.deepStrictEqual(posted.map((message) => message.slice), ['project', 'file', 'project', 'bigquery']);
    });

    test('after the panel is reloaded everything is sent again', () => {
        const posted: HostMessage[] = [];
        const sender = new SliceSender((message) => posted.push(message));
        sender.send('run status', runStatusSlice(undefined, 1));
        sender.reset();
        assert.strictEqual(sender.send('run status', runStatusSlice(undefined, 1)), true);
        assert.strictEqual(posted.length, 2);
    });
});
