import * as assert from 'assert';
import fs from 'fs';
import { suite, test } from 'mocha';
import { Kind, buildsTable, dependenciesOf, dryRunScripts, hasIncrementalVariant, homeAction, isMadeUpTarget, isRunnable, siblingsOf } from '../../shared/compiledGraph';
import { fullManifestPath, readRecordedManifest } from './fixtures';
import { DbtGraph, DbtManifest, buildDbtGraph } from './graph';

const P = 'alex-personal-dev-01';

function kinds(result: DbtGraph): Partial<Record<Kind, number>> {
    const counts: Partial<Record<Kind, number>> = {};
    for (const action of Object.values(result.graph.actions)) {
        counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    }
    return counts;
}

const full = (name: Parameters<typeof fullManifestPath>[0]): DbtManifest => JSON.parse(fs.readFileSync(fullManifestPath(name), 'utf8'));

// The example Project compiled by each engine, as xf cut it down on macOS and on Windows (where dbt-core writes
// backslash paths), and as dbt wrote it: all give the same graph
const EXAMPLE: Array<[string, () => DbtManifest]> = [
    ['dbt-core', () => readRecordedManifest('dbt-core') as unknown as DbtManifest],
    ['dbt-v2', () => readRecordedManifest('dbt-v2') as unknown as DbtManifest],
    ['dbt-core-windows', () => readRecordedManifest('dbt-core-windows') as unknown as DbtManifest],
    ['dbt-v2-windows', () => readRecordedManifest('dbt-v2-windows') as unknown as DbtManifest],
    ['dbt-core, whole manifest', () => full('dbt-core')],
    ['dbt-v2, whole manifest', () => full('dbt-v2')],
];

