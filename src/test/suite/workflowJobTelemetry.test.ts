import * as assert from 'assert';
import { suite, test } from 'mocha';
import { bigQueryJobConsoleUrl, parseBigQueryJobId, summariseJobStats, toJobStats, workflowActionTarget } from '../../workflowJobTelemetry';

suite('workflowJobTelemetry', () => {
    test('workflowActionTarget shows the table that ran, with compiler overrides applied', () => {
        const action = {
            target: { database: 'proj', schema: 'sales_dev', name: 'aa_orders' },
            canonicalTarget: { database: 'proj', schema: 'sales', name: 'orders' },
        };
        assert.strictEqual(workflowActionTarget(action), 'proj.sales_dev.aa_orders');
    });

    test('workflowActionTarget falls back to the canonical target', () => {
        assert.strictEqual(workflowActionTarget({ canonicalTarget: { database: 'proj', schema: 'sales', name: 'orders' } }), 'proj.sales.orders');
        assert.strictEqual(workflowActionTarget({}), '(unknown)');
    });

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

    test('toJobStats reads BigQuery statistics, which arrive as strings', () => {
        const stats = toJobStats({ totalBytesProcessed: '2147483648', query: { totalBytesBilled: '1073741824' } }, 'EU', 'USD');
        assert.strictEqual(stats.totalBytesBilled, 1073741824);
        assert.strictEqual(stats.totalBytesProcessed, 2147483648);
        assert.strictEqual(stats.bytesBilledLabel, '1.00 GiB');
        assert.strictEqual(stats.costLabel, '$0.0061');
        assert.strictEqual(stats.location, 'EU');
    });

    test('toJobStats leaves missing statistics undefined', () => {
        const stats = toJobStats({}, undefined, 'USD');
        assert.strictEqual(stats.totalBytesBilled, undefined);
        assert.strictEqual(stats.costLabel, undefined);
    });

    test('summariseJobStats totals loaded stats and skips errors', () => {
        const summary = summariseJobStats([
            { target: 'a', state: 'SUCCEEDED', jobStats: { totalBytesBilled: 1024 ** 3, totalBytesProcessed: 10 } },
            { target: 'b', state: 'SUCCEEDED', jobStats: { totalBytesBilled: 1024 ** 3, totalBytesProcessed: 5 } },
            { target: 'c', state: 'FAILED', jobStats: { error: 'Not found' } },
            { target: 'd', state: 'SKIPPED' },
        ], 'USD');
        assert.strictEqual(summary?.totalBytesBilled, 2 * 1024 ** 3);
        assert.strictEqual(summary?.totalBytesProcessed, 15);
        assert.strictEqual(summary?.costLabel, '$0.0122');
    });

    test('summariseJobStats is undefined when nothing has loaded', () => {
        assert.strictEqual(summariseJobStats([{ target: 'a', state: 'SUCCEEDED' }], 'USD'), undefined);
    });
});
