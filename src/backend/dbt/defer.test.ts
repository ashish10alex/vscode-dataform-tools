import * as assert from 'assert';
import fs from 'fs';
import { suite, test } from 'mocha';
import { dbtDeferArguments, dbtDeferral } from './defer';
import { fullManifestPath } from './fixtures';
import { DbtManifest, buildDbtGraph } from './graph';

const P = 'alex-personal-dev-01';
const PROD = 'acme-prod';
const read = (): DbtManifest => JSON.parse(fs.readFileSync(fullManifestPath('dbt-core'), 'utf8'));

/** The example Project as prod has it: every table in another GCP project, but those of `same`, by dbt's ID */
function prodManifest(same: string[] = [], without: string[] = []): DbtManifest {
    const manifest = read();
    for (const [id, node] of Object.entries(manifest.nodes ?? {}) as Array<[string, { database?: string; relation_name?: string | null }]>) {
        if (without.includes(id)) {
            delete manifest.nodes![id];
        } else if (!same.includes(id)) {
            node.relation_name = node.relation_name?.replace(P, PROD);
            node.database = PROD;
        }
    }
    return manifest;
}

/** The compile on show, with the SQL of `model` reading `tables` from prod */
function devManifest(model: string, tables: string[]): DbtManifest {
    const manifest = read();
    const node = manifest.nodes![model] as { compiled_code?: string };
    for (const table of tables) {
        node.compiled_code = node.compiled_code!.split(`\`${P}\`.\`xf_example\`.\`${table}\``).join(`\`${PROD}\`.\`xf_example\`.\`${table}\``);
    }
    return manifest;
}

const FCT_ORDERS = 'model.xf_example.fct_orders';
const shown = [`${P}.xf_example.fct_orders`];
const target = (database: string, name: string) => ({ database, schema: 'xf_example', name });

suite('defer to prod in a dbt Project', () => {
    test('the arguments name the prod manifest as the state to defer to, and there are none without one', () => {
        assert.deepStrictEqual(dbtDeferArguments({ stateDir: '/store/prod/target' }), ['--defer', '--defer-state', '/store/prod/target']);
        assert.deepStrictEqual(dbtDeferArguments(undefined), []);
    });

    test('a table the compiled SQL reads from prod is deferred, and one it reads from the dbt target is built in dev', () => {
        const deferral = dbtDeferral(buildDbtGraph(devManifest(FCT_ORDERS, ['stg_orders'])), buildDbtGraph(prodManifest()), shown);
        assert.deepStrictEqual(deferral, {
            deferred: [{ dev: target(P, 'stg_orders'), prod: target(PROD, 'stg_orders') }],
            builtInDev: [target(P, 'stg_payments')],
        });
    });

    test('a table that prod has in the same place, or does not have, is not listed', () => {
        const dev = buildDbtGraph(devManifest(FCT_ORDERS, []));
        assert.deepStrictEqual(dbtDeferral(dev, buildDbtGraph(prodManifest(['model.xf_example.stg_orders'], ['model.xf_example.stg_payments'])), shown), { deferred: [], builtInDev: [] });
    });

    test('what an ephemeral model reads counts as read by the model it is inlined into', () => {
        // dim_customers reads the ephemeral int_customer_countries, which reads stg_customers and the seed
        const dev = buildDbtGraph(devManifest('model.xf_example.dim_customers', ['stg_customers']));
        const deferral = dbtDeferral(dev, buildDbtGraph(prodManifest()), [`${P}.xf_example.dim_customers`]);
        assert.deepStrictEqual(deferral.deferred.map((entry) => entry.dev.name), ['stg_customers']);
        assert.ok(!deferral.builtInDev.some((entry) => entry.name === 'int_customer_countries'));
    });

    test('an action whose SQL the compile left out lists nothing', () => {
        const manifest = devManifest(FCT_ORDERS, ['stg_orders']);
        delete (manifest.nodes![FCT_ORDERS] as { compiled_code?: string }).compiled_code;
        assert.deepStrictEqual(dbtDeferral(buildDbtGraph(manifest), buildDbtGraph(prodManifest()), shown), { deferred: [], builtInDev: [] });
    });
});
