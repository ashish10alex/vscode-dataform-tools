import * as assert from 'assert';
import { suite, test } from 'mocha';
import { diffCompiledGraphs } from '../../utils/compiledGraphDiff';
import { DataformCompiledJson } from '../../types';

function target(name: string) {
    return { database: 'proj', schema: 'ds', name };
}

function table(name: string, overrides: Record<string, unknown> = {}) {
    return { type: 'table', fileName: `definitions/${name}.sqlx`, target: target(name), query: `select 1 as ${name}`, tags: [], ...overrides };
}

function graph(parts: Partial<Record<'tables' | 'operations' | 'assertions' | 'notebooks' | 'declarations', unknown[]>>): DataformCompiledJson {
    return { tables: [], operations: [], assertions: [], notebooks: [], declarations: [], tests: [], targets: [], ...parts } as unknown as DataformCompiledJson;
}

suite('compiledGraphDiff.diffCompiledGraphs', () => {
    test('finds nothing when the graphs are the same', () => {
        const g = graph({ tables: [table('orders')] });
        assert.deepStrictEqual(diffCompiledGraphs(g, g), { changed: [], deleted: [] });
    });

    test('reports new actions, SQL changes and deleted actions', () => {
        const base = graph({ tables: [table('orders'), table('legacy')] });
        const head = graph({ tables: [table('orders', { query: 'select 2' }), table('customers')] });
        const { changed, deleted } = diffCompiledGraphs(base, head);
        assert.deepStrictEqual(changed.map((c) => [c.target, c.reasons]), [
            ['proj.ds.customers', ['new']],
            ['proj.ds.orders', ['sql']],
        ]);
        assert.deepStrictEqual(deleted.map((d) => d.target), ['proj.ds.legacy']);
    });

    test('treats materialization settings as changes but ignores docs and tags', () => {
        const base = graph({ tables: [table('orders'), table('customers')] });
        const head = graph({
            tables: [
                table('orders', { bigquery: { partitionBy: 'DATE(ts)' } }),
                table('customers', { tags: ['daily'], actionDescriptor: { description: 'All customers' }, dependencyTargets: [target('x')] }),
            ],
        });
        const { changed } = diffCompiledGraphs(base, head);
        assert.deepStrictEqual(changed.map((c) => [c.target, c.reasons]), [['proj.ds.orders', ['config']]]);
    });

    test('treats defaults the CLI omits the same as explicit empty values', () => {
        const base = graph({ tables: [table('orders')] });
        const head = graph({ tables: [table('orders', { preOps: [], protected: false, bigquery: {} })] });
        assert.deepStrictEqual(diffCompiledGraphs(base, head).changed, []);
    });

    test('compares operations, assertions and notebooks and skips declarations', () => {
        const op = { fileName: 'definitions/op.sqlx', target: target('op'), queries: ['delete from x'] };
        const assertion = { fileName: 'definitions/a.sqlx', target: target('a'), query: 'select 1' };
        const notebook = { fileName: 'definitions/n.ipynb', target: target('n'), notebookContents: '{}' };
        const declaration = { fileName: 'definitions/src.sqlx', target: target('src') };
        const base = graph({ operations: [op], assertions: [assertion], notebooks: [notebook] });
        const head = graph({
            operations: [{ ...op, queries: ['delete from y'] }],
            assertions: [{ ...assertion, query: 'select 2' }],
            notebooks: [notebook],
            declarations: [declaration],
        });
        const { changed } = diffCompiledGraphs(base, head);
        assert.deepStrictEqual(changed.map((c) => [c.target, c.type]), [
            ['proj.ds.a', 'assertion'],
            ['proj.ds.op', 'operations'],
        ]);
    });
});
