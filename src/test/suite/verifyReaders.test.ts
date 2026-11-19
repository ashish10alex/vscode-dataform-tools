import * as assert from 'assert';
import { suite, test } from 'mocha';
import { missingColumn, swapTable, verifyReaders } from '../../columnLineage/verifyReaders';
import { ImpactTable, readerNote } from '../../shared/columnLineage/impactSummary';

const orders = { database: 'p', schema: 'marts', name: 'orders' };

suite('Column impact: reader dry runs', () => {
    test('swaps every reference to the changed table, however Dataform quotes it, for its query', () => {
        assert.strictEqual(
            swapTable('SELECT a FROM `p.marts.orders` o JOIN `p`.`Marts`.`orders` x USING (id)', orders, 'SELECT 1 AS a;\n'),
            'SELECT a FROM (\nSELECT 1 AS a\n) o JOIN (\nSELECT 1 AS a\n) x USING (id)',
        );
        assert.strictEqual(swapTable('SELECT a FROM `p.marts.orders_v2`', orders, 'SELECT 1'), undefined, 'another table');
        assert.strictEqual(swapTable('SELECT $1 FROM `p.marts.orders`', orders, 'SELECT "$&" AS a'), 'SELECT $1 FROM (\nSELECT "$&" AS a\n)', 'the query is put in as it is');
    });

    test('tells a missing column from other failures', () => {
        assert.strictEqual(missingColumn('Unrecognized name: discount at [3:5]', 'discount'), true);
        assert.strictEqual(missingColumn('Name Discount not found inside o at [1:9]', 'discount'), true);
        assert.strictEqual(missingColumn('Unrecognized name: discount_pct at [3:5]', 'discount'), false);
        assert.strictEqual(missingColumn('Not found: Table p:marts.x', 'discount'), false);
    });

    test('dry runs the readers that still name a dropped column, and settles those that pass', async () => {
        const reader = (table: string) => ({ table, column: 'net', dependencyType: 'OTHER' as const, filePath: `${table}.sqlx`, changedOnBranch: true, stillNamed: true });
        const tables: ImpactTable[] = [{
            table: 'p.marts.orders', type: 'table',
            columns: [
                { column: 'discount', change: { kind: 'dropped' }, readers: [reader('p.marts.revenue'), reader('p.marts.daily'), reader('p.marts.weekly')] },
                { column: 'note', change: { kind: 'dropped', onBase: true }, readers: [reader('p.marts.notes')] },
                { column: 'amount', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' }, readers: [reader('p.marts.sums')] },
            ],
        }];
        const sql: Record<string, string> = {
            'p.marts.revenue': 'SELECT discount AS net FROM `p.marts.orders`',
            'p.marts.daily': 'SELECT o.discount AS net FROM `p.marts.orders` o',
            'p.marts.weekly': 'SELECT discount AS net FROM `p.marts.daily`',
        };
        const ran: string[] = [];
        await verifyReaders(tables, {
            readerSql: (table) => sql[table],
            changedTable: (table) => table === 'p.marts.orders' ? { target: orders, query: 'SELECT 1 AS order_id' } : undefined,
            dryRun: async (table) => {
                ran.push(table);
                return table === 'p.marts.revenue' ? undefined : 'Name discount not found inside o at [1:10]';
            },
        });
        assert.deepStrictEqual(ran.sort(), ['p.marts.daily', 'p.marts.revenue'], 'weekly doesn\'t read orders, and the base\'s drop and a retype are left alone');
        const [discount, note] = tables[0].columns;
        assert.deepStrictEqual(discount.readers.map((r) => [r.table, r.checked, r.stillNamed, r.probablyUpdated]), [
            ['p.marts.daily', 'reads', true, undefined],
            ['p.marts.weekly', undefined, true, undefined],
            ['p.marts.revenue', 'clear', undefined, true],
        ], 'ranked again: the settled one last');
        assert.strictEqual(note.readers[0].checked, undefined);
        assert.deepStrictEqual(discount.readers.map((r) => readerNote(r)), ['changed here, still reads it (dry run fails)', 'changed here, still names it', 'no longer reads it (dry run passes)']);
    });
});
