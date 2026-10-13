import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDependencyGraphFromCompiledGraph } from '../../shared/buildDependencyGraph';
import { readRecordedManifest } from './fixtures';
import { DbtManifest, buildDbtGraph } from './graph';

const P = 'alex-personal-dev-01';

suite('dbt Compiled Graph to dependency graph', () => {
    for (const recording of ['dbt-core', 'dbt-v2', 'dbt-core-windows', 'dbt-v2-windows'] as const) {
        suite(recording, () => {
            const { graph } = buildDbtGraph(readRecordedManifest(recording) as unknown as DbtManifest);
            const result = buildDependencyGraphFromCompiledGraph(graph, { focusFile: 'models/marts/fct_orders.sql' });
            const node = (actionId: string) => {
                const found = result.nodes.find((candidate) => candidate.data.actionId === actionId);
                assert.ok(found, `no node for ${actionId}`);
                return found;
            };
            const hasEdge = (from: string, to: string) => result.edges.some((edge) => edge.source === node(from).id && edge.target === node(to).id);

            test('every action is a node, and every dependency an edge', () => {
                assert.strictEqual(result.nodes.length, Object.keys(graph.actions).length);
                const dependencies = Object.values(graph.dependencies).reduce((count, ids) => count + ids.length, 0);
                assert.strictEqual(result.edges.length, dependencies);
                assert.ok(hasEdge(`${P}.xf_example.stg_orders`, `${P}.xf_example.fct_orders`));
            });

            test('a node shows its Kind and carries its tags', () => {
                const orders = node(`${P}.xf_example.fct_orders`);
                assert.strictEqual(orders.data.type, 'incremental');
                assert.strictEqual(orders.data.fileName, 'models/marts/fct_orders.sql');
                assert.ok(orders.data.tags.includes('hourly'));
                assert.strictEqual(orders.data.noTable, false);
            });

            test('tests and unit tests are hidden as assertions are', () => {
                const tests = result.nodes.filter((candidate) => candidate.data.isAssertion);
                assert.deepStrictEqual([...new Set(tests.map((candidate) => candidate.data.type))].sort(), ['test', 'unit test']);
                assert.strictEqual(tests.length, 13);
            });

            test('sources are coloured by their schema, and nothing else is', () => {
                const sources = result.nodes.filter((candidate) => candidate.data.isExternalSource);
                assert.strictEqual(sources.length, 3);
                assert.deepStrictEqual([...result.datasetColorMap.keys()], [...new Set(sources.map((source) => source.data.datasetId))]);
                assert.ok(sources.every((source) => source.data.datasetColor === result.datasetColorMap.get(source.data.datasetId)));
                assert.ok(result.nodes.filter((candidate) => !candidate.data.isExternalSource).every((other) => other.data.datasetColor === 'grey'));
            });

            test('an action with no table of its own offers no BigQuery link', () => {
                const noTable = result.nodes.filter((candidate) => candidate.data.noTable).map((candidate) => candidate.data.type);
                for (const kind of ['exposure', 'analysis', 'ephemeral', 'test', 'unit test']) {
                    assert.ok(noTable.includes(kind), `a ${kind} has a table`);
                }
                assert.ok(!noTable.includes('source'));
            });

            test('the graph centres on the first action of the file on show', () => {
                assert.strictEqual(result.focusNodeId, node(`${P}.xf_example.fct_orders`).id);
                const yaml = buildDependencyGraphFromCompiledGraph(graph, { focusFile: 'models/staging/_sources.yml' });
                const first = yaml.nodes.find((candidate) => candidate.id === yaml.focusNodeId);
                assert.strictEqual(first?.data.type, 'source');
                assert.strictEqual(buildDependencyGraphFromCompiledGraph(graph, { focusFile: 'no/such/file.sql' }).focusNodeId, null);
            });
        });
    }

    test('a disabled action is left out, with its edges', () => {
        const { graph } = buildDbtGraph(readRecordedManifest('dbt-core') as unknown as DbtManifest);
        const disabledId = `${P}.xf_example.stg_orders`;
        const withDisabled = { ...graph, actions: { ...graph.actions, [disabledId]: { ...graph.actions[disabledId], disabled: true } } };
        const result = buildDependencyGraphFromCompiledGraph(withDisabled);
        assert.ok(!result.nodes.some((candidate) => candidate.data.actionId === disabledId));
        assert.strictEqual(result.nodes.length, Object.keys(graph.actions).length - 1);
        const ids = new Set(result.nodes.map((candidate) => candidate.id));
        assert.ok(result.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target)));
    });
});
