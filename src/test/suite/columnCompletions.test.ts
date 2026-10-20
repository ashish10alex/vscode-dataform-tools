import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import type { ColumnMetadata } from '../../types';
import { ColumnTable, aliasAt, columnsAfterDots, dottedNameBefore, sqlType, structFields } from '../../utils/columnPaths';
import { columnCompletionItem } from '../../columnCompletionItem';
import { refAliasesIn } from '../../completions';
import { tableAliasesIn, tableNameText } from '../../scratch/scratchQuery';

const SHIPPING: ColumnMetadata = {
    name: 'shipping', type: 'RECORD', description: 'Where it goes',
    fields: [{ name: 'city', type: 'STRING' }, { name: 'geo', type: 'RECORD', fields: [{ name: 'lat', type: 'FLOAT64' }] }],
};
const ITEMS: ColumnMetadata = { name: 'items', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'sku', type: 'STRING' }] };
const ORDERS: ColumnTable = { table: 'orders', names: ['orders', 'o'], fields: [{ name: 'order_id', type: 'INT64' }, SHIPPING, ITEMS] };
const CUSTOMERS: ColumnTable = { table: 'customers', names: ['customers'], fields: [{ name: 'o', type: 'RECORD', fields: [{ name: 'x', type: 'STRING' }] }] };
const names = (choices: ReturnType<typeof columnsAfterDots>) => choices?.map((choice) => `${choice.field.name} ${choice.table}`);

suite('columnPaths.sqlType', () => {
    test('says a type as SQL writes it, in full', () => {
        assert.strictEqual(sqlType({ name: 'a', type: 'STRING' }), 'STRING');
        assert.strictEqual(sqlType({ name: 'a', type: 'STRING', mode: 'REPEATED' }), 'ARRAY<STRING>');
        assert.strictEqual(sqlType({ name: 'a', type: 'INT64', mode: 'REQUIRED' }), 'INT64');
        assert.strictEqual(sqlType(SHIPPING), 'STRUCT<city STRING, geo STRUCT<lat FLOAT64>>');
        assert.strictEqual(sqlType(ITEMS), 'ARRAY<STRUCT<sku STRING>>');
        assert.strictEqual(sqlType({ name: 'a', type: 'STRUCT' }), 'STRUCT');
        // Only the Project's YAML knows the column
        assert.strictEqual(sqlType({ name: 'a', type: '' }), '');
    });
});

suite('columnPaths.structFields', () => {
    test('follows STRUCT columns, whatever the case, and not an ARRAY of them', () => {
        assert.deepStrictEqual(structFields(ORDERS.fields, ['SHIPPING', 'geo'])?.map((field) => field.name), ['lat']);
        assert.strictEqual(structFields(ORDERS.fields, ['items']), undefined);
        assert.strictEqual(structFields(ORDERS.fields, ['order_id']), undefined);
        assert.strictEqual(structFields(ORDERS.fields, ['nothing']), undefined);
        assert.strictEqual(structFields(ORDERS.fields, []), ORDERS.fields);
    });
});

suite('columnPaths.dottedNameBefore', () => {
    test('the qualifiers and the word typed after the last dot', () => {
        assert.deepStrictEqual(dottedNameBefore('select o.shipping.ci'), { qualifiers: ['o', 'shipping'], word: 'ci' });
        assert.deepStrictEqual(dottedNameBefore('  sum(o.'), { qualifiers: ['o'], word: '' });
        assert.deepStrictEqual(dottedNameBefore('o.'), { qualifiers: ['o'], word: '' });
    });

    test('nothing without a dot, nor after backticks, a `}` or a project with a dash', () => {
        assert.strictEqual(dottedNameBefore('select order'), undefined);
        assert.strictEqual(dottedNameBefore('from `p.shop.orders`.'), undefined);
        assert.strictEqual(dottedNameBefore('from ${ref("orders")}.'), undefined);
        assert.strictEqual(dottedNameBefore('from my-project.shop.'), undefined);
        assert.strictEqual(dottedNameBefore('select 1.'), undefined);
    });
});

