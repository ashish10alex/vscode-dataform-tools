import * as assert from 'assert';
import { suite, test } from 'mocha';
import { DRY_RUN_CONCURRENCY, withDryRunSlot } from '../../bigqueryDryRun';

suite('bigqueryDryRun.withDryRunSlot', () => {
    test('runs at most DRY_RUN_CONCURRENCY at once and finishes every one', async () => {
        let running = 0;
        let peak = 0;
        const results = await Promise.all(Array.from({ length: DRY_RUN_CONCURRENCY * 3 + 5 }, (_, i) => withDryRunSlot(async () => {
            running++;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running--;
            return i;
        })));
        assert.strictEqual(peak, DRY_RUN_CONCURRENCY);
        assert.deepStrictEqual(results, Array.from({ length: DRY_RUN_CONCURRENCY * 3 + 5 }, (_, i) => i));
    });

    test('a failed dry run frees its slot', async () => {
        await Promise.allSettled(Array.from({ length: DRY_RUN_CONCURRENCY }, () => withDryRunSlot(async () => { throw new Error('quota'); })));
        // Every slot is free again, so this does not wait behind the failures
        assert.strictEqual(await withDryRunSlot(async () => 'ok'), 'ok');
    });
});
