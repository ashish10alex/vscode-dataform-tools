import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { RunDryRun, dryRunAction, dryRunActions } from '../../bigquery/dryRunService';
import { Action, titledSections } from '../../shared/compiledGraph';
import type { BigQueryDryRunResponse, DataformCompiledJson } from '../../types';

const ok = (bytes: number, rest: Partial<BigQueryDryRunResponse> = {}): BigQueryDryRunResponse => ({
    statistics: { totalBytesProcessed: bytes, cost: { currency: 'USD', value: bytes / 1024 ** 3 * 5 }, statementType: 'SELECT' },
    schema: { fields: [{ name: 'id', type: 'INT64' }] },
    location: 'EU',
    error: { hasError: false, message: '' },
    ...rest,
});
const failed = (message: string, line = 0, column = 0): BigQueryDryRunResponse => ({ error: { hasError: true, message, location: { line, column } } });

/** A BigQuery that records what it was sent and answers from `answer` */
function recorder(answer: (sql: string) => BigQueryDryRunResponse | Promise<BigQueryDryRunResponse>) {
    const sent: string[] = [];
    const run: RunDryRun = async (sql) => {
        sent.push(sql);
        return answer(sql);
    };
    return { sent, run };
}

function action(sections: Action['sections'], name = 'orders'): Action {
    const target = { database: 'p', schema: 'ds', name };
    return { id: `p.ds.${name}`, target, kind: 'table', fileName: `definitions/${name}.sqlx`, tags: [], sections, sqlPresent: true, dependencyTargets: [] };
}

const QUERY = { compiled: true, dryRun: ['query'] };

