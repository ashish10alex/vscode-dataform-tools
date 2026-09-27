import * as assert from 'assert';
import { suite, test } from 'mocha';
import { bigQueryJobConsoleUrl, parseBigQueryJobId, summariseJobStats, toJobStats, workflowActionsCsvRows, workflowActionTarget } from '../../workflowJobTelemetry';

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

    test('toJobStats reads job timing and slot time', () => {
        const stats = toJobStats({ startTime: '1790456410606', endTime: '1790456443163', totalSlotMs: '1233' }, 'EU', 'USD');
        assert.strictEqual(stats.startTime, 1790456410606);
        assert.strictEqual(stats.endTime, 1790456443163);
        assert.strictEqual(stats.durationMs, 32557);
        assert.strictEqual(stats.totalSlotMs, 1233);
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

    test('summariseJobStats sums slot time but not durations, which overlap', () => {
        const summary = summariseJobStats([
            { target: 'a', state: 'SUCCEEDED', jobStats: { totalSlotMs: 1000, durationMs: 5000 } },
            { target: 'b', state: 'SUCCEEDED', jobStats: { totalSlotMs: 250, durationMs: 4000 } },
        ], 'USD');
        assert.strictEqual(summary?.totalSlotMs, 1250);
        assert.strictEqual(summary?.durationMs, undefined);
    });

    test('workflowActionsCsvRows exports raw values, blank where nothing loaded', () => {
        const rows = workflowActionsCsvRows([
            {
                target: 'p.d.t1', state: 'SUCCEEDED', jobId: 'j1',
                jobStats: { durationMs: 32557, totalSlotMs: 1233, totalBytesBilled: 1024, cost: 0.5, startTime: Date.UTC(2026, 8, 26, 21, 0, 10), endTime: Date.UTC(2026, 8, 26, 21, 0, 43) },
            },
            { target: 'p.d.t2', state: 'FAILED', failureReason: 'Boom, "bad"' },
        ], 'EUR');
        assert.deepStrictEqual(rows[0], {
            target: 'p.d.t1', state: 'SUCCEEDED', duration_seconds: 32.557, slot_seconds: 1.233, bytes_billed: 1024, est_cost_eur: 0.5,
            job_start_time: '2026-09-26T21:00:10.000Z', job_end_time: '2026-09-26T21:00:43.000Z', failure_reason: undefined, job_id: 'j1',
        });
        assert.deepStrictEqual(Object.keys(rows[1]), Object.keys(rows[0]));
        assert.strictEqual(rows[1].failure_reason, 'Boom, "bad"');
        assert.strictEqual(rows[1].duration_seconds, undefined);
    });

    test('summariseJobStats is undefined when nothing has loaded', () => {
        assert.strictEqual(summariseJobStats([{ target: 'a', state: 'SUCCEEDED' }], 'USD'), undefined);
    });
});
