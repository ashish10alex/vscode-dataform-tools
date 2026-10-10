import * as assert from 'assert';
import { suite, test } from 'mocha';
import fs from 'fs';
import path from 'path';
import { dbtEditor } from './editor';
import { exampleProjectRoot, fullManifestPath } from './fixtures';
import { buildDbtGraph } from './graph';
import { definitionLine, testLine } from './locate';

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

suite('dbt: where a YAML file declares a generic test', () => {
    const TESTS = `models:
  - name: stg_customers
    data_tests:
      - dbt_utils.expression_is_true:
          expression: "not_null > 0"
    columns:
      - name: customer_id
        data_tests: [unique, not_null]   # both
      - name: email
        description: must be not_null in spirit
  - name: stg_orders
    columns:
      - name: customer_id
        data_tests:
          # - unique
          - not_null
          - relationships:
              to: ref('stg_customers')
`;
    const line = (test: Parameters<typeof testLine>[1]) => {
        const at = testLine(TESTS, test);
        return at === undefined ? undefined : TESTS.split('\n')[at].trim();
    };

    test('the line with its name under its column, of its own model', () => {
        assert.strictEqual(line({ name: 'not_null', under: 'stg_customers', column: 'customer_id' }), 'data_tests: [unique, not_null]   # both');
        assert.strictEqual(line({ name: 'not_null', under: 'stg_orders', column: 'customer_id' }), '- not_null');
        assert.strictEqual(line({ name: 'relationships', under: 'stg_orders', column: 'customer_id' }), '- relationships:');
    });

    test('a test of the model itself, by its name as a whole word', () => {
        assert.strictEqual(line({ name: 'expression_is_true', under: 'stg_customers' }), '- name: stg_customers');
        assert.strictEqual(line({ name: 'dbt_utils.expression_is_true', under: 'stg_customers' }), '- dbt_utils.expression_is_true:');
    });

    test('the entry it is under when its name is not there, in a comment, or past the next entry; nothing with no entry', () => {
        assert.strictEqual(line({ name: 'unique', under: 'stg_orders', column: 'customer_id' }), '- name: customer_id');
        assert.strictEqual(line({ name: 'not_null', under: 'stg_customers', column: 'email' }), '- name: email');
        assert.strictEqual(line({ name: 'accepted_values', under: 'stg_orders', column: 'nope' }), '- name: stg_orders');
        assert.strictEqual(line({ name: 'not_null', under: 'nope' }), undefined);
    });

    test("the dbt Backend places each test of the example Project, from what either engine's manifest says of it", () => {
        const yaml = fs.readFileSync(path.join(exampleProjectRoot('dbt'), 'models/staging/_staging.yml'), 'utf8');
        for (const engine of ['dbt-core', 'dbt-v2'] as const) {
            const data = buildDbtGraph(JSON.parse(fs.readFileSync(fullManifestPath(engine), 'utf8')));
            const editor = dbtEditor(() => data);
            const placed = (name: string) => {
                const id = Object.keys(data.dbt.names).find((each) => data.dbt.names[each].name.startsWith(name))!;
                const place = editor.placeOf(id);
                return [place?.fileName, yaml.split('\n')[place!.lineIn!(yaml)!].trim()];
            };
            assert.deepStrictEqual(placed('not_null_stg_orders_order_id'), ['models/staging/_staging.yml', 'data_tests: [not_null]'], engine);
            assert.deepStrictEqual(placed('relationships_stg_orders'), ['models/staging/_staging.yml', '- relationships:'], engine);
            assert.deepStrictEqual(placed('accepted_values_stg_orders'), ['models/staging/_staging.yml', '- accepted_values:'], engine);
            // A model's place is its file, and a singular test's its own
            assert.deepStrictEqual(editor.placeOf('alex-personal-dev-01.xf_example.stg_orders'), { fileName: 'models/staging/stg_orders.sql' });
        }
    });
});
