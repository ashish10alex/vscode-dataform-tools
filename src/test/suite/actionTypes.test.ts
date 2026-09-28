import * as assert from 'assert';
import { suite, test } from 'mocha';
import { countActionTypes, countTypeNames, describeActionTypes } from '../../shared/actionTypes';

const target = (name: string) => ({ database: 'p', schema: 'd', name });

suite('actionTypes.countActionTypes', () => {
    test('looks each target up in the compiled graph and counts unknown ones as other', () => {
        const compiled = {
            tables: [
                { type: 'table', target: target('orders') },
                { type: 'incremental', target: target('events') },
                { type: 'view', target: target('orders_v') },
            ],
            assertions: [{ target: target('orders_unique') }],
            operations: [{ target: target('grant') }],
        } as any;
        const counts = countActionTypes(['orders', 'events', 'orders_v', 'orders_unique', 'grant', 'gone'].map(target), compiled);
        assert.deepStrictEqual(counts, { table: 1, incremental: 1, view: 1, assertion: 1, operation: 1, other: 1 });
    });
});

suite('actionTypes.describeActionTypes', () => {
    test('lists non-zero types in a fixed order with plurals', () => {
        assert.strictEqual(
            describeActionTypes(16, { assertion: 9, view: 1, table: 4, incremental: 2 }),
            '16 actions: 4 tables, 2 incremental, 1 view, 9 assertions',
        );
    });

    test('falls back to the total without counts', () => {
        assert.strictEqual(describeActionTypes(3, undefined), '3 actions');
        assert.strictEqual(describeActionTypes(1, {}), '1 action');
    });
});

suite('actionTypes.countTypeNames', () => {
    test('maps compiled type names, including the plural operations type', () => {
        assert.deepStrictEqual(
            countTypeNames(['table', 'assertion', 'assertion', 'operations', 'notebook', 'mystery']),
            { table: 1, assertion: 2, operation: 1, notebook: 1, other: 1 },
        );
    });
});
