import * as assert from 'assert';
import { suite, test } from 'mocha';
import { dbtRefReads } from '../../backend/dbt';
import type { DbtRefRead } from '../../backend/dbt';
import { dbtRefHints } from '../../defer/dbtRefHints';

const dev = (name: string) => ({ database: 'p-dev', schema: 'shop', name });
const prod = (name: string) => ({ database: 'p-prod', schema: 'shop', name });
const SQL = [
    "select * from {{ ref('fct_orders') }} as o",
    "join {{ ref('dim_customers') }} as c using (customer_id)",
    "join {{ ref('int_countries') }} using (country_code)",
    "join {{ source('raw', 'payments') }} using (order_id)",
].join('\n');
/** As the Backend's editor does: the Action the call at the offset names, here by the model's name */
const resolve = (text: string) => (offset: number) => {
    const name = /^(?:ref|source)\('(\w+)'/.exec(text.slice(offset))?.[1];
    return name ? `p-dev.shop.${name}` : undefined;
};
const reads: Record<string, DbtRefRead> = dbtRefReads({ deferred: [{ dev: dev('fct_orders'), prod: prod('fct_orders') }], builtInDev: [dev('dim_customers')] });
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

suite('dbt defer to prod: the labels after a ref()', () => {
    test('a ref read from prod and one read from the dbt target are labelled, and nothing else is', () => {
        const hints = dbtRefHints(SQL, resolve(SQL), reads, () => undefined, NOW);
        assert.deepStrictEqual(hints.map((hint) => [SQL.slice(hint.start, hint.end), hint.label, hint.kind]), [
            ["ref('fct_orders') }}", '→ deferred to prod', 'prod'],
            ["ref('dim_customers') }}", '✓ dev · built in dev', 'dev'],
        ]);
    });

    test('the hover gives the table in the dbt target, the one in prod, and a link to it', () => {
        const [deferred, built] = dbtRefHints(SQL, resolve(SQL), reads, () => undefined, NOW);
        assert.match(deferred.hover, /not built in dev, so read from prod/);
        assert.match(deferred.hover, /`p-dev\.shop\.fct_orders`[\s\S]*→ `p-prod\.shop\.fct_orders`/);
        assert.match(deferred.hover, /\[Open prod table in BigQuery\]\(https:\/\/console\.cloud\.google\.com\/bigquery/);
        assert.match(built.hover, /built in dev, so read from dev[\s\S]*`p-dev\.shop\.dim_customers`/);
    });

    test('the age of a table in the dbt target is said where it is known', () => {
        const twelveMinutesAgo = NOW - 12 * 60 * 1000;
        const hints = dbtRefHints(SQL, resolve(SQL), reads, (id) => (id === 'p-dev.shop.dim_customers' ? twelveMinutesAgo : undefined), NOW);
        assert.match(hints[1].label, /^✓ dev · built 12 min/);
        assert.strictEqual(hints[0].label, '→ deferred to prod');
    });

    test('the labels follow the refs as the text changes, by the model each names', () => {
        const edited = `-- a new first line\n${SQL.replace("ref('fct_orders')", "ref( 'fct_orders' )")}\nunion all select * from {{ ref('fct_orders') }}`;
        const hints = dbtRefHints(edited, (offset) => (edited.slice(offset).startsWith("ref( 'fct_orders'") ? 'p-dev.shop.fct_orders' : resolve(edited)(offset)), reads, () => undefined, NOW);
        assert.deepStrictEqual(hints.map((hint) => hint.label), ['→ deferred to prod', '✓ dev · built in dev', '→ deferred to prod']);
        assert.ok(hints.every((hint) => edited.slice(hint.start, hint.end).endsWith('}}')));
    });

    test('a ref inside a macro call, with no braces of its own after it, is labelled at its bracket', () => {
        const sql = "select {{ dbt_utils.star(from=ref('fct_orders')) }} from x";
        const [hint] = dbtRefHints(sql, resolve(sql), reads, () => undefined, NOW);
        assert.strictEqual(sql.slice(hint.start, hint.end), "ref('fct_orders')");
    });

    test('no label for a ref that is not closed, or in a Jinja comment', () => {
        const sql = "{# {{ ref('fct_orders') }} #}\nselect * from {{ ref('fct_orders'";
        assert.deepStrictEqual(dbtRefHints(sql, resolve(sql), reads, () => undefined, NOW), []);
    });
});
