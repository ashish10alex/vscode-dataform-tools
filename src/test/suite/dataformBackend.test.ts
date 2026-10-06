import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import type { BackendRequest } from '../../backend';
import { affectsCompile, backendParts } from '../../backend';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import type { DataformOptions } from '../../backend/dataform/options';
import { actionsInFile, dependenciesOf, dryRunScripts, hasIncrementalVariant, homeAction, isMadeUpTarget, isRunnable, sectionsFor } from '../../shared/compiledGraph';
import type { DataformCompiledJson } from '../../types';
import { findProjectRoot } from './helper';

// xf's example Project (examples/dataform), compiled on macOS and on Windows, whole and with an error in it
function fixture(name: string): DataformCompiledJson {
    return JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'xf-examples', `${name}.json`), 'utf8'));
}

const PROJECT = 'alex-personal-dev-01';
const titles = (sections: Array<{ title: string }>) => sections.map((section) => section.title);

suite('Dataform Backend: the Compiled Graph of the example Project', () => {
    const graph = buildDataformGraph(fixture('dataform'));
    const get = (id: string) => {
        const action = graph.actions[`${PROJECT}.${id}`];
        assert.ok(action, `no action ${id}`);
        return action;
    };

    test('every action is in the graph, with its Kind', () => {
        const kinds: Record<string, number> = {};
        for (const action of Object.values(graph.actions)) {
            kinds[action.kind] = (kinds[action.kind] ?? 0) + 1;
        }
        assert.deepStrictEqual(kinds, { table: 3, view: 5, incremental: 1, operation: 2, assertion: 6, declaration: 3 });
    });

    test('a table carries its file, tags, description and columns', () => {
        const customers = get('xf_example.dim_customers');
        assert.strictEqual(customers.kind, 'table');
        assert.strictEqual(customers.fileName, 'definitions/marts/dim_customers.sqlx');
        assert.strictEqual(customers.sqlPresent, true);
        assert.ok(customers.description);
        assert.ok(customers.columns?.length);
        assert.deepStrictEqual(titles(customers.sections), ['pre_operations', 'query', 'post_operations']);
        assert.deepStrictEqual(customers.sections.map((section) => section.dryRun), [true, true, false]);
        assert.strictEqual(get('xf_example.legacy_orders').disabled, true);
        assert.strictEqual(customers.disabled, undefined);
    });

    test('one file can define several actions', () => {
        const views = actionsInFile(graph, 'definitions/reports/orders_by_country.js');
        assert.deepStrictEqual(views.map((view) => [view.kind, view.target.name]), [['view', 'orders_gb'], ['view', 'orders_us']]);
        assert.ok(views[0].sections[0].sql.includes('country_code = "gb"'));
    });

    test('an incremental table has both variants, each dry-run after its own pre-operations', () => {
        const orders = get('xf_example.fct_orders');
        assert.strictEqual(hasIncrementalVariant(orders), true);
        assert.deepStrictEqual(titles(sectionsFor(orders, false)), ['pre_operations', 'query']);
        assert.deepStrictEqual(titles(sectionsFor(orders, true)), ['incremental pre_operations', 'incremental query']);
        const [full, incremental] = dryRunScripts(orders);
        assert.deepStrictEqual([full.label, incremental.label], ['full', 'incremental']);
        assert.ok(full.sql.startsWith('DECLARE since DATE') && !full.sql.includes('WHERE o.order_date > since'));
        assert.ok(incremental.sql.includes('SELECT MAX(order_date)') && incremental.sql.includes('WHERE o.order_date > since'));
        assert.deepStrictEqual(full.parts.map((part) => part.source), ['pre_operations', 'query']);
    });

    test('an operation lists its statements and says whether it creates its table', () => {
        const audit = get('xf_example.audit_log');
        assert.strictEqual(audit.kind, 'operation');
        assert.strictEqual(audit.hasOutput, true);
        assert.deepStrictEqual(titles(audit.sections), ['operation 1/2', 'operation 2/2']);
        assert.strictEqual(dryRunScripts(audit).length, 1);
        const udf = get('xf_example.create_udf');
        assert.strictEqual(udf.hasOutput, undefined);
        assert.ok(udf.sections[0].sql.includes('`alex-personal-dev-01.xf_example.cents_to_dollars`'));
    });

    test('an assertion generated from a table points at it and is listed after it; a manual one points nowhere', () => {
        const generated = get('xf_example_assertions.xf_example_dim_customers_assertions_uniqueKey_0');
        assert.strictEqual(generated.kind, 'assertion');
        assert.strictEqual(generated.parent?.name, 'dim_customers');
        assert.deepStrictEqual(
            actionsInFile(graph, 'definitions/marts/dim_customers.sqlx').map((action) => action.kind),
            ['table', 'assertion', 'assertion']
        );
        assert.strictEqual(get('xf_example_assertions.assert_positive_order_totals').parent, undefined);
        // An assertion is not a dbt test: it is shown with its file, not with a home action
        assert.strictEqual(homeAction(graph, generated), undefined);
    });

    test('a declaration has no SQL and cannot be run, and dependencies resolve to it', () => {
        const payments = get('xf_example.stg_payments');
        const sources = dependenciesOf(graph, payments.id);
        assert.deepStrictEqual(sources.map((source) => source.kind), ['declaration']);
        assert.deepStrictEqual(sources[0].sections, []);
        assert.strictEqual(isRunnable(sources[0]), false);
        assert.ok(!Object.values(graph.actions).some((action) => action.kind === 'unknown'));
    });

    for (const name of ['dataform', 'dataform-broken']) {
        test(`${name}: compiled on Windows it names the same files, with forward slashes`, () => {
            const mac = buildDataformGraph(fixture(name));
            const windows = buildDataformGraph(fixture(`${name}-windows`));
            assert.deepStrictEqual(Object.keys(windows.actions).sort(), Object.keys(mac.actions).sort());
            for (const [id, action] of Object.entries(mac.actions)) {
                assert.strictEqual(windows.actions[id].fileName, action.fileName, id);
            }
            assert.deepStrictEqual(Object.keys(windows.files).sort(), Object.keys(mac.files).sort());
        });
    }
});