suite('dbt manifest to Compiled Graph', () => {
    for (const [name, manifest] of EXAMPLE) {
        suite(name, () => {
            const result = buildDbtGraph(manifest());
            const { graph } = result;
            const get = (id: string) => {
                assert.ok(graph.actions[id], `no action ${id}`);
                return graph.actions[id];
            };
            const titles = (id: string) => get(id).sections.map((section) => section.title);
            const reads = (id: string) => dependenciesOf(graph, id).map((action) => action.id);

            test('every resource the panel shows has its Kind', () => {
                assert.deepStrictEqual(kinds(result), {
                    // dim_customers, customer_segments v1 and v2, revenue_report
                    table: 4, view: 3, incremental: 1, 'materialized view': 1, ephemeral: 1, seed: 1, snapshot: 1,
                    test: 12, 'unit test': 1, analysis: 1, source: 3, exposure: 1,
                });
            });

            test('an incremental model has one compiled query, which is dry-run', () => {
                const orders = get(`${P}.xf_example.fct_orders`);
                assert.strictEqual(orders.kind, 'incremental');
                assert.strictEqual(orders.fileName, 'models/marts/fct_orders.sql');
                assert.ok(orders.tags.includes('hourly'));
                assert.deepStrictEqual(titles(orders.id), ['query']);
                assert.match(orders.sections[0].sql, /from `alex-personal-dev-01`.`xf_example`.`stg_orders` as o/);
                assert.doesNotMatch(orders.sections[0].sql, /is_incremental/);
                assert.strictEqual(orders.sqlPresent, true);
                assert.strictEqual(hasIncrementalVariant(orders), false);
                assert.deepStrictEqual(dryRunScripts(orders).map((script) => script.name), ['query']);
                assert.deepStrictEqual(reads(orders.id), [`${P}.xf_example.stg_orders`, `${P}.xf_example.stg_payments`]);
            });

            test("a model's hooks are shown as written and are never dry-run", () => {
                const customers = get(`${P}.xf_example.dim_customers`);
                assert.deepStrictEqual(titles(customers.id), ['pre-hook', 'query', 'post-hook']);
                const [pre, query, post] = customers.sections;
                assert.deepStrictEqual([pre.compiled, query.compiled, post.compiled], [false, true, false]);
                assert.match(post.sql, /\{\{ this \}\}/);
                // Only the query: the hooks are Jinja, which BigQuery cannot plan
                assert.deepStrictEqual(dryRunScripts(customers).map((script) => script.parts.map((part) => part.source)), [['query']]);
            });

            test('documented columns come in the order the YAML lists them', () => {
                const columns = get(`${P}.xf_example.dim_customers`).columns ?? [];
                assert.deepStrictEqual(columns.map((column) => column.path), [['customer_id'], ['first_order_date'], ['lifetime_value']]);
            });

            test('a source stands for a table loaded elsewhere', () => {
                const source = get(`${P}.raw.customers`);
                assert.strictEqual(source.kind, 'source');
                assert.strictEqual(isRunnable(source), false);
                assert.deepStrictEqual(source.sections, []);
                assert.deepStrictEqual(reads(`${P}.xf_example.stg_customers`), [source.id]);
            });

            test('a data test and a unit test point at the model they test, and are shown with it', () => {
                const customers = get(`${P}.xf_example.dim_customers`);
                const unique = get(`${P}.xf_example_dbt_test__audit.unique_dim_customers_customer_id`);
                assert.strictEqual(unique.kind, 'test');
                assert.deepStrictEqual(unique.parent, customers.target);
                assert.strictEqual(buildsTable(unique), false);
                assert.deepStrictEqual(dryRunScripts(unique).map((script) => script.name), ['query']);

                const orders = get(`${P}.xf_example.fct_orders`);
                const unit = get('unit test.test_fct_orders_sums_payments');
                assert.strictEqual(unit.kind, 'unit test');
                assert.deepStrictEqual(unit.parent, orders.target);
                assert.strictEqual(isMadeUpTarget(unit.target), true);
                assert.deepStrictEqual(unit.sections, []);
                assert.strictEqual(unit.sqlPresent, true);
                assert.strictEqual(homeAction(graph, unit)?.id, orders.id);

                // A singular test names no model, and reads one: it is shown with that one
                const singular = get(`${P}.xf_example_dbt_test__audit.assert_positive_order_totals`);
                assert.strictEqual(singular.parent, undefined);
                assert.strictEqual(homeAction(graph, singular)?.id, orders.id);
                assert.ok(siblingsOf(graph, orders).some((action) => action.id === unit.id));
            });

            test('an exposure, an analysis and a unit test build nothing, so their Targets are made up', () => {
                const exposure = get('exposure.revenue_dashboard');
                assert.strictEqual(exposure.description, "The finance team's revenue dashboard.");
                assert.deepStrictEqual(exposure.sections, []);
                assert.deepStrictEqual(reads(exposure.id), [`${P}.xf_example.daily_revenue`, `${P}.xf_example_reporting.revenue_report`]);

                const analysis = get('analysis.revenue_by_country');
                assert.strictEqual(isMadeUpTarget(analysis.target), true);
                assert.strictEqual(isRunnable(analysis), false);
                // Its SQL is shown, so it is dry-run: a missing cost would look like a fault
                assert.deepStrictEqual(dryRunScripts(analysis).map((script) => script.name), ['query']);
            });

            test('the other Kinds', () => {
                const ephemeral = get(`${P}.xf_example.int_customer_countries`);
                assert.strictEqual(ephemeral.kind, 'ephemeral');
                assert.strictEqual(buildsTable(ephemeral), false);
                assert.match(get(`${P}.xf_example.customer_segments_v2`).sections[0].sql, /__dbt__cte__int_customer_countries/);

                const seed = get(`${P}.xf_example_reference.country_codes`);
                assert.strictEqual(seed.kind, 'seed');
                assert.deepStrictEqual(seed.sections, []);
                assert.strictEqual(seed.sqlPresent, true);

                assert.strictEqual(get(`${P}.xf_example_snapshots.customers_snapshot`).kind, 'snapshot');
                assert.strictEqual(get(`${P}.xf_example.daily_revenue`).kind, 'materialized view');
            });

            test('the Backend keeps what dbt calls each action it can select', () => {
                const { names } = result.dbt;
                assert.strictEqual(names[`${P}.xf_example.fct_orders`].qualifiedName, 'xf_example.marts.fct_orders');
                assert.deepStrictEqual(names[`${P}.xf_example.customer_segments_v2`], {
                    qualifiedName: 'xf_example.marts.customer_segments.v2', package: 'xf_example', name: 'customer_segments', version: '2', latest: true,
                });
                assert.strictEqual(names[`${P}.xf_example.customer_segments_v1`].latest, false);
                assert.strictEqual(names[`${P}.xf_example_reference.country_codes`].qualifiedName, 'xf_example.country_codes');
                assert.strictEqual(names[`${P}.xf_example_dbt_test__audit.unique_dim_customers_customer_id`].qualifiedName, 'xf_example.marts.unique_dim_customers_customer_id');
                assert.strictEqual(names['unit test.test_fct_orders_sums_payments'].qualifiedName, 'xf_example.marts.fct_orders.test_fct_orders_sums_payments');
                assert.strictEqual(names[`${P}.raw.customers`].sourceName, 'raw');
                assert.strictEqual(names['exposure.revenue_dashboard'], undefined);
                assert.strictEqual(names['analysis.revenue_by_country'], undefined);
            });

            test("the Backend keeps the Project's macros, and none of dbt's own", () => {
                assert.deepStrictEqual(result.dbt.macros.map((macro) => `${macro.package}.${macro.name}`), [
                    'xf_example.cents_to_dollars', 'xf_example.create_cents_to_dollars_udf', 'xf_example.record_run_in_audit_log',
                ]);
                assert.strictEqual(result.dbt.macros[0].fileName, 'macros/cents_to_dollars.sql');
                assert.strictEqual(result.dbt.projectName, 'xf_example');
            });
        });
    }

    test('both engines, cut down or whole, on either OS, give the same graph', () => {
        const [first, ...others] = EXAMPLE.map(([name, manifest]) => [name, buildDbtGraph(manifest()).graph] as const);
        // What an engine is free to differ in: the exact text it compiles to, and the order in which it lists tags
        // and what an action reads (the graph's own `dependencies` are sorted)
        const shape = (graph: DbtGraph['graph']) => ({
            ...graph,
            actions: Object.fromEntries(Object.entries(graph.actions).map(([id, action]) => [id, {
                ...action,
                tags: [...action.tags].sort(),
                sections: action.sections.map((section) => ({ ...section, sql: '' })),
                dependencyTargets: [...action.dependencyTargets].sort((a, b) => (a.name < b.name ? -1 : 1)),
            }])),
        });
        for (const [name, graph] of others) {
            assert.deepStrictEqual(shape(graph), shape(first[1]), `${name} differs from ${first[0]}`);
        }
    });

    for (const name of ['dbt-core-hooks-parsed', 'dbt-v2-hooks-parsed'] as const) {
        test(`${name}: a parsed Project has its SQL as written, and its on-run hooks`, () => {
            const { graph, dbt } = buildDbtGraph(full(name));
            assert.deepStrictEqual(kinds({ graph, dbt }), { view: 2, operation: 2 });

            const amounts = graph.actions[`${P}.xf_example.order_amounts`];
            assert.strictEqual(amounts.sqlPresent, false);
            assert.deepStrictEqual(amounts.sections.map((section) => [section.title, section.compiled]), [['query', false]]);
            assert.match(amounts.sections[0].sql, /\{\{ ref\('orders'\) \}\}/);
            assert.deepStrictEqual(dryRunScripts(amounts), []);

            const hook = graph.actions[`${P}.xf_example.xf_hooks-on-run-start-0`];
            assert.strictEqual(hook.kind, 'operation');
            assert.strictEqual(hook.fileName, 'dbt_project.yml');
            assert.strictEqual(isRunnable(hook), false);
            assert.deepStrictEqual(hook.sections.map((section) => [section.title, section.sql, section.dryRun]), [['operation', '{{ create_cents_to_dollars_udf() }}', []]]);
            assert.strictEqual(dbt.names[hook.id], undefined);
            assert.strictEqual(dbt.adapterType, 'bigquery');
            assert.deepStrictEqual(dbt.macros.map((macro) => macro.name), ['create_cents_to_dollars_udf']);
        });
    }

    test('a failed compile: no nodes with dbt-core, the parsed nodes with dbt v2', () => {
        assert.deepStrictEqual(buildDbtGraph(readRecordedManifest('dbt-core-broken') as unknown as DbtManifest).graph.actions, {});
        const { graph } = buildDbtGraph(readRecordedManifest('dbt-v2-broken') as unknown as DbtManifest);
        assert.deepStrictEqual(Object.keys(graph.actions).sort(), [`${P}.xf_example.order_totals`, `${P}.xf_example.orders`]);
        assert.strictEqual(graph.actions[`${P}.xf_example.order_totals`].sqlPresent, false);
    });

    test('a disabled resource, a package\'s file and a resource the panel does not show', () => {
        const node = (overrides: Record<string, unknown>) => ({
            unique_id: 'model.shop.orders', resource_type: 'model', name: 'orders', package_name: 'shop', fqn: ['shop', 'orders'],
            database: 'p', schema: 'ds', alias: 'orders', original_file_path: 'models/orders.sql', compiled_code: 'select 1',
            depends_on: { nodes: [] }, config: { materialized: 'view' }, ...overrides,
        });
        const { graph, dbt } = buildDbtGraph({
            metadata: { dbt_version: '1.9.0', project_name: 'shop', adapter_type: 'snowflake' },
            nodes: {
                'model.shop.orders': node({}),
                'model.utils.dates': node({ unique_id: 'model.utils.dates', name: 'dates', alias: null, package_name: 'utils', original_file_path: 'models\\dates.sql' }),
                'semantic_model.shop.orders': node({ unique_id: 'semantic_model.shop.orders', resource_type: 'semantic_model' }),
            },
            disabled: { 'model.shop.old': [node({ unique_id: 'model.shop.old', name: 'old', alias: 'old' })] },
            macros: {
                a: { name: 'mine', package_name: 'shop', original_file_path: 'macros/mine.sql', arguments: [{ name: 'x', type: 'string', description: '' }] },
                b: { name: 'theirs', package_name: 'utils', original_file_path: 'macros/theirs.sql' },
                c: { name: 'run_query', package_name: 'dbt', original_file_path: 'macros/x.sql' },
                d: { name: 'snowflake__thing', package_name: 'dbt_snowflake', original_file_path: 'macros/y.sql' },
            },
        } as DbtManifest);
        assert.deepStrictEqual(Object.keys(graph.actions).sort(), ['p.ds.dates', 'p.ds.old', 'p.ds.orders']);
        assert.strictEqual(graph.actions['p.ds.dates'].fileName, 'dbt_packages/utils/models/dates.sql');
        assert.strictEqual(graph.actions['p.ds.old'].disabled, true);
        assert.strictEqual(isRunnable(graph.actions['p.ds.old']), false);
        assert.deepStrictEqual(dbt.macros, [
            { name: 'mine', package: 'shop', fileName: 'macros/mine.sql', arguments: [{ name: 'x', type: 'string' }] },
            { name: 'theirs', package: 'utils', fileName: 'dbt_packages/utils/macros/theirs.sql', arguments: [] },
        ]);
    });
});
