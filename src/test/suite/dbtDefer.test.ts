import * as assert from 'assert';
import { suite, test } from 'mocha';
import { dbtBlock } from '../../panel/slices';
import { dbtDeferAvailability } from '../../project/dbtDefer';

suite('dbt defer to prod: when it can be applied', () => {
    test('not without a prod dbt target, and the reason names the setting', () => {
        const state = dbtDeferAvailability(true, undefined, 'dev');
        assert.deepStrictEqual([state.enabled, state.available], [true, false]);
        assert.match(state.reason ?? '', /dbtProdTarget/);
    });

    test('not when the dbt target in use is the prod one', () => {
        const state = dbtDeferAvailability(true, 'prod', 'prod');
        assert.strictEqual(state.available, false);
        assert.match(state.reason ?? '', /prod/);
    });

    test('with a prod dbt target that is another than the one in use, or while that one is not known', () => {
        assert.deepStrictEqual(dbtDeferAvailability(true, 'prod', 'dev'), { enabled: true, available: true });
        assert.deepStrictEqual(dbtDeferAvailability(true, 'prod', undefined), { enabled: true, available: true });
    });

    test('whether it is switched on does not change whether it can be applied', () => {
        assert.deepStrictEqual(dbtDeferAvailability(false, 'prod', 'dev'), { enabled: false, available: true });
        assert.strictEqual(dbtDeferAvailability(false, undefined, 'dev').available, false);
    });
});

suite('dbt defer to prod: what the panel is told', () => {
    test('the switch and what the compile read from prod, or null while no compile has deferred', () => {
        const deferToProd = { enabled: true, available: true };
        const deferral = { status: 'ready' as const, entries: [{ dev: 'p.dev.stg_orders', prod: 'p.prod.stg_orders', status: 'deferred' as const }], builtInDev: [{ dev: 'p.dev.stg_payments' }] };
        assert.deepStrictEqual(dbtBlock({ deferToProd, deferral }, 1).deferral, deferral);
        assert.deepStrictEqual(dbtBlock({ deferToProd }, 1).deferToProd, deferToProd);
        assert.strictEqual(dbtBlock({ deferToProd }, 1).deferral, null);
    });

    test('nothing of it where the host does not say whether it is on', () => {
        const block = dbtBlock({}, 1);
        assert.ok(!('deferToProd' in block) && !('deferral' in block));
    });
});
