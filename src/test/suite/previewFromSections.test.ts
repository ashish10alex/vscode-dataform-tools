import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { previewQuery } from '../../bigquery/preview';
import { Action, previewSection, titledSections } from '../../shared/compiledGraph';
import type { DataformCompiledJson } from '../../types';

const target = (name: string) => ({ database: 'p', schema: 'ds', name });

suite('preview from sections', () => {
    const compiled = {
        tables: [{
            type: 'incremental',
            target: target('orders'),
            fileName: 'definitions/orders.sqlx',
            preOps: ['declare d date'],
            query: '\nselect 1 as id\n',
            postOps: ['grant select on t to x'],
            incrementalPreOps: ['declare d date default current_date()'],
            incrementalQuery: 'select 1 as id where day > d',
            dependencyTargets: [],
        }],
        operations: [{ target: target('audit'), fileName: 'definitions/audit.sqlx', queries: ['create temp table a as select 1', 'select * from a'], dependencyTargets: [] }],
        assertions: [{ target: target('orders_not_null'), fileName: 'definitions/orders.sqlx', query: 'select * from orders where id is null', dependencyTargets: [] }],
        tests: [{ name: 'orders_total', fileName: 'definitions/orders_total.sqlx', testQuery: 'select 1 as n', expectedOutputQuery: 'select 2 as n' }],
    } as unknown as DataformCompiledJson;
    const graph = buildDataformGraph(compiled);
    const orders = graph.actions['p.ds.orders'];

    test("a Dataform table's query is previewed after its pre-operations", () => {
        assert.deepStrictEqual(previewQuery(orders, 'query'), { sql: 'declare d date;\nselect 1 as id;', sections: ['pre_operations', 'query'] });
    });

    test('the incremental query is previewed after the incremental pre-operations', () => {
        assert.deepStrictEqual(previewQuery(orders, 'incremental query'), {
            sql: 'declare d date default current_date();\nselect 1 as id where day > d;',
            sections: ['incremental pre_operations', 'incremental query'],
        });
    });

    test('alone, only the section itself is run', () => {
        assert.deepStrictEqual(previewQuery(orders, 'query', { alone: true }), { sql: 'select 1 as id', sections: ['query'] });
    });

    test("an assertion's query and a unit test's test query are previewed as they are", () => {
        assert.strictEqual(previewQuery(graph.actions['p.ds.orders_not_null'], 'query')?.sql, 'select * from orders where id is null');
        const unitTest = graph.actions['unit test.orders_total'];
        assert.strictEqual(previewQuery(unitTest, 'test query')?.sql, 'select 1 as n');
        assert.strictEqual(previewQuery(unitTest, 'expected output'), undefined);
    });

    test("an operation is previewed whole, from its last statement", () => {
        const audit = graph.actions['p.ds.audit'];
        assert.strictEqual(previewQuery(audit, 'operation 2/2')?.sql, 'create temp table a as select 1;\nselect * from a;');
        // The script does not end with the first statement
        assert.strictEqual(previewQuery(audit, 'operation 1/2'), undefined);
    });

    test('the section a preview shows is the one whose rows are the action\'s, of the variant asked for', () => {
        assert.strictEqual(previewSection(orders), 'query');
        assert.strictEqual(previewSection(orders, true), 'incremental query');
        assert.strictEqual(previewSection(graph.actions['p.ds.audit']), 'operation 2/2');
        assert.strictEqual(previewSection(graph.actions['unit test.orders_total']), 'test query');
        // Not incremental, so it has no such variant
        assert.strictEqual(previewSection(graph.actions['p.ds.orders_not_null'], true), undefined);
    });

    test('post-operations are never run as a preview, though they are dry-run', () => {
        assert.strictEqual(previewQuery(orders, 'post_operations'), undefined);
        assert.strictEqual(previewQuery(orders, 'incremental post_operations'), undefined);
    });

    test('a section that does not end its script, or that is not there, has no preview', () => {
        assert.strictEqual(previewQuery(orders, 'pre_operations'), undefined);
        assert.strictEqual(previewQuery(orders, 'no such section'), undefined);
    });

    test('a dbt model: the compiled query is previewed, a hook shown as written is not', () => {
        const model: Action = {
            id: 'p.ds.customers',
            target: target('customers'),
            kind: 'table',
            fileName: 'models/customers.sql',
            tags: [],
            sqlPresent: true,
            dependencyTargets: [],
            sections: [
                ...titledSections('pre-hook', ['{{ log("start") }}'], { compiled: false, dryRun: [] }),
                ...titledSections('query', ['select 1 as id'], { compiled: true, dryRun: ['query'] }),
            ],
        };
        assert.deepStrictEqual(previewQuery(model, 'query'), { sql: 'select 1 as id', sections: ['query'] });
        assert.strictEqual(previewQuery(model, 'pre-hook'), undefined);
        // A seed has no SQL at all
        assert.strictEqual(previewQuery({ ...model, sections: [] }, 'query'), undefined);
    });
});