suite('Dataform Backend: what xf leaves out', () => {
    const compiled = {
        tables: [
            {
                type: 'incremental',
                target: { database: 'p', schema: 'ds', name: 'events' },
                fileName: 'definitions\\events.sqlx',
                query: 'select 1',
                incrementalQuery: 'select 1 where true',
                postOps: ['grant select on t to x'],
                dependencyTargets: [],
            },
        ],
        notebooks: [{ target: { database: 'p', schema: 'ds', name: 'nb' }, fileName: 'definitions/nb.ipynb', notebookContents: '{"cells":[]}', tags: ['daily'], dependencyTargets: [] }],
        propertyGraphs: [{ target: { database: 'p', schema: 'ds', name: 'pg' }, fileName: 'definitions/pg.yaml', graphBody: 'NODE TABLES (a)', dependencyTargets: [] }],
        tests: [{ name: 'events_total', fileName: 'definitions/tests/events_total.sqlx', testQuery: 'select 1 as n', expectedOutputQuery: 'select 1 as n' }],
    } as unknown as DataformCompiledJson;
    const graph = buildDataformGraph(compiled);

    test('a unit test is an action of Kind "unit test" with a made-up Target', () => {
        const unit = graph.actions['unit test.events_total'];
        assert.strictEqual(unit.kind, 'unit test');
        assert.strictEqual(isMadeUpTarget(unit.target), true);
        assert.strictEqual(unit.fileName, 'definitions/tests/events_total.sqlx');
        assert.deepStrictEqual(titles(unit.sections), ['test query', 'expected output']);
        // `dataform run` cannot run it
        assert.strictEqual(isRunnable(unit), false);
    });

    test("a unit test's two queries are dry-run apart, as they are today", () => {
        const scripts = dryRunScripts(graph.actions['unit test.events_total']);
        assert.deepStrictEqual(scripts.map((script) => [script.label, script.sql]), [['test query', 'select 1 as n'], ['expected output', 'select 1 as n']]);
    });

    test('post-operations are shown and not dry-run, and the incremental run falls back to them', () => {
        const events = graph.actions['p.ds.events'];
        assert.strictEqual(events.fileName, 'definitions/events.sqlx');
        assert.deepStrictEqual(titles(sectionsFor(events, true)), ['incremental query', 'incremental post_operations']);
        assert.deepStrictEqual(dryRunScripts(events).map((script) => script.sql), ['select 1', 'select 1 where true']);
    });

    test('a notebook and a property graph show their contents and have nothing to dry-run', () => {
        const notebook = graph.actions['p.ds.nb'];
        assert.deepStrictEqual([notebook.kind, titles(notebook.sections), notebook.tags], ['notebook', ['notebook'], ['daily']]);
        const propertyGraph = graph.actions['p.ds.pg'];
        assert.deepStrictEqual([propertyGraph.kind, titles(propertyGraph.sections)], ['property graph', ['property graph']]);
        assert.deepStrictEqual([...dryRunScripts(notebook), ...dryRunScripts(propertyGraph)], []);
    });
});

