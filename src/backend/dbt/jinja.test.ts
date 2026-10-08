import * as assert from 'assert';
import { suite, test } from 'mocha';
import { callAt, columnAt, jinjaCalls, tableAliases, typingArgument } from './jinja';

const SOURCE = `{{ config(materialized='table', pre_hook="grant select on {{ ref('audit') }} to x") }}
{# {{ ref('commented_out') }} #}
with payments as (
    select * from {{ source('stripe', "payments") }}
)
select o.order_id, {{ cents_to_dollars('amount') }} as amount,
       {{ dbt_utils.star(from=ref('shop', 'customers', v=2), except=["id"]) }}
  from {{ ref('stg_orders') }} as o
  join {{ ref("shop", "customers", version='2') }} c using (customer_id)
  left join {{ ref(var('other')) }} on true
 where {% if is_incremental() %} o.updated_at > (select max(updated_at) from {{ this }}) {% endif %}
`;

const at = (needle: string, into = 0) => SOURCE.indexOf(needle) + into;
const names = (text: string, yaml = false) => jinjaCalls(text, yaml).map((call) => `${call.name}(${call.args.map((argument) => argument.value).join(',')})`);

suite('dbt: calls in the Jinja of a file', () => {
    test('every call inside {{ }} and {% %}, and none inside a comment', () => {
        assert.deepStrictEqual(names(SOURCE), [
            'config()', 'ref(audit)', 'source(stripe,payments)', 'cents_to_dollars(amount)', 'dbt_utils.star()', 'ref(shop,customers)',
            'ref(stg_orders)', 'ref(shop,customers)', 'ref()', 'var(other)', 'is_incremental()',
        ]);
    });

    test('an argument is where its contents are, without the quotes', () => {
        const call = jinjaCalls(SOURCE).find((each) => each.kind === 'source');
        assert.ok(call);
        assert.deepStrictEqual(call.args.map((argument) => SOURCE.slice(argument.start, argument.end)), ['stripe', 'payments']);
        assert.strictEqual(SOURCE.slice(call.start, call.end), `source('stripe', "payments")`);
        assert.strictEqual(SOURCE.slice(call.nameStart, call.nameEnd), 'source');
    });

    test("a ref's version, as v= or version=, and not among its arguments", () => {
        const versions = jinjaCalls(SOURCE).filter((call) => call.kind === 'ref').map((call) => call.version);
        assert.deepStrictEqual(versions, [undefined, '2', undefined, '2', undefined]);
    });

    test('an argument that is not a string ends the arguments', () => {
        assert.deepStrictEqual(names(`{{ ref(pkg, 'model') }} {{ source('a' ~ suffix, 'b') }}`), ['ref()', 'source()']);
    });

    test('a call left open runs to where the text stops', () => {
        const [call] = jinjaCalls(`select * from {{ ref('orders'`);
        assert.strictEqual(call.closed, false);
        assert.deepStrictEqual(call.args.map((argument) => argument.value), []);
    });

    test('the call at an offset is the innermost one', () => {
        assert.strictEqual(callAt(SOURCE, at("'customers', v=2", 3))?.kind, 'ref');
        assert.strictEqual(callAt(SOURCE, at('dbt_utils.star', 4))?.name, 'dbt_utils.star');
        assert.strictEqual(callAt(SOURCE, at('except=', 2))?.name, 'dbt_utils.star');
        assert.strictEqual(callAt(SOURCE, at('cents_to_dollars', 1))?.kind, 'macro');
        assert.strictEqual(callAt(SOURCE, at('select o.order_id', 3)), undefined);
        assert.strictEqual(callAt(SOURCE, at('commented_out', 3)), undefined);
    });

    test('the alias a table is read under, with and without "as"; a keyword is not one', () => {
        const aliases = tableAliases(SOURCE);
        assert.deepStrictEqual([...aliases.keys()], ['o', 'c']);
        assert.strictEqual(aliases.get('o')?.args[0].value, 'stg_orders');
        assert.strictEqual(aliases.get('c')?.args[1].value, 'customers');
    });
});

