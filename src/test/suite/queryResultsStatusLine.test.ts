import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobStatusLine, hasJobStatus } from '../../../webviews/query_results/components/JobStatusLine';

const JOB_ID = 'football-analytics-dev:europe-west2.job_Kq3vT8mXw2Lr9ZpB4nYc';

type Props = Parameters<typeof JobStatusLine>[0];
const render = (props: Partial<Props>): string =>
    renderToStaticMarkup(createElement(JobStatusLine, { running: false, elapsedSeconds: 0, ...props }));

suite('JobStatusLine', () => {
    test('a running query shows how long it has run and its job, and no stats', () => {
        const html = render({ running: true, elapsedSeconds: 11, jobId: JOB_ID });
        assert.ok(html.includes('Running… 11s'), html);
        assert.ok(html.includes('job_Kq3v…4nYc'), html);
        assert.ok(!html.includes('billed'), html);
        assert.ok(!html.includes('rows'), html);
    });

    test('a running query has no job to show until the job is created', () => {
        const html = render({ running: true, elapsedSeconds: 75 });
        assert.ok(html.includes('Running… 1m 15s'), html);
        assert.ok(!html.includes('Copy job id'), html);
    });

    test('a finished query shows its stats, then its job as a link', () => {
        const html = render({
            jobStats: { bigQueryJobId: JOB_ID, jobCostMeta: '269.00 MiB', durationMs: 2300, totalRows: 48213 },
            shownRows: 1000,
        });
        assert.ok(html.includes('first 1,000 of 48,213 rows'), html);
        assert.ok(html.includes('2.3s'), html);
        assert.ok(html.includes('269.00 MiB billed'), html);
        assert.ok(html.includes(`View job in BigQuery: ${JOB_ID}`), html);
        assert.ok(html.indexOf('billed') < html.indexOf('job_Kq3v…4nYc'), html);
    });

    test('a job that failed or was cancelled is shown by its id alone', () => {
        const html = render({ jobId: JOB_ID });
        assert.ok(html.includes('job_Kq3v…4nYc'), html);
        assert.ok(!html.includes('·'), html);
    });

    test('there is nothing to show before the first run', () => {
        assert.strictEqual(render({}), '');
        assert.strictEqual(hasJobStatus({ running: false, jobStats: null, jobId: '' }), false);
        assert.strictEqual(hasJobStatus({ running: true, jobStats: null, jobId: '' }), true);
    });
});
