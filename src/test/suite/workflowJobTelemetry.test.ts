import * as assert from 'assert';
import { suite, test } from 'mocha';
import { bigQueryJobConsoleUrl, formatSlotTime, parseBigQueryJobId, summariseJobStats, toJobStats } from '../../workflowJobTelemetry';

suite('workflowJobTelemetry', () => {
    test('parseBigQueryJobId keeps a bare job ID in the default project', () => {
        assert.deepStrictEqual(parseBigQueryJobId('dataform_abc123', 'my-project'), { projectId: 'my-project', jobId: 'dataform_abc123' });
    });

    test('parseBigQueryJobId splits a fully qualified job ID', () => {
        assert.deepStrictEqual(parseBigQueryJobId('other-project:europe-west2.dataform_abc123', 'my-project'), {
            projectId: 'other-project', location: 'europe-west2', jobId: 'dataform_abc123',
        });
    });

    test('bigQueryJobConsoleUrl links to the job query results', () => {
        assert.strictEqual(
            bigQueryJobConsoleUrl({ projectId: 'p', location: 'EU', jobId: 'j1' }),
            'https://console.cloud.google.com/bigquery?project=p&j=bq:EU:j1&page=queryresults'
        );
    });

    test('formatSlotTime picks a readable unit', () => {
        assert.strictEqual(formatSlotTime(250), '250 ms');
        assert.strictEqual(formatSlotTime(12_300), '12.3 s');
        assert.strictEqual(formatSlotTime(90_000), '1.5 min');
        assert.strictEqual(formatSlotTime(5_400_000), '1.5 h');
    });

    test('toJobStats reads BigQuery statistics, which arrive as strings', () => {
        const stats = toJobStats({ totalBytesProcessed: '2147483648', totalSlotMs: '1500', query: { totalBytesBilled: '1073741824' } }, 'EU', 'USD');
        assert.strictEqual(stats.totalBytesBilled, 1073741824);
        assert.strictEqual(stats.totalBytesProcessed, 2147483648);
        assert.strictEqual(stats.slotMs, 1500);
        assert.strictEqual(stats.bytesBilledLabel, '1.00 GiB');
        assert.strictEqual(stats.slotTimeLabel, '1.5 s');
        assert.strictEqual(stats.costLabel, '$0.0050');
        assert.strictEqual(stats.location, 'EU');
    });

    test('toJobStats leaves missing statistics undefined', () => {
        const stats = toJobStats({}, undefined, 'USD');
        assert.strictEqual(stats.totalBytesBilled, undefined);
        assert.strictEqual(stats.costLabel, undefined);
    });

    test('summariseJobStats totals loaded stats and skips errors', () => {
        const summary = summariseJobStats([
            { target: 'a', state: 'SUCCEEDED', jobStats: { totalBytesBilled: 1024 ** 3, slotMs: 1000, totalBytesProcessed: 10 } },
            { target: 'b', state: 'SUCCEEDED', jobStats: { totalBytesBilled: 1024 ** 3, slotMs: 500, totalBytesProcessed: 5 } },
            { target: 'c', state: 'FAILED', jobStats: { error: 'Not found' } },
            { target: 'd', state: 'SKIPPED' },
        ], 'USD');
        assert.strictEqual(summary?.totalBytesBilled, 2 * 1024 ** 3);
        assert.strictEqual(summary?.slotMs, 1500);
        assert.strictEqual(summary?.totalBytesProcessed, 15);
        assert.strictEqual(summary?.costLabel, '$0.0100');
    });

    test('summariseJobStats is undefined when nothing has loaded', () => {
        assert.strictEqual(summariseJobStats([{ target: 'a', state: 'SUCCEEDED' }], 'USD'), undefined);
    });
});
