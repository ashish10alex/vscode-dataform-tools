import * as assert from 'assert';
import { suite, test } from 'mocha';
import { bigQueryJobUrl, fullJobId, jobStatsParts, shortJobId } from '../../shared/queryResultsView';

const JOB_ID = 'football-analytics-dev:europe-west2.job_Kq3vT8mXw2Lr9ZpB4nYc';

suite('queryResultsView', () => {
    test('bigQueryJobUrl points at the job in its project and location', () => {
        assert.strictEqual(
            bigQueryJobUrl(JOB_ID),
            'https://console.cloud.google.com/bigquery?project=football-analytics-dev&j=bq:europe-west2:job_Kq3vT8mXw2Lr9ZpB4nYc&page=queryresults'
        );
    });

    test('bigQueryJobUrl has nothing for an id without a project', () => {
        assert.strictEqual(bigQueryJobUrl('1bdc1eb6-8d8c-4ff7-944d-b0101208cd6e'), undefined);
        assert.strictEqual(bigQueryJobUrl(undefined), undefined);
    });

    test('fullJobId gives a running job the id that links to it', () => {
        assert.strictEqual(fullJobId({ id: 'job_Kq3vT8mXw2Lr9ZpB4nYc', metadata: { id: JOB_ID } }), JOB_ID);
        assert.strictEqual(
            fullJobId({ id: 'job_Kq3vT8mXw2Lr9ZpB4nYc', metadata: { jobReference: { projectId: 'football-analytics-dev', location: 'europe-west2', jobId: 'job_Kq3vT8mXw2Lr9ZpB4nYc' } } }),
            JOB_ID
        );
        assert.ok(bigQueryJobUrl(fullJobId({ id: 'x', metadata: { id: JOB_ID } })));
    });

    test('fullJobId falls back to the bare id', () => {
        assert.strictEqual(fullJobId({ id: 'job_short' }), 'job_short');
    });

    test('shortJobId drops project and location and cuts a long id in the middle', () => {
        assert.strictEqual(shortJobId(JOB_ID), 'job_Kq3v…4nYc');
        assert.strictEqual(shortJobId('1bdc1eb6-8d8c-4ff7-944d-b0101208cd6e'), '1bdc1eb6…cd6e');
        assert.strictEqual(shortJobId('my-project:US.job_short'), 'job_short');
    });

    test('jobStatsParts lists rows, duration, bytes billed and cache hit in that order', () => {
        const parts = jobStatsParts({ durationMs: 2300, jobCostMeta: '269.00 MiB', cacheHit: true, totalRows: 1000 }, 1000);
        assert.deepStrictEqual(parts, ['1,000 rows', '2.3s', '269.00 MiB billed', 'cache hit']);
    });

    test('jobStatsParts says when the limit cut the result', () => {
        assert.deepStrictEqual(jobStatsParts({ totalRows: 48213 }, 1000), ['first 1,000 of 48,213 rows']);
    });

    test('jobStatsParts counts one row and no rows', () => {
        assert.deepStrictEqual(jobStatsParts({}, 1), ['1 row']);
        assert.deepStrictEqual(jobStatsParts({}, 0), ['0 rows']);
    });

    test('jobStatsParts leaves out what the job has no value for', () => {
        assert.deepStrictEqual(jobStatsParts({ cacheHit: false, jobCostMeta: undefined }), []);
        assert.deepStrictEqual(jobStatsParts(null), []);
        assert.deepStrictEqual(jobStatsParts(undefined, 12), ['12 rows']);
    });

    test('jobStatsParts ends with the time the job ended, given as a Date or as the string it becomes in the webview', () => {
        const endTime = new Date(2026, 9, 12, 10, 42, 15);
        const expected = endTime.toLocaleTimeString();
        assert.deepStrictEqual(jobStatsParts({ jobCostMeta: '0 B', bigQueryJobEndTime: endTime }), ['0 B billed', expected]);
        assert.deepStrictEqual(jobStatsParts({ bigQueryJobEndTime: endTime.toISOString() }), [expected]);
        assert.deepStrictEqual(jobStatsParts({ bigQueryJobEndTime: 'not a date' }), []);
    });
});
