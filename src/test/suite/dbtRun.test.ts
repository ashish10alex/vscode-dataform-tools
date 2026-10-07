import * as assert from 'assert';
import { suite, test } from 'mocha';
import { needsConfirmation } from '../../project/dbtRun';

suite('dbt runs: when a run is confirmed first', () => {
    test("not for the profile's default dbt target, whoever chose it", () => {
        assert.strictEqual(needsConfirmation('dev', 'dev', false), false);
        assert.strictEqual(needsConfirmation('dev', 'dev', true), false);
    });

    test('for any other dbt target, also one dbt chose itself (through $DBT_TARGET)', () => {
        assert.strictEqual(needsConfirmation('prod', 'dev', true), true);
        assert.strictEqual(needsConfirmation('prod', 'dev', false), true);
    });

    test('with a profile that cannot be read: only for a dbt target that was chosen or set', () => {
        assert.strictEqual(needsConfirmation('prod', undefined, true), true);
        assert.strictEqual(needsConfirmation('prod', undefined, false), false);
    });

    test('not when no dbt target is known at all', () => {
        assert.strictEqual(needsConfirmation(undefined, 'dev', false), false);
    });
});
