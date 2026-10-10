import * as assert from 'assert';
import { suite, test } from 'mocha';
import {
    BigQueryJobMetadata, NO_JOBS_MS, QUIET_MS, cliJobProject, countJobRows, failedJobRows, finalRunState, helpListsJobPrefix,
    jobIdPrefix, jobPrefixFlag, jobTargetMatcher, newRunId, quietVerdict, runJobRows, runProgress, withJobPrefix, withRunAdded,
} from '../../shared/cliRunJobs';
import type { WorkflowActionJobStats } from '../../types';

const PREFIX = 'dataform-vscode-ab12cd34-';

function job(id: string, fields: Partial<BigQueryJobMetadata> & { query?: string; state?: string; start?: number } = {}): BigQueryJobMetadata {
    const { query, state, start, ...rest } = fields;
    return {
        jobReference: { projectId: 'proj', jobId: id, location: 'EU' },
        status: { state: state ?? 'DONE' },
        statistics: { creationTime: String(start ?? 1000), startTime: String(start ?? 1000) },
        configuration: { query: { query: query ?? 'select 1' } },
        ...rest,
    };
}

const noStats = (): WorkflowActionJobStats => ({});
const noName = () => undefined;

suite('cliRunJobs', () => {
    test('a run ID has only characters a BigQuery job ID may have', () => {
        assert.match(newRunId(), /^[a-z0-9]{8}$/);
        assert.strictEqual(newRunId(() => 0), '00000000');
    });

    test('the command is given the prefix the CLI starts the job IDs with', () => {
        const flag = jobPrefixFlag('ab12cd34');
        assert.strictEqual(withJobPrefix('dataform run "/p" --tags=daily', flag), 'dataform run "/p" --tags=daily --job-prefix=vscode-ab12cd34');
        assert.strictEqual(jobIdPrefix(flag), PREFIX);
    });

    test('the help of a CLI tells whether it can prefix job IDs', () => {
        assert.strictEqual(helpListsJobPrefix('  --job-prefix   Adds an additional prefix in the form of `dataform-${jobPrefix}-`.'), true);
        assert.strictEqual(helpListsJobPrefix('  --tags   A list of tags'), false);
    });

    test("the jobs are looked for in the project of the CLI's credentials first, the Project's own last", () => {
        const all = { credentialsProject: 'creds', envProject: 'env', quotaProject: 'quota', defaultProject: 'default' };
        assert.strictEqual(cliJobProject(all), 'creds');
        assert.strictEqual(cliJobProject({ ...all, credentialsProject: '' }), 'env');
        assert.strictEqual(cliJobProject({ quotaProject: ' quota ', defaultProject: 'default' }), 'quota');
        assert.strictEqual(cliJobProject({ defaultProject: 'default' }), 'default');
        assert.strictEqual(cliJobProject({}), undefined);
    });

    test('a job is named after the action whose table it writes to', () => {
        const nameOf = jobTargetMatcher([
            { target: { database: 'proj', schema: 'analytics', name: 'orders' } },
            { target: { database: 'proj', schema: 'assertions', name: 'orders_not_null' } },
        ]);
        // As BigQuery says
        assert.strictEqual(nameOf(job('a', { statistics: { query: { ddlTargetTable: { projectId: 'proj', datasetId: 'analytics', tableId: 'orders' } } } })), 'proj.analytics.orders');
        assert.strictEqual(nameOf(job('b', { configuration: { query: { query: 'x', destinationTable: { projectId: 'proj', datasetId: 'analytics', tableId: 'orders' } } } })), 'proj.analytics.orders');
        // As its query opens
        assert.strictEqual(nameOf(job('c', { query: '-- by dataform\n/* a\ncomment */ create or replace table `proj.analytics.orders` as select 1' })), 'proj.analytics.orders');
        assert.strictEqual(nameOf(job('d', { query: 'INSERT INTO `analytics.orders` select 1' })), 'proj.analytics.orders');
        assert.strictEqual(nameOf(job('e', { query: 'select sum(1) as row_count from `proj.assertions.orders_not_null`' })), 'proj.assertions.orders_not_null');
    });

    test('a job that writes to no action is named after its table, or not at all', () => {
        const nameOf = jobTargetMatcher([{ target: { database: 'proj', schema: 'analytics', name: 'orders' } }]);
        assert.strictEqual(nameOf(job('a', { query: 'create table `proj.scratch.other` as select 1' })), 'proj.scratch.other');
        assert.strictEqual(nameOf(job('b', { query: 'select * from `proj.analytics.orders`' })), undefined);
        // The table of a query that names none
        const anonymous = { projectId: 'proj', datasetId: '_abc123', tableId: 'anon1' };
        assert.strictEqual(nameOf(job('c', { configuration: { query: { query: 'select 1', destinationTable: anonymous } } })), undefined);
    });

    test('a job that writes to nothing is named after the operation that runs its query', () => {
        const nameOf = jobTargetMatcher([
            { target: { database: 'proj', schema: 'ops', name: 'refresh' }, queries: ['call proj.ops.refresh()', 'select 1'] },
            { target: { database: 'proj', schema: 'ops', name: 'other' }, queries: ['select 1'] },
        ]);
        assert.strictEqual(nameOf(job('a', { query: '\ncall proj.ops.refresh()\n' })), 'proj.ops.refresh');
        // Two operations run it, so it tells of neither
        assert.strictEqual(nameOf(job('b', { query: 'select 1' })), undefined);
    });

    test('only the jobs with the prefix are rows, oldest first, each in the state its job is in', () => {
        const rows = runJobRows([
            job(`${PREFIX}late`, { state: 'RUNNING', start: 3000 }),
            job('dataform-vscode-zzzzzzzz-other', { start: 1 }),
            job('bquxjob_1', { start: 2 }),
            job(`${PREFIX}failed`, { start: 2000, status: { state: 'DONE', errorResult: { reason: 'invalidQuery', message: 'Syntax error' } } }),
            job(`${PREFIX}stopped`, { start: 2500, status: { state: 'DONE', errorResult: { reason: 'stopped', message: 'Job execution was cancelled' } } }),
            job(`${PREFIX}first`, { start: 1000 }),
            job(`${PREFIX}queued`, { state: 'PENDING', start: 4000 }),
        ], PREFIX, noName, noStats);

        assert.deepStrictEqual(rows.map((row) => [row.target, row.state]), [
            ['job …first', 'SUCCEEDED'],
            ['job …failed', 'FAILED'],
            ['job …stopped', 'CANCELLED'],
            ['job …late', 'RUNNING'],
            ['job …queued', 'PENDING'],
        ]);
        assert.strictEqual(rows[0].jobId, `proj:EU.${PREFIX}first`);
        assert.strictEqual(rows[0].startTime, 1000);
        assert.strictEqual(rows[1].failureReason, 'Syntax error');
        assert.deepStrictEqual(countJobRows(rows), { total: 5, pending: 1, running: 1, succeeded: 1, failed: 1, cancelled: 1, skipped: 0 });
        assert.deepStrictEqual(failedJobRows(rows), [{ target: 'job …failed', failureReason: 'Syntax error' }]);
    });

    test('only a job that has ended has stats', () => {
        const seen: unknown[] = [];
        const rows = runJobRows([job(`${PREFIX}a`), job(`${PREFIX}b`, { state: 'RUNNING' })], PREFIX, noName, (_statistics, location) => {
            seen.push(location);
            return { totalBytesBilled: 10 };
        });
        assert.deepStrictEqual(rows.map((row) => row.jobStats), [{ totalBytesBilled: 10 }, undefined]);
        assert.deepStrictEqual(seen, ['EU']);
    });

    test("the CLI's exit code tells how a run ended, and its jobs when there is none", () => {
        const succeeded = { target: 't', state: 'SUCCEEDED' };
        const failed = { target: 't', state: 'FAILED' };
        const cancelled = { target: 't', state: 'CANCELLED' };
        assert.strictEqual(finalRunState([failed], { exitCode: 0 }), 'SUCCEEDED');
        assert.strictEqual(finalRunState([succeeded], { exitCode: 1 }), 'FAILED');
        assert.strictEqual(finalRunState([succeeded, failed], {}), 'FAILED');
        assert.strictEqual(finalRunState([succeeded, cancelled], {}), 'CANCELLED');
        assert.strictEqual(finalRunState([succeeded], {}), 'SUCCEEDED');
        assert.strictEqual(finalRunState([], {}), 'SUCCEEDED');
        // A run the user cancelled
        assert.strictEqual(finalRunState([failed], { exitCode: 1, cancelling: true }), 'CANCELLED');
        assert.strictEqual(finalRunState([succeeded], { exitCode: 0, cancelling: true }), 'SUCCEEDED');
    });

    test('a run the terminal tells nothing of has ended once its jobs have been quiet for a while', () => {
        const startedAt = 1_000_000;
        assert.strictEqual(quietVerdict({ now: startedAt + QUIET_MS - 1, startedAt, sawJobs: true, lastActiveAt: startedAt }), undefined);
        assert.strictEqual(quietVerdict({ now: startedAt + QUIET_MS, startedAt, sawJobs: true, lastActiveAt: startedAt }), 'ended');
        // A job running long after the run started keeps it going
        assert.strictEqual(quietVerdict({ now: startedAt + 10 * QUIET_MS, startedAt, sawJobs: true, lastActiveAt: startedAt + 10 * QUIET_MS - 5 }), undefined);
        // No job yet: the CLI may still be compiling
        assert.strictEqual(quietVerdict({ now: startedAt + QUIET_MS, startedAt, sawJobs: false }), undefined);
        assert.strictEqual(quietVerdict({ now: startedAt + NO_JOBS_MS, startedAt, sawJobs: false }), 'no jobs');
    });

    test("a run's progress is its kept counts, else its rows, with a cancelled one among the failed", () => {
        const rows = [{ target: 'a', state: 'RUNNING' }, { target: 'b', state: 'SUCCEEDED' }, { target: 'c', state: 'CANCELLED' }, { target: 'd', state: 'PENDING' }];
        assert.deepStrictEqual(runProgress({ actions: rows }), { total: 4, running: 1, succeeded: 1, failed: 1, pending: 1 });
        // A run kept before its counts had every field
        assert.deepStrictEqual(runProgress({ actions: rows, actionCounts: { total: 9, succeeded: 4, failed: 2 } }), { total: 9, running: 0, succeeded: 4, failed: 2, pending: 0 });
        assert.deepStrictEqual(runProgress({}), { total: 0, running: 0, succeeded: 0, failed: 0, pending: 0 });
    });

    test('the history keeps the newest runs', () => {
        assert.deepStrictEqual(withRunAdded([1, 2, 3], 4, 3), [2, 3, 4]);
        assert.deepStrictEqual(withRunAdded([1], 2, 3), [1, 2]);
    });
});
