import * as assert from 'assert';
import { suite, test } from 'mocha';
import { codeOnly, missingColumn, swapTable, verifyReaders } from '../../columnLineage/verifyReaders';
import { ImpactTable, readerNote } from '../../shared/columnLineage/impactSummary';

const orders = { database: 'p', schema: 'marts', name: 'orders' };

suite('Column impact: reader dry runs', () => {
    test('swaps every reference to the changed table, however Dataform quotes it, for its query', () => {
        assert.strictEqual(
            swapTable('SELECT a FROM `p.marts.orders` o JOIN `p`.`Marts`.`orders` x USING (id)', orders, 'SELECT 1 AS a;\n'),
            'SELECT a FROM (\nSELECT 1 AS a\n) o JOIN (\nSELECT 1 AS a\n) x USING (id)',
        );
        assert.strictEqual(swapTable('SELECT a FROM `p.marts.orders_v2`', orders, 'SELECT 1'), undefined, 'another table');
        assert.strictEqual(swapTable('SELECT $1 FROM `p.marts.orders` o', orders, 'SELECT "$&" AS a'), 'SELECT $1 FROM (\nSELECT "$&" AS a\n) o', 'the query is put in as it is');
    });

    test('keeps the implicit alias a table has and a subquery hasn\'t', () => {
        assert.strictEqual(swapTable('SELECT orders.id FROM `p.marts.orders` WHERE orders.id > 0', orders, 'SELECT 1 AS id'),
            'SELECT orders.id FROM (\nSELECT 1 AS id\n) AS `orders` WHERE orders.id > 0');
        assert.strictEqual(swapTable('SELECT x.id FROM `p.marts.orders` AS x', orders, 'SELECT 1 AS id'), 'SELECT x.id FROM (\nSELECT 1 AS id\n) AS x');
        assert.strictEqual(swapTable('SELECT * FROM `p.marts.orders`\nJOIN y USING (id)', orders, 'SELECT 1 AS id'), 'SELECT * FROM (\nSELECT 1 AS id\n) AS `orders`\nJOIN y USING (id)');
    });

    test('swaps no reference in a comment or a string, and gives up while one written another way is left', () => {
        assert.strictEqual(swapTable('/* `p.marts.orders` */ SELECT discount FROM p.marts.orders', orders, 'SELECT 1 AS a'), undefined, 'the one read is unquoted');
        assert.strictEqual(swapTable("SELECT '`p.marts.orders`' AS t, discount FROM `p.marts.orders` o -- `p.marts.orders`", orders, 'SELECT 1 AS a'),
            "SELECT '`p.marts.orders`' AS t, discount FROM (\nSELECT 1 AS a\n) o -- `p.marts.orders`");
        assert.strictEqual(swapTable('SELECT * FROM `p.marts.orders` a JOIN marts.orders b USING (id)', orders, 'SELECT 1 AS id'), undefined, 'marts.orders is still read');
        const sql = "a -- b\nc /* d */ e 'f\\'g' \"\"\"h\"\"\" `i` # j";
        assert.strictEqual(codeOnly(sql), `a     \nc${' '.repeat(9)}e${' '.repeat(16)}\`i\`${' '.repeat(4)}`);
        assert.strictEqual(codeOnly(sql).length, sql.length, 'positions are kept');
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
