import * as assert from 'assert';
import { suite, test } from 'mocha';
import { diffNames } from '../../../webviews/preview_compiled/utils/nameDiff';

suite('nameDiff.diffNames', () => {
    test('a table prefix is the only difference', () => {
        assert.deepStrictEqual(diffNames('AA_0500_CALENDAR', '0500_CALENDAR'), { prefix: '', before: 'AA_', after: '', suffix: '0500_CALENDAR' });
    });

    test('a schema suffix is the only difference', () => {
        assert.deepStrictEqual(diffNames('sales_dev', 'sales'), { prefix: 'sales', before: '_dev', after: '', suffix: '' });
    });

    test('projects differ in their last word', () => {
        assert.deepStrictEqual(diffNames('my-project-dev', 'my-project-prod'), { prefix: 'my-project-', before: 'dev', after: 'prod', suffix: '' });
    });

    test('widens the difference to whole words', () => {
        assert.deepStrictEqual(diffNames('sales_v2', 'sales_v3'), { prefix: 'sales_', before: 'v2', after: 'v3', suffix: '' });
        assert.deepStrictEqual(diffNames('orders_daily', 'orders_weekly'), { prefix: 'orders_', before: 'daily', after: 'weekly', suffix: '' });
    });

    test('does not split a repeated word between the prefix and the shared end', () => {
        assert.deepStrictEqual(diffNames('AA_A_TABLE', 'A_TABLE'), { prefix: '', before: 'AA_', after: '', suffix: 'A_TABLE' });
    });

    test('equal names differ in nothing', () => {
        assert.deepStrictEqual(diffNames('getPlatform', 'getPlatform'), { prefix: '', before: '', after: '', suffix: 'getPlatform' });
    });
});