suite('columnPaths.aliasAt', () => {
    test('the alias right after a table name, with AS or without, and not a keyword', () => {
        assert.strictEqual(aliasAt(' o where'), 'o');
        assert.strictEqual(aliasAt('\n  AS ord on'), 'ord');
        assert.strictEqual(aliasAt(' where x = 1'), undefined);
        assert.strictEqual(aliasAt('\nLEFT JOIN'), undefined);
        assert.strictEqual(aliasAt(','), undefined);
    });
});

suite('columnPaths.columnsAfterDots', () => {
    test('a qualifier that names a table: its columns, and the fields of its STRUCTs after more of them', () => {
        assert.deepStrictEqual(names(columnsAfterDots(['o'], [ORDERS, CUSTOMERS])), ['order_id orders', 'shipping orders', 'items orders']);
        assert.deepStrictEqual(names(columnsAfterDots(['O', 'shipping'], [ORDERS, CUSTOMERS])), ['city orders', 'geo orders']);
        assert.deepStrictEqual(names(columnsAfterDots(['orders', 'shipping', 'geo'], [ORDERS])), ['lat orders']);
    });

    test('a table alias wins over a STRUCT column of the same name, as in BigQuery', () => {
        assert.deepStrictEqual(names(columnsAfterDots(['o'], [CUSTOMERS, ORDERS])), ['order_id orders', 'shipping orders', 'items orders']);
        assert.strictEqual(columnsAfterDots(['o', 'x'], [CUSTOMERS, ORDERS]), undefined);
    });

    test('otherwise a STRUCT column of any table', () => {
        assert.deepStrictEqual(names(columnsAfterDots(['shipping'], [CUSTOMERS, ORDERS])), ['city orders', 'geo orders']);
        assert.strictEqual(columnsAfterDots(['items'], [ORDERS]), undefined);
        assert.strictEqual(columnsAfterDots(['cte'], [ORDERS]), undefined);
    });
});

suite('columnCompletionItem', () => {
    const label = (item: vscode.CompletionItem) => item.label as vscode.CompletionItemLabel;

    test('the name with its type right after it, its table to the right, and the description as it is written', () => {
        const item = columnCompletionItem({ field: { name: 'ABS_IND', type: 'STRING', description: ' Accepted by Sales Indicator i.e. Y, N, *NULL* ' }, table: 'orders' });
        assert.deepStrictEqual(label(item), { label: 'ABS_IND', detail: ' STRING', description: 'orders' });
        assert.strictEqual(item.kind, vscode.CompletionItemKind.Field);
        assert.strictEqual(item.insertText, 'ABS_IND');
        assert.strictEqual(item.detail, undefined);
        assert.strictEqual(item.documentation, 'Accepted by Sales Indicator i.e. Y, N, *NULL*');
    });

    test('no details without a description, and a STRUCT says its full type above it', () => {
        assert.strictEqual(columnCompletionItem({ field: { name: 'a', type: 'STRING' }, table: 't' }).documentation, undefined);
        assert.strictEqual(columnCompletionItem({ field: SHIPPING, table: 't' }).documentation, 'STRUCT<city STRING, geo STRUCT<lat FLOAT64>>\n\nWhere it goes');
        assert.strictEqual(columnCompletionItem({ field: ITEMS, table: 't' }).documentation, 'ARRAY<STRUCT<sku STRING>>');
        assert.strictEqual(label(columnCompletionItem({ field: { name: 'a', type: '' }, table: 't' })).detail, undefined);
    });
});

suite('the aliases of tables', () => {
    test('a .sqlx file: those of its refs, by the table name', () => {
        const text = 'select * from ${ref("orders")} o join ${ref("shop", "customers")} AS c using (id)\njoin ${ref({schema: "shop", name: "items"})} i on true\nwhere ${ref("x")} is null';
        assert.deepStrictEqual(refAliasesIn(text), [{ name: 'orders', alias: 'o' }, { name: 'customers', alias: 'c' }, { name: 'items', alias: 'i' }]);
    });

    test('a scratch query: those of the tables it names', () => {
        const aliases = tableAliasesIn('select * from shop.orders o\njoin `p.shop.customers` as c on true\nleft join shop.items where 1 = 1')
            .map(({ table, alias }) => `${tableNameText(table)} ${alias}`);
        assert.deepStrictEqual(aliases, ['shop.orders o', 'p.shop.customers c']);
    });
});
