import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { runSelection } from '../../shared/compiledGraph';
import type { DataformCompiledJson } from '../../types';

const target = (name: string) => ({ database: 'p', schema: 'ds', name });
const id = (name: string) => `p.ds.${name}`;

suite('how a run of actions is recorded', () => {
    const graph = buildDataformGraph({
        tables: [
            { type: 'table', target: target('orders'), fileName: 'definitions/orders.sqlx', query: 'select 1', dependencyTargets: [] },
            { type: 'table', target: target('old_orders'), fileName: 'definitions/orders.sqlx', query: 'select 1', disabled: true, dependencyTargets: [] },
            { type: 'table', target: target('customers'), fileName: 'definitions/customers.sqlx', query: 'select 1', dependencyTargets: [] },
        ],
        assertions: [{ target: target('orders_not_null'), fileName: 'definitions/orders.sqlx', query: 'select 1', dependencyTargets: [target('orders')] }],
        tests: [{ name: 'orders_total', fileName: 'definitions/orders.sqlx', testQuery: 'select 1', expectedOutputQuery: 'select 1' }],
        propertyGraphs: [
            { target: target('sales'), fileName: 'definitions/graphs.js', graphBody: 'node tables (orders)', dependencyTargets: [] },
            { target: target('returns'), fileName: 'definitions/graphs.js', graphBody: 'node tables (orders)', dependencyTargets: [] },
        ],
    } as unknown as DataformCompiledJson);

    test('as their file, when they are all that a run executes of it', () => {
        // The file's disabled table and its unit test are not asked for, and no run would execute them
        assert.deepStrictEqual(runSelection(graph, [id('orders'), id('orders_not_null')]), { file: 'definitions/orders.sqlx' });
        assert.deepStrictEqual(runSelection(graph, [id('returns'), id('sales')]), { file: 'definitions/graphs.js' });
    });

    test('as the actions, when they leave out some of their file', () => {
        assert.deepStrictEqual(runSelection(graph, [id('orders')]), { actions: [id('orders')] });
        assert.deepStrictEqual(runSelection(graph, [id('sales')]), { actions: [id('sales')] });
    });

    test('as the actions, when they are of more than one file or not in the graph', () => {
        const both = [id('orders'), id('orders_not_null'), id('customers')];
        assert.deepStrictEqual(runSelection(graph, both), { actions: both });
        assert.deepStrictEqual(runSelection(graph, [id('gone')]), { actions: [id('gone')] });
    });
});
