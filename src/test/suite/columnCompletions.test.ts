import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import type { ColumnMetadata } from '../../types';
import { ColumnTable, aliasAt, columnsAfterDots, cteNames, dottedNameBefore, inFromList, mergeColumns, partMatch, sqlType, statementAt, structFields } from '../../utils/columnPaths';
import { TableChoice, columnCompletionItem, tableCompletionItems } from '../../columnCompletionItem';
import type { CompiledGraph } from '../../shared/compiledGraph';
import { refAliasesIn, refChoices, refText } from '../../completions';
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

suite('columnPaths.mergeColumns', () => {
    test('one entry for each name, whatever its case, with every table that has it, in the order they come', () => {
        const merged = mergeColumns([
            { field: { name: 'ORDER_NUMBER', type: 'INTEGER' }, table: 'a' },
            { field: { name: 'status', type: 'STRING' }, table: 'a' },
            { field: { name: 'order_number', type: 'INTEGER' }, table: 'b' },
        ]);
        assert.deepStrictEqual(merged.map((column) => `${column.name} ${column.choices.map((choice) => choice.table).join(',')}`), ['ORDER_NUMBER a,b', 'status a']);
    });
});

suite('columnCompletionItem', () => {
    const label = (item: vscode.CompletionItem) => item.label as vscode.CompletionItemLabel;
    const column = (...choices: { name?: string, type: string, mode?: string, description?: string, fields?: ColumnMetadata[], table: string }[]) =>
        mergeColumns(choices.map(({ table, name, ...field }) => ({ field: { name: name ?? 'ORDER_NUMBER', ...field }, table })))[0];

    test('the name with its type right after it, and the description to the right on one line', () => {
        const item = columnCompletionItem(column({ name: 'ABS_IND', type: 'STRING', description: ' Accepted by Sales\nIndicator i.e. Y, N, *NULL* ', table: 'orders' }));
        assert.deepStrictEqual(label(item), { label: 'ABS_IND', detail: ' STRING', description: 'Accepted by Sales Indicator i.e. Y, N, *NULL*' });
        assert.strictEqual(item.kind, vscode.CompletionItemKind.Field);
        assert.strictEqual(item.insertText, 'ABS_IND');
        assert.strictEqual(item.detail, undefined);
        assert.strictEqual(item.documentation, 'Accepted by Sales\nIndicator i.e. Y, N, *NULL*\n\norders');
    });

    test('a name in several tables: once, the first description, and the details say each table', () => {
        const item = columnCompletionItem(column(
            { type: 'INTEGER', table: 'flat' },
            { type: 'INTEGER', description: 'Unique order id', table: 'extract' },
            { type: 'INTEGER', description: 'Unique order id', table: 'view' },
            { type: 'STRING', description: 'Order number', table: 'status' },
        ));
        assert.deepStrictEqual(label(item), { label: 'ORDER_NUMBER', detail: ' INTEGER | STRING', description: 'Unique order id' });
        assert.strictEqual(item.documentation, 'Unique order id\n\nflat: no description\nextract, view\nstatus: Order number');
    });

    test('without descriptions the details say the tables, and a STRUCT its full type above', () => {
        assert.strictEqual(columnCompletionItem(column({ type: 'INTEGER', table: 'a' }, { type: 'INTEGER', table: 'b' })).documentation, 'a, b');
        assert.strictEqual(label(columnCompletionItem(column({ type: 'INTEGER', table: 'a' }))).description, undefined);
        assert.strictEqual(columnCompletionItem(column({ ...SHIPPING, table: 't' })).documentation, 'STRUCT<city STRING, geo STRUCT<lat FLOAT64>>\n\nWhere it goes\n\nt');
        assert.strictEqual(columnCompletionItem(column({ ...ITEMS, table: 't' })).documentation, 'ARRAY<STRUCT<sku STRING>>\n\nt');
        assert.strictEqual(label(columnCompletionItem(column({ type: '', table: 't' }))).detail, undefined);
    });
});