suite('dry run from sections', () => {
    test('one script gives one result with bytes, cost, schema and the compile it belongs to', async () => {
        const { sent, run } = recorder(() => ok(2 * 1024 ** 3));
        const results = await dryRunAction(action(titledSections('query', ['\nselect id from t\n'], QUERY)), 7, run);
        assert.deepStrictEqual(sent, ['select id from t']);
        assert.deepStrictEqual(results, [{
            action: 'p.ds.orders',
            script: 'query',
            incremental: false,
            sections: ['query'],
            compile: 7,
            sql: 'select id from t',
            bytes: 2 * 1024 ** 3,
            cost: { currency: 'USD', value: 10 },
            schema: { fields: [{ name: 'id', type: 'INT64' }] },
            location: 'EU',
            statementType: 'SELECT',
        }]);
    });

    test('a Dataform table: its query and its post-operations are each dry-run after its pre-operations', async () => {
        const compiled = {
            tables: [{
                type: 'incremental',
                target: { database: 'p', schema: 'ds', name: 'orders' },
                fileName: 'definitions/orders.sqlx',
                preOps: ['declare d date'],
                query: 'select 1 as id',
                postOps: ['grant select on t to x'],
                incrementalPreOps: ['declare d date default current_date()'],
                incrementalQuery: 'select 1 as id where day > d',
                dependencyTargets: [],
            }],
        } as unknown as DataformCompiledJson;
        const { sent, run } = recorder(() => ok(1));
        const results = await dryRunAction(buildDataformGraph(compiled).actions['p.ds.orders'], 1, run);
        assert.deepStrictEqual(sent, [
            'declare d date;\nselect 1 as id;',
            'declare d date;\ngrant select on t to x;',
            'declare d date default current_date();\nselect 1 as id where day > d;',
            'declare d date default current_date();\ngrant select on t to x;',
        ]);
        assert.deepStrictEqual(results.map((result) => [result.script, result.incremental, result.sections]), [
            ['query', false, ['pre_operations', 'query']],
            ['post_operations', false, ['pre_operations', 'post_operations']],
            ['query', true, ['incremental pre_operations', 'incremental query']],
            ['post_operations', true, ['incremental pre_operations', 'incremental post_operations']],
        ]);
    });

    test("an error is placed in its section's own SQL, not in the script", async () => {
        const table = action([
            ...titledSections('pre_operations', ['declare d date'], QUERY),
            ...titledSections('query', ['select id,\n  nope\nfrom t'], QUERY),
        ]);
        // The script is "declare d date;\nselect id,\n  nope\nfrom t;": line 3 of it is line 2 of the query
        const inQuery = await dryRunAction(table, 3, recorder(() => failed('Unrecognized name: nope at [3:3]', 3, 3)).run);
        assert.deepStrictEqual(inQuery[0].error, { message: 'Unrecognized name: nope at [3:3]', section: 'query', line: 2, column: 3 });
        assert.deepStrictEqual([inQuery[0].bytes, inQuery[0].schema, inQuery[0].compile], [undefined, undefined, 3]);

        const inPreOperations = await dryRunAction(table, 3, recorder(() => failed('Type not found: dat at [1:11]', 1, 11)).run);
        assert.deepStrictEqual(inPreOperations[0].error, { message: 'Type not found: dat at [1:11]', section: 'pre_operations', line: 1, column: 11 });
    });

    test('an error with no place, or a dry run that throws, is still a result', async () => {
        const table = action(titledSections('query', ['select 1'], QUERY));
        const noPlace = await dryRunAction(table, 1, recorder(() => failed('Access Denied: Table p:ds.t')).run);
        assert.deepStrictEqual(noPlace[0].error, { message: 'Access Denied: Table p:ds.t' });
        const thrown = await dryRunAction(table, 1, async () => { throw new Error('socket hang up'); });
        assert.deepStrictEqual(thrown[0].error, { message: 'socket hang up' });
    });

    test('bytes BigQuery could not estimate are flagged, not passed off as zero', async () => {
        const unknown = ok(0, { statistics: { totalBytesProcessed: 0, bytesEstimateUnknown: true } });
        const [result] = await dryRunAction(action(titledSections('query', ['select 1'], QUERY)), 1, recorder(() => unknown).run);
        assert.deepStrictEqual([result.bytes, result.bytesUnknown, result.cost], [0, true, undefined]);
    });

    test('an action with nothing marked for dry run does not reach BigQuery', async () => {
        const { sent, run } = recorder(() => ok(1));
        const seed = action([]);
        const hooksOnly = action(titledSections('pre-hook', ['{{ log("x") }}'], { compiled: false, dryRun: [] }));
        assert.deepStrictEqual([...(await dryRunAction(seed, 1, run)), ...(await dryRunAction(hooksOnly, 1, run))], []);
        assert.deepStrictEqual(sent, []);
    });

    test('several actions are dry-run at once, each reported as it arrives, with one failure leaving the rest', async () => {
        const model = action(titledSections('query', ['select 1 as id'], QUERY), 'orders');
        const test1 = action(titledSections('query', ['select * from orders where id is null'], QUERY), 'not_null_orders_id');
        const seed = action([], 'countries');
        let release!: () => void;
        const held = new Promise<void>((resolve) => { release = resolve; });
        const { sent, run } = recorder(async (sql) => {
            if (sql.startsWith('select 1')) {
                await held;
                return ok(10);
            }
            return failed('Not found: Table orders');
        });
        const arrived: string[] = [];
        const all = dryRunActions([model, test1, seed], 4, run, (results) => arrived.push(results[0].action));
        await new Promise((resolve) => setTimeout(resolve, 5));
        // Both were sent before either answered; the test's result is in while the model's is still out
        assert.strictEqual(sent.length, 2);
        assert.deepStrictEqual(arrived, ['p.ds.not_null_orders_id']);
        release();
        const results = await all;
        assert.deepStrictEqual(results.map((result) => [result.action, result.bytes, result.error?.message, result.compile]), [
            ['p.ds.orders', 10, undefined, 4],
            ['p.ds.not_null_orders_id', undefined, 'Not found: Table orders', 4],
        ]);
        assert.deepStrictEqual(arrived, ['p.ds.not_null_orders_id', 'p.ds.orders']);
    });

    test('nothing is cached: asking twice asks BigQuery twice', async () => {
        const { sent, run } = recorder(() => ok(1));
        const table = action(titledSections('query', ['select 1'], QUERY));
        await dryRunAction(table, 1, run);
        await dryRunAction(table, 1, run);
        assert.strictEqual(sent.length, 2);
    });
});
