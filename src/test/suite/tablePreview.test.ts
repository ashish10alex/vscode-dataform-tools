import * as assert from 'assert';
import { suite, test } from 'mocha';
import { declarationPreviewSql, previewMethod, tableName } from '../../bigquery/tablePreview';

suite('how a declared table is previewed', () => {
    const target = { database: 'warehouse-prod', schema: 'raw', name: 'orders' };

    test('only a base table is read without a query', () => {
        assert.strictEqual(previewMethod('TABLE'), 'rows');
        for (const type of ['VIEW', 'MATERIALIZED_VIEW', 'EXTERNAL', 'SNAPSHOT', undefined]) {
            assert.strictEqual(previewMethod(type), 'query', String(type));
        }
    });

    test('the query reads the whole table name in one pair of backticks, up to the limit', () => {
        assert.strictEqual(declarationPreviewSql(target, 1000), 'SELECT * FROM `warehouse-prod.raw.orders` LIMIT 1000');
        assert.strictEqual(declarationPreviewSql({ ...target, name: 'or`ders' }, 5), 'SELECT * FROM `warehouse-prod.raw.or\\`ders` LIMIT 5');
    });

    test('a table with no project is named by its dataset and name', () => {
        assert.strictEqual(tableName({ ...target, database: '' }), 'raw.orders');
    });
});
