import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { Action } from '../../shared/compiledGraph';
import { columnHoverText, columnsOf } from '../../project/dbtHoverText';
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
};

suite('dbt: what a hover on a column says', () => {
    test('a column: every table that has one of the name, whatever its case, with type and description', () => {
        const orders = action({ columns: [{ path: ['amount'], description: 'In dollars' }] });
        const payments = action({ id: 'p.shop.payments', target: { database: 'p', schema: 'shop', name: 'payments' }, kind: 'view' });
        const columns = [...columnsOf(orders, FOUND), ...columnsOf(payments, { state: 'found', fields: [{ name: 'AMOUNT', type: 'INT64' }] })];
        assert.strictEqual(columnHoverText('Amount', columns), '**amount** `NUMERIC` · orders (incremental)\n\nIn dollars\n\n----\n\n**AMOUNT** `INT64` · payments (view)');
        assert.strictEqual(columnHoverText('sku', columns), '');
        assert.strictEqual(columnHoverText('select', columns), '');
    });
});
