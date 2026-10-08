import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import type { Editor } from '../backend';
import { DbtBackend } from './backend';
import { dbtEditor, macroLine } from './editor';
import { exampleProjectRoot, fullManifestPath } from './fixtures';
import { DbtGraph, DbtManifest, buildDbtGraph } from './graph';

const P = 'alex-personal-dev-01.xf_example';
const root = exampleProjectRoot('dbt');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = (name: 'dbt-core' | 'dbt-v2'): DbtManifest => JSON.parse(fs.readFileSync(fullManifestPath(name), 'utf8'));

/** The document of a file of the example Project, with the place just after the start of `needle` */
const at = (file: string, needle: string, into = 1, text = read(file)) => {
    assert.ok(text.includes(needle), `${file} has no ${needle}`);
    return { file, text, offset: text.indexOf(needle) + into };
};

for (const engine of ['dbt-core', 'dbt-v2'] as const) {
    suite(`dbt editor part, ${engine}`, () => {
        const editor = dbtEditor(() => buildDbtGraph(manifest(engine)));
        const FCT = 'models/marts/fct_orders.sql';

        test('a ref() goes to the file of its model, and its range is the call', () => {
            const document = at(FCT, "'stg_orders'", 3);
            const found = editor.definitionAt(document);
            assert.strictEqual(found?.place.fileName, 'models/staging/stg_orders.sql');
            assert.strictEqual(found.place.lineIn, undefined);
            assert.strictEqual(document.text.slice(found.start, found.end), "ref('stg_orders')");
            assert.strictEqual(editor.tableAt(document)?.id, `${P}.stg_orders`);
        });

        test('a source() goes to its table in the YAML file of its source', () => {
            const found = editor.definitionAt(at('models/staging/stg_orders.sql', "'orders'", 2));
            assert.strictEqual(found?.place.fileName, 'models/staging/_sources.yml');
            const line = found.place.lineIn?.(read('models/staging/_sources.yml'));
            assert.strictEqual(read('models/staging/_sources.yml').split('\n')[line!].trim(), '- name: orders');
            assert.strictEqual(found.place.lineIn?.('sources: []'), undefined);
        });

        test('a ref() without a version is the latest version, and v= another', () => {
            const text = "select * from {{ ref('customer_segments') }} join {{ ref('customer_segments', v=1) }}";
            const file = 'models/marts/x.sql';
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.indexOf('customer_segments') })?.place.fileName, 'models/marts/customer_segments_v2.sql');
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.lastIndexOf('customer_segments') })?.place.fileName, 'models/marts/customer_segments_v1.sql');
        });

        test('a ref() names a seed and a snapshot, with a package or without', () => {
            const text = "{{ ref('country_codes') }} {{ ref('xf_example', 'customers_snapshot') }} {{ ref('other', 'country_codes') }}";
            const file = 'models/x.sql';
            assert.strictEqual(editor.tableAt({ file, text, offset: 8 })?.id, 'alex-personal-dev-01.xf_example_reference.country_codes');
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.indexOf('customers_snapshot') })?.place.fileName, 'snapshots/customers_snapshot.yml');
            assert.strictEqual(editor.tableAt({ file, text, offset: text.indexOf("'other'") })?.id, undefined);
        });

        test('a ref() written in a YAML file, with braces or without', () => {
            const found = editor.definitionAt(at('models/reporting/_exposures.yml', "ref('daily_revenue')", 6));
            assert.strictEqual(found?.place.fileName, 'models/marts/daily_revenue.sql');
            assert.strictEqual(editor.definitionAt(at('models/marts/_marts.yml', "ref('stg_payments')", 8))?.place.fileName, 'models/staging/stg_payments.sql');
        });

        test('a macro call goes to its {% macro %} line, from its name and not from its arguments', () => {
            const text = "select {{ cents_to_dollars('amount') }}, {{ xf_example.record_run_in_audit_log() }}, {{ dbt_utils.star(x) }}, {{ var('a') }}";
            const file = 'models/x.sql';
            const found = editor.definitionAt({ file, text, offset: text.indexOf('cents_to') + 2 });
            assert.strictEqual(found?.place.fileName, 'macros/cents_to_dollars.sql');
            assert.strictEqual(found.place.lineIn?.(read('macros/cents_to_dollars.sql')), 0);
            assert.strictEqual(text.slice(found.start, found.end), 'cents_to_dollars');
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.indexOf("'amount'") + 2 }), undefined);
            const audit = editor.definitionAt({ file, text, offset: text.indexOf('record_run') });
            assert.strictEqual(audit?.place.fileName, 'macros/audit.sql');
            assert.strictEqual(audit.place.lineIn?.(read('macros/audit.sql')), 5);
            // A package that is not installed, and a function of dbt's own
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.indexOf('dbt_utils') }), undefined);
            assert.strictEqual(editor.definitionAt({ file, text, offset: text.indexOf('var(') }), undefined);
        });

        test('nothing for a name the Project does not have, or outside a call', () => {
            assert.strictEqual(editor.definitionAt({ file: 'models/x.sql', text: "{{ ref('nope') }} {{ source('raw', 'nope') }}", offset: 9 }), undefined);
            assert.strictEqual(editor.tableAt({ file: 'models/x.sql', text: "{{ ref('nope') }} {{ source('raw', 'nope') }}", offset: 30 }), undefined);
            assert.strictEqual(editor.definitionAt(at(FCT, 'o.order_id')), undefined);
        });

        test('a column after an alias is of the table the alias names; a bare one of every table the file reads', () => {
            const qualified = editor.columnAt(at(FCT, 'p.amount', 3));
            assert.deepStrictEqual([qualified?.word, qualified?.qualified, qualified?.tables], ['amount', true, [`${P}.stg_payments`]]);
            const bare = editor.columnAt(at(FCT, 'max(order_date)', 6));
            assert.deepStrictEqual([bare?.word, bare?.qualified, bare?.tables], ['order_date', false, [`${P}.stg_orders`, `${P}.stg_payments`]]);
            // Inside Jinja a word is not a column
            assert.strictEqual(editor.columnAt(at(FCT, "unique_key='order_id'", 14)), undefined);
        });

        test("a table read without an alias is named by its own name; a CTE's name is no table", () => {
            const text = "with x as (select 1 as id) select stg_orders.status, x.id from {{ ref('stg_orders') }} join x on true";
            const file = 'models/x.sql';
            assert.deepStrictEqual(editor.columnAt({ file, text, offset: text.indexOf('.status') + 3 })?.tables, [`${P}.stg_orders`]);
            assert.deepStrictEqual(editor.columnAt({ file, text, offset: text.indexOf('x.id') + 3 })?.tables, []);
            assert.deepStrictEqual(editor.columnAt({ file, text: 'select o.', offset: 9 }, true), { word: '', start: 9, end: 9, qualified: true, tables: [] });
        });

        const typed = (text: string) => editor.namesAt({ file: 'models/x.sql', text: text.replace('|', ''), offset: text.indexOf('|') });

        test("the names a ref() can take: models, seeds and snapshots, each once, and no test or source", () => {
            const names = typed("{{ ref('|') }}");
            assert.strictEqual(names?.start, 8);
            assert.deepStrictEqual(names.names.map((each) => each.name), [
                'country_codes', 'customer_segments', 'customers_snapshot', 'daily_revenue', 'dim_customers', 'fct_orders', 'int_customer_countries',
                'revenue_report', 'stg_customers', 'stg_orders', 'stg_payments',
            ]);
            assert.deepStrictEqual(names.names.find((each) => each.name === 'fct_orders'), { name: 'fct_orders', detail: 'incremental', id: `${P}.fct_orders` });
            assert.deepStrictEqual(typed("{{ ref('xf_example', 'stg_|') }}")?.names.length, 11);
            assert.deepStrictEqual(typed("{{ ref('other', '|') }}")?.names, []);
            assert.strictEqual(typed("{{ ref('a', 'b', '|') }}"), undefined);
        });

        test('the names a source() can take: its sources, then the tables of one', () => {
            assert.deepStrictEqual(typed('{{ source("|") }}')?.names, [{ name: 'raw', detail: 'source' }]);
            assert.deepStrictEqual(typed("{{ source('raw', 'p|') }}"), { start: 18, names: ['customers', 'orders', 'payments'].map((name) => ({ name, detail: 'source', id: `alex-personal-dev-01.raw.${name}` })) });
            assert.deepStrictEqual(typed("{{ source('nope', '|') }}")?.names, []);
        });
    });
}

