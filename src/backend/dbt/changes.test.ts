import * as assert from 'assert';
import fs from 'fs';
import { suite, test } from 'mocha';
import { dbtChangesArguments, listedIds, manifestChanges } from './changes';
import { fullManifestPath } from './fixtures';
import type { DbtManifest } from './graph';

type Loose = Record<string, any>;
const P = 'alex-personal-dev-01';
const recorded = (recording: 'dbt-core' | 'dbt-v2') => JSON.parse(fs.readFileSync(fullManifestPath(recording), 'utf8')) as DbtManifest & Loose;
/** The Project as it is on a branch: `edit` changes a copy of the recorded manifest */
const branch = (recording: 'dbt-core' | 'dbt-v2', edit: (manifest: Loose) => void) => {
    const head = recorded(recording);
    edit(head);
    return { base: recorded(recording), head };
};
const reasons = (changes: ReturnType<typeof manifestChanges>) => Object.fromEntries(changes.changed.map((action) => [action.target.name, action.reasons]));

suite('what `dbt ls` listed as changed', () => {
    test('asks for state:modified against the base, without the tests of what changed', () => {
        assert.deepStrictEqual(dbtChangesArguments('/store/base/target'), [
            '--select', 'state:modified', '--state', '/store/base/target', '--indirect-selection', 'empty', '--output', 'json', '--output-keys', 'unique_id',
        ]);
    });

    test('each row is a PrintEvent of the JSON log, in either engine', () => {
        const core = [
            '{"data": {"log_version": 3, "version": "=1.12.5"}, "info": {"code": "A001", "msg": "Running with dbt=1.12.5", "name": "MainReportVersion"}}',
            '{"data": {"msg": "{\\"unique_id\\": \\"model.xf_example.fct_orders\\"}"}, "info": {"code": "Z052", "msg": "{\\"unique_id\\": \\"model.xf_example.fct_orders\\"}", "name": "PrintEvent"}}',
            '{"data": {"msg": "{\\"unique_id\\": \\"seed.xf_example.country_codes\\"}"}, "info": {"code": "Z052", "name": "PrintEvent"}}',
        ].join('\n');
        assert.deepStrictEqual(listedIds(core), ['model.xf_example.fct_orders', 'seed.xf_example.country_codes']);
        const v2 = [
            '{"data":{"msg":"Loading profiles.yml"},"info":{"code":"","msg":"Loading profiles.yml","name":"Generic"}}',
            '{"data":{"msg":"{\\"unique_id\\":\\"model.xf_example.new_model\\"}"},"info":{"code":"Z052","name":"PrintEvent"}}\r',
            '',
        ].join('\n');
        assert.deepStrictEqual(listedIds(v2), ['model.xf_example.new_model']);
    });

    test('a line that is not a row is left out', () => {
        assert.deepStrictEqual(listedIds('PrintEvent but not JSON\n{"info":{"name":"PrintEvent"},"data":{"msg":"not a row"}}\n{"info":{"name":"PrintEvent"},"data":{"msg":"{\\"name\\":\\"x\\"}"}}'), []);
    });
});

