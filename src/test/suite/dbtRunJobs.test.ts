import * as assert from 'assert';
import * as path from 'path';
import { suite, test } from 'mocha';
import { BigQueryJobMetadata, countJobRows, finalRunState, isTerminalRun, jobTargetMatcher, runJobRows } from '../../shared/cliRunJobs';
import { dbtJobNamer, dbtRunFiles, invocationsStarted, nodeNamer, nodeOfQuery, ofInvocation, readRunResults, withNodeResults } from '../../shared/dbtRunJobs';
import type { WorkflowActionJobStats } from '../../types';

// As recorded from a build of one model with dbt-core 1.12.5 and with dbt v2 2.0.6
const CORE_ID = '2636e9ed-c106-4df2-81e5-ebb35a39b699';
const V2_ID = '01a13092-584b-7753-b7d7-49886f48dd24';
const CORE_LOG = [
    "\u001b[0m15:51:48.978535 [debug] [MainThread]: Sending event: {'category': 'dbt', 'action': 'invocation', 'label': 'start'}",
    '',
    '',
    `============================== 15:51:48.981236 | ${CORE_ID} ==============================`,
    '\u001b[0m15:51:48.981236 [info ] [MainThread]: Running with dbt=1.12.5',
].join('\n');
const V2_LOG = [
    '14:39:20.000000 [info ]: ',
    '==================== Execution Summary =====================',
    "Finished 'build' successfully for target 'dev' [16.7s]",
    `==================== 2026-10-12T14:44:19.684293Z | ${V2_ID} ====================`,
    '14:44:19.700000 [info ]: dbt 2.0.6',
].join('\n');
const CORE_QUERY = '/* {"app": "dbt", "dbt_version": "1.12.5", "profile_name": "shop", "target_name": "dev", "node_id": "model.shop.orders"} */\n\n  create or replace table `proj`.`analytics`.`orders` as (select 1)';
const V2_QUERY = '/* {"app": "dbt", "dbt_version": "2.0.0", "node_id": "model.shop.orders", "profile_name": "shop", "target_name": "dev"} */\n\n  create or replace table `proj`.`analytics`.`orders` as (select 1)';

function job(id: string, fields: { query?: string; invocation?: string; state?: string; start?: number; error?: string } = {}): BigQueryJobMetadata {
    return {
        jobReference: { projectId: 'proj', jobId: id, location: 'EU' },
        status: { state: fields.state ?? 'DONE', ...(fields.error ? { errorResult: { reason: 'invalidQuery', message: fields.error } } : {}) },
        statistics: { creationTime: String(fields.start ?? 1000), startTime: String(fields.start ?? 1000) },
        configuration: { query: { query: fields.query ?? 'select 1' }, ...(fields.invocation ? { labels: { dbt_invocation_id: fields.invocation } } : {}) },
    };
}

const noStats = (): WorkflowActionJobStats => ({});
const nameOfNode = nodeNamer([
    { package: 'shop', name: 'orders', target: 'proj.analytics.orders' },
    { package: 'shop', name: 'customers', version: '2', target: 'proj.analytics.customers_v2' },
    { package: 'shop', name: 'not_null_orders_id', target: 'test.not_null_orders_id' },
]);

function results(nodes: Array<Record<string, unknown>>, invocation = CORE_ID): string {
    return JSON.stringify({ metadata: { invocation_id: invocation, generated_at: '2026-10-12T14:44:34.831123Z' }, results: nodes });
}