suite('columnPaths: where a table goes', () => {
    test('right after FROM or JOIN, or after a comma in a FROM list', () => {
        assert.strictEqual(inFromList('SELECT * FROM '), true);
        assert.strictEqual(inFromList('select *\nfrom a\nLEFT JOIN\n  '), true);
        assert.strictEqual(inFromList('SELECT * FROM a, '), true);
        assert.strictEqual(inFromList('SELECT a, '), false);
        assert.strictEqual(inFromList('SELECT * FROM a WHERE x IN (1, '), false);
        assert.strictEqual(inFromList('SELECT * FROM a WHERE '), false);
        assert.strictEqual(inFromList("SELECT 'from ' "), false);
        assert.strictEqual(inFromList('SELECT -- from \n'), false);
    });

    test('a comma in a sub-query, in parentheses or between CTEs is not in a FROM list', () => {
        assert.strictEqual(inFromList('SELECT a, (SELECT max(b) FROM t) AS m, '), false);
        assert.strictEqual(inFromList('SELECT * FROM a JOIN b USING (x, '), false);
        assert.strictEqual(inFromList('SELECT * FROM a WHERE x IN (SELECT y FROM z) AND c IN (1, '), false);
        assert.strictEqual(inFromList('WITH a AS (SELECT * FROM t), '), false);
        assert.strictEqual(inFromList('SELECT * FROM (SELECT 1) s, '), true);
        assert.strictEqual(inFromList('SELECT * FROM a AS x, '), true);
        assert.strictEqual(inFromList('SELECT * FROM (SELECT * FROM a, '), true);
    });

    test('the CTEs of the WITH clauses', () => {
        assert.deepStrictEqual(cteNames('WITH a AS (SELECT 1), `b c` AS (SELECT 2)\nSELECT * FROM a, (SELECT 3) AS d'), ['a', 'b c']);
        assert.deepStrictEqual(cteNames("SELECT 'with x as (' FROM t"), []);
    });

    test('the statement at an offset is between the semicolons around it', () => {
        const sql = "SELECT 1;\nSELECT ';' FROM a;\nSELECT 2";
        assert.deepStrictEqual(statementAt(sql, 3), [0, 8]);
        assert.deepStrictEqual(statementAt(sql, 14), [9, 27]);
        assert.deepStrictEqual(statementAt(sql, sql.length), [28, sql.length]);
    });

    test('a name matches by its start, by the start of a part, or by the starts of parts in order', () => {
        const name = 'daily_production_report.0300_PRODUCTION_DATA_DPR';
        assert.deepStrictEqual(partMatch(name, 'daily'), { rank: 0 });
        assert.deepStrictEqual(partMatch(name, '030'), { rank: 1 });
        assert.deepStrictEqual(partMatch(name, 'production_d'), { rank: 1 });
        assert.deepStrictEqual(partMatch(name, '0300_DPR'), { rank: 2 });
        assert.deepStrictEqual(partMatch(name, ''), { rank: 0 });
        assert.strictEqual(partMatch(name, '300'), undefined);
        assert.strictEqual(partMatch(name, 'DPR_0300'), undefined);
    });
});

suite('tableCompletionItems', () => {
    const tables: TableChoice[] = [
        { label: 'cte_orders', kind: 'cte', insertText: 'cte_orders' },
        { label: 'allocation_build_plan.0300_ABS_HIST', alsoMatches: ['p.allocation_build_plan.0300_ABS_HIST'], kind: 'table', description: 'Number of times SRBD changes', insertText: '`p.allocation_build_plan.0300_ABS_HIST`' },
        { label: 'daily_production_report.0300_PRODUCTION_DATA_DPR', kind: 'view', insertText: '`p.daily_production_report.0300_PRODUCTION_DATA_DPR`' },
    ];
    const range = new vscode.Range(0, 14, 0, 17);

    test('those that match by any part, best first, each with the typed text as its own and its kind after it', () => {
        const list = tableCompletionItems(tables, '030', range, '030');
        assert.strictEqual(list.isIncomplete, true);
        assert.deepStrictEqual(list.items.map((item) => item.label), [
            { label: 'allocation_build_plan.0300_ABS_HIST', detail: ' table' },
            { label: 'daily_production_report.0300_PRODUCTION_DATA_DPR', detail: ' view' },
        ]);
        assert.deepStrictEqual(list.items.map((item) => [item.filterText, item.sortText]), [['030', '00000'], ['030', '00001']]);
        assert.strictEqual(list.items[0].documentation, 'Number of times SRBD changes');
        assert.strictEqual(list.items[1].documentation, undefined);
        assert.deepStrictEqual(tableCompletionItems(tables, 'p.alloc', range, '`p.alloc').items.map((item) => item.filterText), ['`p.alloc']);
        assert.deepStrictEqual(tableCompletionItems(tables, '', range, '').items.length, 3);
    });
});

suite('the refs after a $ in a .sqlx file', () => {
    const action = (schema: string, name: string, kind: string, description?: string) =>
        ({ id: `p.${schema}.${name}`, target: { database: 'p', schema, name }, kind, description });
    const graph = { actions: Object.fromEntries([
        action('shop', 'orders', 'table', 'Every order'), action('raw', 'orders', 'declaration'), action('shop', 'items', 'view'),
        action('shop_assertions', 'orders_unique', 'assertion'), action('shop', 'cleanup', 'operation'),
    ].map((each) => [each.id, each])) } as unknown as CompiledGraph;

    test('the tables, by name, and no assertion', () => {
        const choices = refChoices(graph, "${ref('table_name')}");
        assert.deepStrictEqual(choices.map((choice) => `${choice.label} ${choice.kind} ${choice.insertText}`), [
            'shop.items view ${ref("items")}',
            'raw.orders declaration ${ref("raw", "orders")}',
            'shop.orders table ${ref("shop", "orders")}',
        ]);
        assert.strictEqual(choices[2].description, 'Every order');
    });

    test('written as the setting says', () => {
        assert.strictEqual(refText({ schema: 'shop', name: 'items' }, "${ref('dataset_name', 'table_name')}", false), '${ref("shop", "items")}');
        assert.strictEqual(refText({ schema: 'shop', name: 'items' }, "${ref({schema:'dataset_name', name:'table_name'})}", true), '${ref({schema: "shop", name: "items"})}');
        assert.strictEqual(refText({ schema: 'shop', name: 'items' }, undefined, false), '${ref("items")}');
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