suite('dbt editor part', () => {
    test('answers nothing before the first compile', () => {
        const editor: Editor = new DbtBackend().editor;
        const document = { file: 'models/x.sql', text: "{{ ref('stg_orders') }} o.id", offset: 10 };
        assert.strictEqual(editor.definitionAt(document), undefined);
        assert.strictEqual(editor.tableAt(document), undefined);
        assert.strictEqual(editor.columnAt({ ...document, offset: 27 }), undefined);
        assert.strictEqual(editor.namesAt(document), undefined);
    });

    test("a file of a package names its own package's model before the Project's, and the Project's macro before a package's", () => {
        const data: DbtGraph = buildDbtGraph(manifest('dbt-core'));
        const stg = data.dbt.names[`${P}.stg_orders`];
        // The same name in an installed package
        const id = 'p.d.stg_orders';
        data.graph.actions[id] = { ...data.graph.actions[`${P}.stg_orders`], id, fileName: 'dbt_packages/shop/models/stg_orders.sql' };
        data.dbt.names[id] = { ...stg, package: 'shop' };
        data.dbt.macros.push({ name: 'cents_to_dollars', package: 'shop', fileName: 'dbt_packages/shop/macros/money.sql', arguments: [] });
        const editor = dbtEditor(() => data);
        const text = "{{ ref('stg_orders') }} {{ cents_to_dollars(1) }} {{ shop.cents_to_dollars(1) }}";
        const from = (file: string, needle: string) => editor.definitionAt({ file, text, offset: text.indexOf(needle) + 1 })?.place.fileName;
        assert.strictEqual(from('models/x.sql', 'ref'), 'models/staging/stg_orders.sql');
        assert.strictEqual(from('dbt_packages/shop/models/y.sql', 'ref'), 'dbt_packages/shop/models/stg_orders.sql');
        assert.strictEqual(from('models/x.sql', 'cents_to'), 'macros/cents_to_dollars.sql');
        assert.strictEqual(from('dbt_packages/shop/models/y.sql', 'cents_to'), 'dbt_packages/shop/macros/money.sql');
        assert.strictEqual(from('models/x.sql', 'shop.cents'), 'dbt_packages/shop/macros/money.sql');
    });

    test('the line of a macro, and of a generic test, which dbt names test_<name>', () => {
        const text = '{# helpers #}\n{%- macro  cents_to_dollars(column) -%}\n{% endmacro %}\n{% test positive(model, column_name) %}\n{% endtest %}\n';
        assert.strictEqual(macroLine(text, 'cents_to_dollars'), 1);
        assert.strictEqual(macroLine(text, 'test_positive'), 3);
        assert.strictEqual(macroLine(text, 'cents'), undefined);
    });
});