suite('dbtRunJobs', () => {
    test("the invocation's ID is read from the start of a run in the log of either engine", () => {
        assert.deepStrictEqual(invocationsStarted(CORE_LOG), [CORE_ID]);
        // The line that closes the run before is no start
        assert.deepStrictEqual(invocationsStarted(V2_LOG), [V2_ID]);
        assert.deepStrictEqual(invocationsStarted(`${V2_LOG}\n${CORE_LOG.replace(/\n/g, '\r\n')}`), [V2_ID, CORE_ID]);
        assert.deepStrictEqual(invocationsStarted('14:44:19 [info ]: nothing started'), []);
    });

    test("dbt's files are where its environment says, else in the Project", () => {
        const root = path.resolve('/work/shop');
        assert.deepStrictEqual(dbtRunFiles(root, {}, path.resolve), { log: path.join(root, 'logs', 'dbt.log'), results: path.join(root, 'target', 'run_results.json') });
        assert.deepStrictEqual(
            dbtRunFiles(root, { DBT_LOG_PATH: 'out/logs', DBT_TARGET_PATH: path.resolve('/tmp/target') }, path.resolve),
            { log: path.join(root, 'out', 'logs', 'dbt.log'), results: path.join(path.resolve('/tmp/target'), 'run_results.json') },
        );
    });

    test('a job is of the invocation that labelled it', () => {
        const ofRun = ofInvocation(CORE_ID);
        assert.strictEqual(ofRun(job('a', { invocation: CORE_ID })), true);
        assert.strictEqual(ofRun(job('b', { invocation: V2_ID })), false);
        assert.strictEqual(ofRun(job('c')), false);
    });

    test("the node of a query is the one dbt's comment names, in either engine's order of keys", () => {
        assert.strictEqual(nodeOfQuery(CORE_QUERY), 'model.shop.orders');
        assert.strictEqual(nodeOfQuery(V2_QUERY), 'model.shop.orders');
        assert.strictEqual(nodeOfQuery('create table `p.d.t` as select 1'), undefined);
        assert.strictEqual(nodeOfQuery('/* a comment of the Project */ select 1'), undefined);
        assert.strictEqual(nodeOfQuery('/* {"app": "dbt"} */ select 1'), undefined);
        assert.strictEqual(nodeOfQuery(undefined), undefined);
    });

    test('a node is named after its action, a versioned model and a generic test too, else by its own name', () => {
        assert.strictEqual(nameOfNode('model.shop.orders'), 'proj.analytics.orders');
        assert.strictEqual(nameOfNode('model.shop.customers.v2'), 'proj.analytics.customers_v2');
        assert.strictEqual(nameOfNode('test.shop.not_null_orders_id.1a2b3c4d5e'), 'test.not_null_orders_id');
        assert.strictEqual(nameOfNode('operation.shop.shop-on-run-start-0'), 'shop-on-run-start-0');
        assert.strictEqual(nameOfNode('model.other.orders'), 'orders');
        assert.strictEqual(nameOfNode('odd'), 'odd');
    });

    test('the rows of a run are the jobs of its invocation, named after their nodes', () => {
        const byTable = jobTargetMatcher([{ target: { database: 'proj', schema: 'analytics', name: 'seeded' } }]);
        const rows = runJobRows([
            job('adbc-2', { invocation: V2_ID, query: V2_QUERY, start: 2000, state: 'RUNNING' }),
            job('other-run', { invocation: CORE_ID, query: CORE_QUERY }),
            job('adbc-1', { invocation: V2_ID, query: 'insert into `proj.analytics.seeded` values (1)', start: 1000 }),
            job('adbc-0000abcdefgh', { invocation: V2_ID, query: 'select 1', start: 3000 }),
            job('mine'),
        ], ofInvocation(V2_ID), dbtJobNamer(nameOfNode, byTable), noStats);
        assert.deepStrictEqual(rows.map((row) => [row.target, row.state, row.jobId]), [
            // Without dbt's comment, after the table it writes to
            ['proj.analytics.seeded', 'SUCCEEDED', 'proj:EU.adbc-1'],
            ['proj.analytics.orders', 'RUNNING', 'proj:EU.adbc-2'],
            // And with neither, by the end of its ID
            ['job …abcdefgh', 'SUCCEEDED', 'proj:EU.adbc-0000abcdefgh'],
        ]);
    });

    test('run_results.json tells how each node ended, and by which job', () => {
        const read = readRunResults(results([
            { unique_id: 'model.shop.orders', status: 'success', message: 'CREATE TABLE (509.0 rows)', adapter_response: { job_id: '4c002892', project_id: 'proj', location: 'EU' } },
            { unique_id: 'test.shop.not_null_orders_id.1a2b3c4d5e', status: 'fail', message: 'Got 3 results, configured to fail if != 0', adapter_response: {} },
            { status: 'success' },
        ]));
        assert.strictEqual(read?.invocationId, CORE_ID);
        assert.strictEqual(read?.generatedAt, Date.parse('2026-10-12T14:44:34.831123Z'));
        assert.deepStrictEqual(read?.nodes, [
            { nodeId: 'model.shop.orders', status: 'success', message: 'CREATE TABLE (509.0 rows)', jobId: '4c002892', projectId: 'proj' },
            { nodeId: 'test.shop.not_null_orders_id.1a2b3c4d5e', status: 'fail', message: 'Got 3 results, configured to fail if != 0', jobId: undefined, projectId: undefined },
        ]);
        assert.strictEqual(readRunResults('{"metadata": {}}'), undefined);
        assert.strictEqual(readRunResults('not json'), undefined);
    });

    test('a test that fails has its row failed, though its job succeeded, and a node without a job is given a row', () => {
        const rows = [
            { target: 'proj.analytics.orders', state: 'SUCCEEDED', jobId: 'proj:EU.job-orders' },
            { target: 'test.not_null_orders_id', state: 'SUCCEEDED', jobId: 'proj:EU.job-test' },
        ];
        const read = readRunResults(results([
            { unique_id: 'model.shop.orders', status: 'success', adapter_response: { job_id: 'job-orders' } },
            { unique_id: 'test.shop.not_null_orders_id.1a2b3c4d5e', status: 'fail', message: 'Got 3 results, configured to fail if != 0' },
            { unique_id: 'model.shop.customers.v2', status: 'skipped', message: 'Skipping due to fail_fast' },
            { unique_id: 'model.other.broken', status: 'error', message: 'Compilation Error' },
        ]))!;
        const ended = withNodeResults(rows, read, nameOfNode);
        assert.deepStrictEqual(ended, [
            { target: 'proj.analytics.orders', state: 'SUCCEEDED', jobId: 'proj:EU.job-orders' },
            { target: 'test.not_null_orders_id', state: 'FAILED', jobId: 'proj:EU.job-test', failureReason: 'Got 3 results, configured to fail if != 0' },
            { target: 'proj.analytics.customers_v2', state: 'SKIPPED' },
            { target: 'broken', state: 'FAILED', failureReason: 'Compilation Error' },
        ]);
        // The rows it was given are left as they were, and saying it again changes nothing
        assert.strictEqual(rows[1].state, 'SUCCEEDED');
        assert.deepStrictEqual(withNodeResults(ended, read, nameOfNode), ended);
        assert.strictEqual(finalRunState(ended, {}), 'FAILED');
        assert.deepStrictEqual(countJobRows(ended), { total: 4, pending: 0, running: 0, succeeded: 1, failed: 2, cancelled: 0, skipped: 1 });
    });

    test('a job that failed keeps the reason BigQuery gave', () => {
        const rows = runJobRows([job('a', { invocation: CORE_ID, query: CORE_QUERY, error: 'Syntax error at [3:1]' })], ofInvocation(CORE_ID), dbtJobNamer(nameOfNode, () => undefined), noStats);
        const read = readRunResults(results([{ unique_id: 'model.shop.orders', status: 'error', message: 'Database Error in model orders' }]))!;
        assert.deepStrictEqual(withNodeResults(rows, read, nameOfNode).map((row) => [row.state, row.failureReason]), [['FAILED', 'Syntax error at [3:1]']]);
    });

    test('a run sent to a terminal is one of the Dataform CLI or of dbt', () => {
        assert.deepStrictEqual(['cli', 'dbt', 'api', 'api_workspace', undefined].map((executionMode) => isTerminalRun({ executionMode })), [true, true, false, false, false]);
    });
});
