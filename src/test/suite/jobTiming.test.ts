import * as assert from 'assert';
import { suite, test } from 'mocha';
import { formatDuration, needsJobStats, timestampToMs } from '../../shared/jobTiming';

suite('jobTiming', () => {
    test('formatDuration keeps one decimal under ten seconds', () => {
        assert.strictEqual(formatDuration(0), '0.0s');
        assert.strictEqual(formatDuration(1233), '1.2s');
        assert.strictEqual(formatDuration(9940), '9.9s');
    });

    test('formatDuration uses whole seconds, then minutes and hours', () => {
        assert.strictEqual(formatDuration(32557), '33s');
        assert.strictEqual(formatDuration(59600), '1m 00s');
        assert.strictEqual(formatDuration(64000), '1m 04s');
        assert.strictEqual(formatDuration(3_600_000), '1h 00m');
        assert.strictEqual(formatDuration(8_780_000), '2h 26m');
    });

    test('timestampToMs converts protobuf timestamps whatever type seconds arrives as', () => {
        assert.strictEqual(timestampToMs({ seconds: 1790456410, nanos: 550_000_000 }), 1790456410550);
        assert.strictEqual(timestampToMs({ seconds: '1790456410' }), 1790456410000);
        const long = { low: 0, high: 0, toString: () => '1790456410' };
        assert.strictEqual(timestampToMs({ seconds: long, nanos: 1_000_000 }), 1790456410001);
        assert.strictEqual(timestampToMs(undefined), undefined);
        assert.strictEqual(timestampToMs({ seconds: null }), undefined);
    });

    test('needsJobStats wants finished actions with a job and no stats', () => {
        assert.strictEqual(needsJobStats({ target: 't', state: 'SUCCEEDED', jobId: 'j' }), true);
        assert.strictEqual(needsJobStats({ target: 't', state: 'FAILED', jobId: 'j' }), true);
        assert.strictEqual(needsJobStats({ target: 't', state: 'RUNNING', jobId: 'j' }), false);
        assert.strictEqual(needsJobStats({ target: 't', state: 'SUCCEEDED' }), false);
    });

    test('needsJobStats reloads stats cached before timing was recorded, but not errors', () => {
        assert.strictEqual(needsJobStats({ target: 't', state: 'SUCCEEDED', jobId: 'j', jobStats: { totalBytesBilled: 1 } }), true);
        assert.strictEqual(needsJobStats({ target: 't', state: 'SUCCEEDED', jobId: 'j', jobStats: { totalBytesBilled: 1, endTime: 2 } }), false);
        assert.strictEqual(needsJobStats({ target: 't', state: 'SUCCEEDED', jobId: 'j', jobStats: { error: 'Not found' } }), false);
    });
});
