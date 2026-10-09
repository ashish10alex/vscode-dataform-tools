import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { Action } from '../../shared/compiledGraph';
import { HeldTable, tableOfError, tableOfMetadata } from '../../project/heldTable';
import { tableHoverText } from '../../project/tableHoverText';

const action = (over: Partial<Action> = {}): Action => ({
    id: 'p.shop.orders', target: { database: 'p', schema: 'shop', name: 'orders' }, kind: 'incremental', fileName: 'models/orders.sql',
    tags: [], sections: [], sqlPresent: true, dependencyTargets: [], ...over,
});

const FOUND: HeldTable = {
    state: 'found',
    fields: [
        { name: 'order_id', type: 'INT64', mode: 'REQUIRED', description: 'From BigQuery' },
        { name: 'amount', type: 'NUMERIC' },
        { name: 'items', type: 'RECORD', mode: 'REPEATED', fields: [{ name: 'sku', type: 'STRING', fields: [{ name: 'code', type: 'STRING' }] }] },
    ],
    description: 'The table, as BigQuery has it',
    location: 'EU',
    partition: 'order_date (day)',
    rows: 1234567,
    lastModified: Date.UTC(2026, 0, 2),
};

const TITLE = '#### [p.shop.orders](https://console.cloud.google.com/bigquery?project=p&ws=!1m5!1m4!4m3!1sp!2sshop!3sorders)';
const SEARCH = '[$(search) Search columns](command:vscode-dataform-tools.searchTableColumns?%5B%7B%22database%22%3A%22p%22%2C%22schema%22%3A%22shop%22%2C%22name%22%3A%22orders%22%7D%5D)';

suite('what the hover of a table says, in a Dataform and a dbt Project', () => {
    test('a built table: its name as a link, the search of its columns, its Kind and location, what BigQuery knows, and its columns', () => {
        const text = tableHoverText(action({ description: 'One row per order', partition: 'DATE(ordered_at)', columns: [{ path: ['order_id'], description: 'The key | of the order' }] }), FOUND);
        assert.deepStrictEqual(text.split('\n\n'), [
            TITLE,
            SEARCH,
            '**Kind:** incremental · **Location:** EU',
            // The Project's description, and its column description, win over BigQuery's
            '**Description:** One row per order',
            // The partition the table has, not the one the code asks for
            '**Partition:** `order_date (day)` · **Rows:** 1,234,567 · **Last modified:** 2026-01-02T00:00:00.000Z',
            '----',
            [
                '| Column | Type | Description |', '|:---|:---|:---|',
                '| amount | NUMERIC |  |',
                '| items | RECORD REPEATED |  |',
                '| └─ sku | STRING |  |',
                '|    └─ code | STRING |  |',
                '| order_id | INT64 REQUIRED | The key \\| of the order |',
            ].join('\n'),
        ]);
        // With no description in the Project, BigQuery's
        assert.ok(tableHoverText(action(), FOUND).includes('**Description:** The table, as BigQuery has it'));
        // The code asks for a partition the table does not have: none is said
        assert.ok(!tableHoverText(action({ partition: 'order_date (day)' }), { state: 'found', fields: [] }).includes('Partition'));
    });

    test('a plain table id has no Kind', () => {
        const text = tableHoverText({ target: action().target }, FOUND).split('\n\n');
        assert.deepStrictEqual(text.slice(0, 4), [TITLE, SEARCH, '**Location:** EU', '**Description:** The table, as BigQuery has it']);
        assert.deepStrictEqual(tableHoverText({ target: action().target }, { state: 'missing' }).split('\n\n'), [TITLE, '_BigQuery has no table of this name._']);
    });

    test('a table that is not built yet says so, with the partition and the columns the code gives it', () => {
        const text = tableHoverText(action({ partition: 'order_date (day)', columns: [{ path: ['order_id'], description: 'The key' }] }), { state: 'missing' });
        assert.deepStrictEqual(text.split('\n\n'), [
            TITLE,
            '**Kind:** incremental',
            '_Not built yet: BigQuery has no table of this name._',
            '**Partition:** `order_date (day)`',
            '----',
            '| Column | Type | Description |\n|:---|:---|:---|\n| order_id |  | The key |',
        ]);
    });

    test('a table BigQuery could not be asked about says why, and an ephemeral model that it has none', () => {
        assert.ok(tableHoverText(action(), { state: 'unknown', error: 'Could not load the default credentials' }).includes('_BigQuery could not be asked about the table: Could not load the default credentials_'));
        const ephemeral = tableHoverText(action({ kind: 'ephemeral' }), undefined);
        assert.deepStrictEqual(ephemeral.split('\n\n'), ['#### orders', '**Kind:** ephemeral', '_An ephemeral model: it is inlined where it is read, and has no table._']);
    });

    test('a table of more columns than a hover lists says how many are left out, and where to find them', () => {
        const fields = Array.from({ length: 152 }, (_, index) => ({ name: `c${String(index).padStart(3, '0')}`, type: 'STRING' }));
        const text = tableHoverText(action(), { state: 'found', fields });
        assert.ok(text.includes('| c149 | STRING |  |') && !text.includes('| c150 |'));
        assert.ok(text.endsWith('_… 2 more fields not shown, use Search columns_'));
    });

    test('the table of BigQuery\'s metadata: a view has no row count, and a 404 is a table that is not built', () => {
        const metadata = {
            type: 'TABLE', numRows: '0', lastModifiedTime: '1767312000000', location: 'EU', description: 'Orders',
            timePartitioning: { type: 'DAY', field: 'order_date' }, schema: { fields: [{ name: 'order_id', type: 'INT64' }] },
        };
        assert.deepStrictEqual(tableOfMetadata(metadata), {
            state: 'found', fields: [{ name: 'order_id', type: 'INT64' }], description: 'Orders', location: 'EU', partition: 'order_date (day)', rows: 0, lastModified: 1767312000000,
        });
        assert.deepStrictEqual(tableOfMetadata({ type: 'VIEW', numRows: '0', schema: { fields: [] } }), { state: 'found', fields: [] });
        assert.deepStrictEqual(tableOfMetadata({ rangePartitioning: { field: 'customer_id' } }), { state: 'found', fields: [], partition: 'customer_id (range)' });
        assert.deepStrictEqual(tableOfError(Object.assign(new Error('Not found'), { code: 404 })), { state: 'missing' });
        assert.deepStrictEqual(tableOfError(new Error('No credentials')), { state: 'unknown', error: 'No credentials' });
    });
});
