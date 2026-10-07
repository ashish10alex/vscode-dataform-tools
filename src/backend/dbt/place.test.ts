import * as assert from 'assert';
import { suite, test } from 'mocha';
import { namesMissingRef, placeDbtError } from './place';

const SOURCE = `{{ config(materialized='table') }}

select *
  from {{ ref('stg_order') }} o
  join {{ ref("shop", "customers", v=2) }} c using (customer_id)
`;

suite('dbt: where a compile error is in its file', () => {
    test('on the line dbt gave, from its first character to its end', () => {
        assert.deepStrictEqual(placeDbtError({ message: 'unexpected end of template', line: 4 }, SOURCE), { line: 3, start: 2, end: 31 });
    });

    test('a line the file does not have is no place', () => {
        assert.strictEqual(placeDbtError({ message: 'x', line: 40 }, SOURCE), undefined);
    });

    test("on the ref() the error names, when dbt gave no line", () => {
        const error = { message: "Model 'fct_orders' depends on a node named 'stg_order' which was not found" };
        assert.strictEqual(namesMissingRef(error), true);
        assert.deepStrictEqual(placeDbtError(error, SOURCE), { line: 3, start: 15, end: 24 });
        // A ref with a package and a version: the name is found among its arguments
        assert.deepStrictEqual(placeDbtError({ message: "depends on a node named 'customers' which was not found" }, SOURCE), { line: 4, start: 23, end: 32 });
    });

    test('nowhere when the name is not in a ref() of the file: there is no fallback to the first line', () => {
        assert.strictEqual(placeDbtError({ message: "depends on a node named 'payments' which was not found" }, SOURCE), undefined);
        // The name alone, outside a ref(), is not a place
        assert.strictEqual(placeDbtError({ message: "depends on a node named 'table' which was not found" }, SOURCE), undefined);
    });

    test('nowhere for an error with no line and no ref', () => {
        const error = { message: "'cents_to_dolars' is undefined" };
        assert.strictEqual(namesMissingRef(error), false);
        assert.strictEqual(placeDbtError(error, SOURCE), undefined);
    });

    test('a file with Windows line ends is placed the same', () => {
        assert.deepStrictEqual(placeDbtError({ message: 'x', line: 4 }, SOURCE.replace(/\n/g, '\r\n')), { line: 3, start: 2, end: 31 });
    });
});
