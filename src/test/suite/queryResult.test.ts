import * as assert from 'assert';
import { suite, test } from 'mocha';
import { QueryResult, columnExprs, viewQuery, type SchemaField } from '../../bigquery/queryResult';

const SCHEMA: SchemaField[] = [
    { name: 'player_id', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'joined', type: 'DATE', mode: 'NULLABLE' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    { name: 'payload', type: 'JSON', mode: 'NULLABLE' },
    { name: 'club', type: 'RECORD', mode: 'NULLABLE', fields: [
        { name: 'name', type: 'STRING', mode: 'NULLABLE' },
        { name: 'seasons', type: 'STRING', mode: 'REPEATED' },
        { name: 'ground', type: 'RECORD', mode: 'NULLABLE', fields: [{ name: 'city', type: 'STRING' }] },
    ] },
    { name: 'transfers', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'fee', type: 'INTEGER' }] },
];
const TABLE = { projectId: 'my-project', datasetId: '_abc', tableId: 'anon123' };

/** A result of `total` rows, each `{ n }` with its index, and the reads asked of BigQuery for it */
function numbered(total: number) {
    const reads: [number, number][] = [];
    const result = new QueryResult(total, [{ title: 'n', field: 'n' }], async (startIndex, maxResults) => {
        reads.push([startIndex, maxResults]);
        return Array.from({ length: Math.max(0, Math.min(maxResults, total - startIndex)) }, (_, i) => ({ n: startIndex + i }));
    });
    return { result, reads };
}
const ns = (rows: any[]) => rows.map(row => row.n);

suite('queryResult.columnExprs', () => {
    test('scalar columns and the scalar fields of a struct can be sorted, by the names the results table gives them', () => {
        assert.deepStrictEqual(columnExprs(SCHEMA), {
            player_id: '`player_id`',
            joined: '`joined`',
            club_x_name: '`club`.`name`',
        });
    });

    test('there is nothing to sort by without a schema', () => {
        assert.deepStrictEqual(columnExprs(undefined), {});
    });
});

suite('queryResult.viewQuery', () => {
    const exprs = columnExprs(SCHEMA);

    test('a sort orders the temporary table', () => {
        assert.deepStrictEqual(viewQuery(TABLE, [{ id: 'joined', desc: true }, { id: 'club_x_name', desc: false }], [], exprs), {
            query: 'SELECT * FROM `my-project._abc.anon123` ORDER BY `joined` DESC, `club`.`name` ASC',
            params: {},
        });
    });

    test('a filter text is a parameter, never part of the SQL', () => {
        const view = viewQuery(TABLE, [], [{ id: 'club_x_name', value: "x' OR 1=1 --" }, { id: 'player_id', value: '33' }], exprs);
        assert.deepStrictEqual(view, {
            query: 'SELECT * FROM `my-project._abc.anon123`'
                + ' WHERE STRPOS(LOWER(SAFE_CAST(`club`.`name` AS STRING)), LOWER(@f0)) > 0'
                + ' AND STRPOS(LOWER(SAFE_CAST(`player_id` AS STRING)), LOWER(@f1)) > 0',
            params: { f0: "x' OR 1=1 --", f1: '33' },
        });
    });

    test('columns that cannot be ordered, unknown columns and empty filters are left out', () => {
        assert.strictEqual(viewQuery(TABLE, [{ id: 'tags', desc: false }], [{ id: 'payload', value: 'a' }, { id: 'joined', value: '' }], exprs), undefined);
        assert.strictEqual(viewQuery(TABLE, [], [], exprs), undefined);
    });
});

suite('queryResult.QueryResult', () => {
    test('a page is read from BigQuery in parts of a thousand rows, each part once', async () => {
        const { result, reads } = numbered(2500);
        assert.deepStrictEqual(ns(await result.page(0, 50)).slice(0, 3), [0, 1, 2]);
        assert.deepStrictEqual(ns(await result.page(3, 50)).slice(0, 2), [150, 151]);
        assert.deepStrictEqual(reads, [[0, 1000]]);
        assert.deepStrictEqual(ns(await result.page(40, 50)).slice(0, 2), [2000, 2001]);
        assert.deepStrictEqual(reads, [[0, 1000], [2000, 1000]]);
    });

    test('the rows it was made with are not read again', async () => {
        const reads: number[] = [];
        const result = new QueryResult(1200, [], async (startIndex) => { reads.push(startIndex); return [{ n: 'read' }]; }, [{ n: 'first' }]);
        assert.deepStrictEqual(ns(await result.page(0, 1)), ['first']);
        assert.deepStrictEqual(reads, []);
    });

    test('a page across two parts has rows of both, and the last page stops at the end', async () => {
        const { result } = numbered(2137);
        assert.deepStrictEqual(ns(await result.page(4, 240)).filter(n => n >= 998 && n <= 1001), [998, 999, 1000, 1001]);
        const last = ns(await result.page(42, 50));
        assert.deepStrictEqual([last[0], last[last.length - 1], last.length], [2100, 2136, 37]);
        assert.deepStrictEqual(await result.page(43, 50), []);
    });

    test('a part that could not be read is asked for again', async () => {
        let fail = true;
        const result = new QueryResult(10, [], async () => {
            if (fail) { throw new Error('offline'); }
            return [{ n: 1 }];
        });
        await assert.rejects(result.page(0, 1), /offline/);
        fail = false;
        assert.deepStrictEqual(ns(await result.page(0, 1)), [1]);
    });

    test('rows reads up to the most asked for and tells how far it is', async () => {
        const { result, reads } = numbered(2500);
        const progress: [number, number][] = [];
        const rows = await result.rows(2200, (read, of) => { progress.push([read, of]); });
        assert.strictEqual(rows.length, 2200);
        assert.deepStrictEqual(progress, [[1000, 2200], [2000, 2200], [2200, 2200]]);
        assert.deepStrictEqual(reads, [[0, 1000], [1000, 1000], [2000, 1000]]);
    });

    test('rows stops when told to', async () => {
        const { result } = numbered(5000);
        assert.strictEqual((await result.rows(5000, () => false)).length, 1000);
    });

    test('a result of a thousand rows or fewer fits in the view', () => {
        assert.strictEqual(numbered(1000).result.fitsInView, true);
        assert.strictEqual(numbered(1001).result.fitsInView, false);
    });
});
