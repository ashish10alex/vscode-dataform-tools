import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { Action } from '../../shared/compiledGraph';
import { columnHoverText, columnsOf, tableHoverText } from '../../project/dbtHoverText';
import type { HeldTable } from '../../project/dbtSchemas';

const action = (over: Partial<Action> = {}): Action => ({
    id: 'p.shop.orders', target: { database: 'p', schema: 'shop', name: 'orders' }, kind: 'incremental', fileName: 'models/orders.sql',
    tags: [], sections: [], sqlPresent: true, dependencyTargets: [], ...over,
});

const FOUND: HeldTable = {
    state: 'found',
    fields: [
        { name: 'order_id', type: 'INT64', mode: 'REQUIRED', description: 'From BigQuery' },
        { name: 'amount', type: 'NUMERIC' },
        { name: 'items', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'sku', type: 'STRING' }] },
    ],
    description: 'The table, as BigQuery has it',
    partition: 'order_date (day)',
    rows: 1234567,
    lastModified: Date.UTC(2026, 0, 2),
};

suite('dbt: what a hover says', () => {
    test('a built table: its BigQuery name as a link, its Kind and file, what BigQuery knows, and its columns', () => {
        const text = tableHoverText(action({ description: 'One row per order', columns: [{ path: ['order_id'], description: 'The key | of the order' }] }), FOUND);
        assert.deepStrictEqual(text.split('\n\n'), [
            '#### [p.shop.orders](https://console.cloud.google.com/bigquery?project=p&ws=!1m5!1m4!4m3!1sp!2sshop!3sorders)',
            '**Kind:** incremental · `models/orders.sql`',
            // The Project's description, and its column description, win over BigQuery's
            '**Description:** One row per order',
            '**Partition:** `order_date (day)` · **Rows:** 1,234,567 · **Last modified:** 2026-01-02T00:00:00.000Z',
            '----',
            [
                '| Column | Type | Description |', '|---|---|---|',
                '| amount | NUMERIC |  |',
                '| items | RECORD REPEATED |  |',
                '| └─ sku | STRING |  |',
                '| order_id | INT64 REQUIRED | The key \\| of the order |',
            ].join('\n'),
        ]);
        // With no description in the Project, BigQuery's
        assert.ok(tableHoverText(action(), FOUND).includes('**Description:** The table, as BigQuery has it'));
    });

    test('a table that is not built yet says so, and lists what the YAML documents', () => {
        const text = tableHoverText(action({ columns: [{ path: ['order_id'], description: 'The key' }] }), { state: 'missing' });
        assert.ok(text.includes('_Not built yet: BigQuery has no table of this name._'));
        assert.ok(text.endsWith('| order_id |  | The key |'));
    });

    test('a table BigQuery could not be asked about says why, and an ephemeral model that it has none', () => {
        assert.ok(tableHoverText(action(), { state: 'unknown', error: 'Could not load the default credentials' }).includes('_BigQuery could not be asked about the table: Could not load the default credentials_'));
        const ephemeral = tableHoverText(action({ kind: 'ephemeral' }), undefined);
        assert.deepStrictEqual(ephemeral.split('\n\n'), ['#### orders', '**Kind:** ephemeral · `models/orders.sql`', '_An ephemeral model: it is inlined where it is read, and has no table._']);
    });

    test('a column: every table that has one of the name, whatever its case, with type and description', () => {
        const orders = action({ columns: [{ path: ['amount'], description: 'In dollars' }] });
        const payments = action({ id: 'p.shop.payments', target: { database: 'p', schema: 'shop', name: 'payments' }, kind: 'view' });
        const columns = [...columnsOf(orders, FOUND), ...columnsOf(payments, { state: 'found', fields: [{ name: 'AMOUNT', type: 'INT64' }] })];
        assert.strictEqual(columnHoverText('Amount', columns), '**amount** `NUMERIC` · orders (incremental)\n\nIn dollars\n\n----\n\n**AMOUNT** `INT64` · payments (view)');
        assert.strictEqual(columnHoverText('sku', columns), '');
        assert.strictEqual(columnHoverText('select', columns), '');
    });
});