suite('dbt: calls in a YAML file', () => {
    const YAML = `models:
  - name: orders
    description: "the customer's orders, see {{ ref('stg_orders') }}"
    columns:
      - name: customer_id
        tests:
          - relationships:
              to: ref('customers')   # not ref('old_customers')
              field: id
          - dbt_utils.expression_is_true(expression="> 0")
  # - name: source('a', 'b')
exposures:
  - name: weekly
    depends_on: [source("stripe", "payments"), ref('orders')]
`;

    test('ref() and source() with and without braces, not in a # comment, and no other call', () => {
        assert.deepStrictEqual(names(YAML, true), ['ref(stg_orders)', 'ref(customers)', 'source(stripe,payments)', 'ref(orders)']);
        assert.strictEqual(callAt(YAML, YAML.indexOf("'customers'") + 3, true)?.args[0].value, 'customers');
        assert.strictEqual(callAt(YAML, YAML.indexOf('old_customers'), true), undefined);
        assert.strictEqual(jinjaCalls(YAML, true).some((call) => call.alias), false);
    });
});

suite('dbt: the argument being typed', () => {
    const typing = (text: string) => typingArgument(text, text.indexOf('|') < 0 ? text.length : text.indexOf('|'));
    const strip = (text: string) => typingArgument(text.replace('|', ''), text.indexOf('|'));

    test('the first argument of a ref() or source(), open or closed by the editor', () => {
        assert.deepStrictEqual(typing(`select * from {{ ref('stg_`), { kind: 'ref', index: 0, before: [], prefix: 'stg_', start: 22 });
        assert.deepStrictEqual(strip(`select * from {{ ref('stg_|') }}`), { kind: 'ref', index: 0, before: [], prefix: 'stg_', start: 22 });
        assert.deepStrictEqual(strip(`{{ source("|") }}`), { kind: 'source', index: 0, before: [], prefix: '', start: 11 });
    });

    test('a later argument, with the ones before it', () => {
        assert.deepStrictEqual(strip(`{{ source('stripe', 'pay|') }}`), { kind: 'source', index: 1, before: ['stripe'], prefix: 'pay', start: 21 });
        assert.deepStrictEqual(strip(`{{ dbt_utils.star(from=ref('shop', '|')) }}`)?.before, ['shop']);
    });

    test('nothing outside the quotes, in a keyword, in another call or outside Jinja', () => {
        assert.strictEqual(strip(`{{ ref(|) }}`), undefined);
        assert.strictEqual(strip(`{{ ref('a'|) }}`), undefined);
        assert.strictEqual(strip(`{{ ref('a', v='|') }}`), undefined);
        assert.strictEqual(strip(`{{ config(alias='|') }}`), undefined);
        assert.strictEqual(strip(`select 'ref(|'`), undefined);
        assert.strictEqual(strip(`{{ ref('a') }} where x = '|'`), undefined);
    });
});

suite('dbt: a column name in the SQL of a file', () => {
    test('the word at an offset, with the alias before its dot', () => {
        assert.deepStrictEqual(columnAt(SOURCE, at('o.order_id', 4)), { qualifier: 'o', word: 'order_id', start: at('o.order_id', 2), end: at('o.order_id', 10) });
        assert.deepStrictEqual(columnAt(SOURCE, at('customer_id)', 2)), { word: 'customer_id', start: at('customer_id)'), end: at('customer_id)', 11) });
    });

    test('nothing inside Jinja, on a number or on no word', () => {
        assert.strictEqual(columnAt(SOURCE, at('stg_orders', 2)), undefined);
        assert.strictEqual(columnAt(SOURCE, at('commented_out', 2)), undefined);
        assert.strictEqual(columnAt('select 12 from x', 8), undefined);
        assert.strictEqual(columnAt('select  from x', 7), undefined);
    });

    test('what is typed of one so far, which may be nothing after a dot', () => {
        assert.deepStrictEqual(columnAt('select o.ord', 12, true), { qualifier: 'o', word: 'ord', start: 9, end: 12 });
        assert.deepStrictEqual(columnAt('select o.', 9, true), { qualifier: 'o', word: '', start: 9, end: 9 });
        assert.deepStrictEqual(columnAt('select ordxx', 10, true), { word: 'ord', start: 7, end: 10 });
        assert.strictEqual(columnAt('select ', 7, true), undefined);
    });
});
