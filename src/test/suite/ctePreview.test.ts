import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { cteChoiceAt, cteChoices, cteStatement, previewableCtes } from '../../bigquery/ctePreview';
import { previewQuery } from '../../bigquery/preview';
import type { DataformCompiledJson } from '../../types';

const names = (text: string, sqlx = false) => previewableCtes(text, sqlx).map((cte) => cte.name);

suite('CTE preview', () => {
    test('the CTEs of a WITH that starts a statement can be previewed, not those inside parentheses', () => {
        const sql = [
            'WITH a AS (SELECT 1 AS x),',
            '  b AS (WITH inner_cte AS (SELECT 2) SELECT * FROM inner_cte)',
            'SELECT * FROM (WITH sub AS (SELECT 3) SELECT * FROM sub), b',
        ].join('\n');
        assert.deepStrictEqual(names(sql), ['a', 'b']);
    });

    test("in a .sqlx file, not those of its config, js or pre/post operations blocks", () => {
        const sqlx = [
            'config { type: "table", description: "with x as (select 1)" }',
            'js { const s = `WITH j AS (SELECT 1) SELECT * FROM j`; }',
            'pre_operations {',
            '  CREATE TEMP TABLE t AS WITH p AS (SELECT 1) SELECT * FROM p',
            '}',
            'WITH orders AS (SELECT * FROM ${ref("raw_orders")}), totals AS (SELECT 1)',
            'SELECT * FROM totals',
            'post_operations { INSERT INTO log WITH q AS (SELECT 1) SELECT * FROM q }',
        ].join('\n');
        assert.deepStrictEqual(names(sqlx, true), ['orders', 'totals']);
    });

    test('a CTE in a template of the query, as in an incremental table, can be previewed', () => {
        const sqlx = 'config { type: "incremental" }\n${when(incremental(), `WITH fresh AS (SELECT 1) SELECT * FROM fresh`, `SELECT 1`)}';
        assert.deepStrictEqual(names(sqlx, true), ['fresh']);
    });

    test('CTEs of the same name are told apart by their order', () => {
        const sql = 'WITH a AS (SELECT 1) SELECT * FROM a;\nWITH a AS (SELECT 2), b AS (SELECT 3) SELECT * FROM a, b';
        assert.deepStrictEqual(cteChoices(sql).map(({ choice }) => choice), [
            { name: 'a', occurrence: 0 }, { name: 'a', occurrence: 1 }, { name: 'b', occurrence: 0 },
        ]);
        assert.deepStrictEqual(cteChoiceAt(sql, sql.indexOf('SELECT 2')), { name: 'a', occurrence: 1 });
        assert.strictEqual(cteChoiceAt(sql, sql.indexOf('SELECT * FROM a,')), undefined);
    });

    test('the WITH clause is kept up to the CTE, and its rows are selected', () => {
        const sql = 'WITH a AS (SELECT 1 AS x), b AS (SELECT x + 1 AS y FROM a), c AS (SELECT 2)\nSELECT * FROM c';
        assert.deepStrictEqual(cteStatement([sql], { name: 'B', occurrence: 0 }, 1000), {
            index: 0,
            sql: 'WITH a AS (SELECT 1 AS x), b AS (SELECT x + 1 AS y FROM a)\nSELECT * FROM b LIMIT 1000',
        });
    });

    test('a statement that builds a table from the query is not kept, a RECURSIVE is', () => {
        const sql = 'CREATE OR REPLACE TABLE t AS WITH RECURSIVE r AS (SELECT 1 AS n) SELECT * FROM r';
        assert.strictEqual(cteStatement([sql], { name: 'r', occurrence: 0 }, 10)?.sql, 'WITH RECURSIVE r AS (SELECT 1 AS n)\nSELECT * FROM r LIMIT 10');
    });

    test('a quoted name is selected quoted', () => {
        const sql = 'WITH `my cte` AS (SELECT 1) SELECT * FROM `my cte`';
        assert.strictEqual(cteStatement([sql], { name: 'my cte', occurrence: 0 }, 5)?.sql, 'WITH `my cte` AS (SELECT 1)\nSELECT * FROM `my cte` LIMIT 5');
    });

    test('with fewer CTEs of the name than asked for, the last is taken; with none, there is no preview', () => {
        assert.strictEqual(cteStatement(['WITH a AS (SELECT 1) SELECT 1'], { name: 'a', occurrence: 2 }, 1)?.sql, 'WITH a AS (SELECT 1)\nSELECT * FROM a LIMIT 1');
        assert.strictEqual(cteStatement(['SELECT 1'], { name: 'a', occurrence: 0 }, 1), undefined);
    });

    suite('of an action', () => {
        const target = (name: string) => ({ database: 'p', schema: 'ds', name });
        const compiled = {
            tables: [{
                type: 'incremental',
                target: target('orders'),
                fileName: 'definitions/orders.sqlx',
                preOps: ['DECLARE d DATE DEFAULT (WITH p AS (SELECT 1) SELECT CURRENT_DATE())'],
                query: 'WITH raw AS (SELECT * FROM `p.ds.raw` WHERE day = d), clean AS (SELECT * FROM raw)\nSELECT * FROM clean',
                incrementalQuery: 'WITH fresh AS (SELECT 1) SELECT * FROM fresh',
                dependencyTargets: [],
            }],
            operations: [{ target: target('audit'), fileName: 'definitions/audit.sqlx', queries: ['CREATE TEMP TABLE a AS WITH s AS (SELECT 1) SELECT * FROM s', 'SELECT * FROM a'], dependencyTargets: [] }],
        } as unknown as DataformCompiledJson;
        const graph = buildDataformGraph(compiled);
        const cte = (name: string) => ({ name, occurrence: 0, limit: 100 });

        test('is previewed after the pre-operations', () => {
            assert.deepStrictEqual(previewQuery(graph.actions['p.ds.orders'], 'query', { cte: cte('raw') }), {
                sql: 'DECLARE d DATE DEFAULT (WITH p AS (SELECT 1) SELECT CURRENT_DATE());\nWITH raw AS (SELECT * FROM `p.ds.raw` WHERE day = d)\nSELECT * FROM raw LIMIT 100;',
                sections: ['pre_operations', 'query'],
            });
        });

        test('of the variant asked for, and not when only the other variant has it', () => {
            assert.strictEqual(previewQuery(graph.actions['p.ds.orders'], 'incremental query', { cte: cte('fresh') })?.sql, 'WITH fresh AS (SELECT 1)\nSELECT * FROM fresh LIMIT 100');
            assert.strictEqual(previewQuery(graph.actions['p.ds.orders'], 'query', { cte: cte('fresh') }), undefined);
        });

        test("in an operation's earlier statement, after the statements before it", () => {
            assert.deepStrictEqual(previewQuery(graph.actions['p.ds.audit'], 'operation 2/2', { cte: cte('s') }), {
                sql: 'WITH s AS (SELECT 1)\nSELECT * FROM s LIMIT 100',
                sections: ['operation 1/2'],
            });
        });
    });
});
