import * as assert from 'assert';
import { suite, test } from 'mocha';
import { parseInvocation } from '../../workflowWatch/parseInvocation';
import { isExternalRun, ownRuns, withRunUpserted } from '../../shared/cliRunJobs';

const ID = '1700000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

suite('parseInvocation: what is pasted to watch a workflow', () => {
    test('reads an ID, a console URL and a resource name', () => {
        assert.deepStrictEqual(parseInvocation(ID), { projectId: undefined, location: undefined, repositoryName: undefined, workflowInvocationId: ID });
        assert.strictEqual(parseInvocation(`  ${ID}\n`).workflowInvocationId, ID);
        assert.deepStrictEqual(
            parseInvocation(`https://console.cloud.google.com/bigquery/dataform/locations/europe-west2/repositories/shop/workflows/${ID}?project=my-project`),
            { projectId: 'my-project', location: 'europe-west2', repositoryName: 'shop', workflowInvocationId: ID },
        );
        assert.deepStrictEqual(
            parseInvocation('projects/p/locations/europe-west2/repositories/shop/workflowInvocations/42'),
            { projectId: 'p', location: 'europe-west2', repositoryName: 'shop', workflowInvocationId: '42' },
        );
    });

    test('refuses anything else, saying why', () => {
        const cases: [string, string][] = [
            ['', 'Paste a workflow ID'],
            ['https://console.cloud.google.com/bigquery?project=p', 'names no workflow'],
            ['bad id', 'not a workflow ID'],
            ['../x', 'names no workflow'],
            ['https://evil.example/bigquery/dataform/locations/europe-west2/repositories/r/workflows/42?project=p', 'Only a page of console.cloud.google.com'],
            ['http://console.cloud.google.com/bigquery/dataform/locations/europe-west2/repositories/r/workflows/42', 'Only a page of console.cloud.google.com'],
            ['javascript:alert(1)//workflows/42', 'Only a page of console.cloud.google.com'],
            ['https://console.cloud.google.com@evil.example/x/workflows/42', 'Only a page of console.cloud.google.com'],
            ['$(touch pwned)', 'not a workflow ID'],
            ['42;rm -rf', 'not a workflow ID'],
            ['42\nsecond line', 'not a workflow ID'],
            ['https://console.cloud.google.com/x/locations/..%2f..%2fx/repositories/r/workflows/42', 'not a location'],
            ['projects/p;x/locations/europe-west2/repositories/r/workflowInvocations/42', 'not a project'],
            ['projects/p/locations/europe-west2/repositories/r$x/workflowInvocations/42', 'not a repository name'],
            ['a'.repeat(3000), 'too long'],
        ];
        for (const [input, message] of cases) {
            assert.throws(() => parseInvocation(input), (error: Error) => error.message.includes(message), `${JSON.stringify(input)} should fail with "${message}"`);
        }
    });
});

suite('A watched workflow in the run history', () => {
    test('watching it again updates its row rather than adding one', () => {
        const history = [{ workflowInvocationId: 'a', state: 'RUNNING' }, { workflowInvocationId: 'b', state: 'RUNNING' }];
        assert.deepStrictEqual(withRunUpserted(history, { workflowInvocationId: 'a', state: 'SUCCEEDED' }), [{ workflowInvocationId: 'a', state: 'SUCCEEDED' }, history[1]]);
        assert.deepStrictEqual(withRunUpserted(history, { workflowInvocationId: 'c', state: 'RUNNING' }, 2), [history[1], { workflowInvocationId: 'c', state: 'RUNNING' }]);
    });

    test('is not one of your own runs', () => {
        const history = [{ executionMode: 'api' }, { executionMode: 'external' }, { executionMode: 'cli' }];
        assert.deepStrictEqual(ownRuns(history), [{ executionMode: 'api' }, { executionMode: 'cli' }]);
        assert.ok(isExternalRun({ executionMode: 'external' }) && !isExternalRun({}));
    });
});
