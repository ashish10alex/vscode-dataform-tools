import * as assert from 'assert';
import { suite, test, setup } from 'mocha';
import { getPerfSnapshot, MAX_PERF_SPANS, perfCount, perfStart, perfTimed, resetPerf } from '../../perf';

suite('perf', () => {
    setup(() => resetPerf());

    test('records a span once, merging start and end attributes', () => {
        const end = perfStart('compile', { override: false });
        end({ failed: true });
        end();
        const { spans } = getPerfSnapshot();
        assert.strictEqual(spans.length, 1);
        assert.strictEqual(spans[0].name, 'compile');
        assert.deepStrictEqual(spans[0].attrs, { override: false, failed: true });
        assert.ok(spans[0].ms >= 0);
    });

    test('perfTimed records the span when the work rejects', async () => {
        await assert.rejects(perfTimed('dryRuns', async () => { throw new Error('boom'); }));
        assert.deepStrictEqual(getPerfSnapshot().spans.map((span) => span.name), ['dryRuns']);
    });

    test('accumulates counters', () => {
        perfCount('git.spawn');
        perfCount('git.spawn', 2);
        perfCount('bq.dryRun');
        assert.deepStrictEqual(getPerfSnapshot().counters, { 'git.spawn': 3, 'bq.dryRun': 1 });
    });

    test('keeps only the most recent spans', () => {
        for (let i = 0; i < MAX_PERF_SPANS + 10; i++) {
            perfStart(`span-${i}`)();
        }
        const { spans } = getPerfSnapshot();
        assert.strictEqual(spans.length, MAX_PERF_SPANS);
        assert.strictEqual(spans[0].name, 'span-10');
    });

    test('a snapshot is not changed by later records', () => {
        perfCount('cli.compile');
        const snapshot = getPerfSnapshot();
        perfCount('cli.compile');
        perfStart('render')();
        assert.strictEqual(snapshot.counters['cli.compile'], 1);
        assert.strictEqual(snapshot.spans.length, 0);
    });
});