suite('Dataform Backend: compile', () => {
    const options = { compilationMode: 'cli', compilerOptions: '', compileTimeout: '5m', persistCompilation: false, api: {} } as DataformOptions;
    const request = (signal = new AbortController().signal): BackendRequest<DataformOptions> => ({
        root: '/work/shop',
        options,
        logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
        signal,
    });

    test('a compile gives the graph, and keeps the raw result for Dataform-only features', async () => {
        const compiled = fixture('dataform');
        const backend = new DataformBackend(async () => ({ compiled }));
        assert.strictEqual(backend.rawResult, undefined);
        const result = await backend.compile(request());
        assert.strictEqual(Object.keys(result.graph.actions).length, 20);
        assert.deepStrictEqual(result.errors, []);
        assert.strictEqual(backend.rawResult, compiled);
    });

    test('a result with errors gives both the graph and the errors', async () => {
        const backend = new DataformBackend(async () => ({ compiled: fixture('dataform-broken-windows') }));
        const result = await backend.compile(request());
        assert.ok(Object.keys(result.graph.actions).length > 0);
        assert.ok(result.errors.length > 0);
        for (const error of result.errors) {
            assert.strictEqual(error.fileName, 'definitions/order_totals.sqlx');
            assert.ok(error.message.includes('order_lines'));
        }
    });

    test('a compile with no result gives an empty graph and the errors, and keeps the last raw result', async () => {
        const compiled = fixture('dataform');
        const outcomes = [{ compiled }, { errors: [{ message: 'Unexpected token', fileName: 'definitions\\a.sqlx', stack: '/tmp/x/definitions/a.sqlx:10\n  oops\n\nSyntaxError' }] }];
        const backend = new DataformBackend(async () => outcomes.shift()!);
        await backend.compile(request());
        const failed = await backend.compile(request());
        assert.deepStrictEqual(failed.graph.actions, {});
        assert.deepStrictEqual(failed.errors, [{ message: 'Unexpected token', fileName: 'definitions/a.sqlx', line: 10 }]);
        assert.strictEqual(backend.rawResult, compiled);
    });

    test('it fails outright only when the compile itself does, or was cancelled', async () => {
        const broken = new DataformBackend(async () => { throw new Error('spawn dataform ENOENT'); });
        await assert.rejects(broken.compile(request()), /ENOENT/);

        const controller = new AbortController();
        const backend = new DataformBackend(async () => {
            controller.abort(new Error('superseded'));
            return { compiled: fixture('dataform') };
        });
        await assert.rejects(backend.compile(request(controller.signal)), /superseded/);
        assert.strictEqual(backend.rawResult, undefined);
    });

    test('it names the files that affect a compile', () => {
        const backend = new DataformBackend(async () => ({}));
        const { compileFiles, name } = backend;
        assert.strictEqual(name, 'dataform');
        assert.strictEqual(affectsCompile(compileFiles, 'definitions/marts/orders.sqlx'), true);
        assert.strictEqual(affectsCompile(compileFiles, 'workflow_settings.yaml'), true);
        assert.strictEqual(affectsCompile(compileFiles, 'README.md'), false);
        // The runner is piece 2.6, Changed Actions piece 2.5
        assert.deepStrictEqual(backendParts(backend), { runner: false, changes: false });
    });
});
