import * as assert from 'assert';
import { suite, test } from 'mocha';
import { definitionLine } from './locate';

const YAML = `version: 2

sources:
  - name: raw
    tables:
      - name: orders_v2
      - name: orders
  - name: shop
    tables:
      - name: "orders"   # the shop's own

models:
  - name: stg_orders_daily
  - name: 'stg_orders'
    columns:
      - name: id
`;

suite('dbt: where a YAML file defines a resource', () => {
    test("a model's entry, in quotes or not, and not one its name only starts", () => {
        assert.strictEqual(definitionLine(YAML, { name: 'stg_orders' }), 13);
        assert.strictEqual(definitionLine(YAML, { name: 'stg_orders_daily' }), 12);
    });

    test("a source's table is looked for under its own source", () => {
        assert.strictEqual(definitionLine(YAML, { name: 'orders', sourceName: 'raw' }), 6);
        assert.strictEqual(definitionLine(YAML, { name: 'orders', sourceName: 'shop' }), 9);
    });

    test("the source's entry when its table is not listed", () => {
        assert.strictEqual(definitionLine(YAML, { name: 'payments', sourceName: 'shop' }), 7);
    });

    test('nothing when the file does not name it', () => {
        assert.strictEqual(definitionLine(YAML, { name: 'customers' }), undefined);
        assert.strictEqual(definitionLine('', { name: 'customers' }), undefined);
    });

    test('a file with Windows line ends', () => {
        assert.strictEqual(definitionLine(YAML.replace(/\n/g, '\r\n'), { name: 'stg_orders' }), 13);
    });
});