for (const recording of ['dbt-core', 'dbt-v2'] as const) {
    suite(`why an action changed, from the two manifests (${recording})`, () => {
        test('new, sql, config and macro', () => {
            const { base, head } = branch(recording, (manifest) => {
                manifest.nodes['model.xf_example.fct_orders'].checksum = { name: 'sha256', checksum: 'edited' };
                manifest.nodes['model.xf_example.dim_customers'].unrendered_config = { ...manifest.nodes['model.xf_example.dim_customers'].unrendered_config, materialized: 'view' };
                manifest.macros['macro.xf_example.cents_to_dollars'].macro_sql += ' -- edited';
                manifest.nodes['model.xf_example.new_model'] = {
                    ...manifest.nodes['model.xf_example.daily_revenue'], unique_id: 'model.xf_example.new_model', name: 'new_model', alias: 'new_model',
                    fqn: ['xf_example', 'marts', 'new_model'], original_file_path: 'models/marts/new_model.sql',
                };
            });
            const changes = manifestChanges(base, head, ['model.xf_example.fct_orders', 'model.xf_example.dim_customers', 'model.xf_example.stg_payments', 'model.xf_example.new_model']);
            assert.deepStrictEqual(reasons(changes), { dim_customers: ['config'], fct_orders: ['sql'], new_model: ['new'], stg_payments: ['macro'] });
            assert.deepStrictEqual(changes.deleted, []);
        });

        test('an action can have changed for more than one reason, and one dbt lists for none that is read is given config', () => {
            const { base, head } = branch(recording, (manifest) => {
                const model = manifest.nodes['model.xf_example.stg_payments'];
                model.checksum = { name: 'sha256', checksum: 'edited' };
                model.unrendered_config = { ...model.unrendered_config, materialized: 'table' };
                manifest.macros['macro.xf_example.cents_to_dollars'].macro_sql += ' -- edited';
            });
            const changes = manifestChanges(base, head, ['model.xf_example.stg_payments', 'model.xf_example.daily_revenue']);
            assert.deepStrictEqual(reasons(changes), { daily_revenue: ['config'], stg_payments: ['sql', 'config', 'macro'] });
        });

        test('settings written in another order are the same settings', () => {
            const { base, head } = branch(recording, (manifest) => {
                const model = manifest.nodes['model.xf_example.fct_orders'];
                model.unrendered_config = Object.fromEntries(Object.entries(model.unrendered_config).reverse());
                model.checksum = { ...model.checksum, checksum: 'edited' };
            });
            assert.deepStrictEqual(reasons(manifestChanges(base, head, ['model.xf_example.fct_orders'])), { fct_orders: ['sql'] });
        });

        test('a macro that calls a changed macro has changed', () => {
            const { base, head } = branch(recording, (manifest) => {
                manifest.macros['macro.xf_example.outer'] = { ...manifest.macros['macro.xf_example.cents_to_dollars'], name: 'outer', depends_on: { macros: ['macro.xf_example.cents_to_dollars', 'macro.xf_example.outer'] } };
                manifest.nodes['model.xf_example.daily_revenue'].depends_on.macros = ['macro.xf_example.outer'];
                manifest.macros['macro.xf_example.cents_to_dollars'].macro_sql += ' -- edited';
            });
            // At the base the model called the same macro, which called itself and the other: only the text differs
            base.macros!['macro.xf_example.outer'] = structuredClone(head.macros!['macro.xf_example.outer']);
            assert.deepStrictEqual(reasons(manifestChanges(base, head, ['model.xf_example.daily_revenue'])), { daily_revenue: ['macro'] });
        });

        test('only what a run can execute is listed, each once, by file', () => {
            const { base, head } = branch(recording, () => undefined);
            const changes = manifestChanges(base, head, [
                'seed.xf_example.country_codes', 'source.xf_example.raw.orders', 'exposure.xf_example.revenue_dashboard', 'model.xf_example.int_customer_countries',
                'model.xf_example.fct_orders', 'model.xf_example.fct_orders', 'unit_test.xf_example.fct_orders.test_fct_orders_sums_payments', 'model.xf_example.gone',
            ]);
            assert.deepStrictEqual(changes.changed.map((action) => [action.fileName, action.target.name, action.kind]), [
                ['models/marts/_marts.yml', 'test_fct_orders_sums_payments', 'unit test'],
                ['models/marts/fct_orders.sql', 'fct_orders', 'incremental'],
                ['seeds/country_codes.csv', 'country_codes', 'seed'],
            ]);
            assert.strictEqual(changes.changed[1].id, `${P}.xf_example.fct_orders`);
        });

        test('gives what dbt calls each changed action, for a run that selects it', () => {
            const { base, head } = branch(recording, () => undefined);
            const changes = manifestChanges(base, head, ['model.xf_example.customer_segments.v2', 'test.xf_example.unique_fct_orders_order_id.523ddb6ce5']);
            assert.deepStrictEqual(Object.values(changes.names).map((name) => name.qualifiedName).sort(), ['xf_example.marts.customer_segments.v2', 'xf_example.marts.unique_fct_orders_order_id']);
        });

        test('an action the Project no longer defines is deleted, with what the base said of it', () => {
            const { base, head } = branch(recording, (manifest) => {
                delete manifest.nodes['model.xf_example.daily_revenue'];
                delete manifest.sources['source.xf_example.raw.orders'];
            });
            const changes = manifestChanges(base, head, []);
            assert.deepStrictEqual(changes.changed, []);
            assert.deepStrictEqual(changes.deleted.map((action) => [action.fileName, action.target.name, action.kind]), [['models/marts/daily_revenue.sql', 'daily_revenue', 'materialized view']]);
        });
    });
}
