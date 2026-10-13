import * as assert from 'assert';
import { suite, test } from 'mocha';
import { buildLastRunView, describeOverrides, findMissingItems, isFromOtherFolder, planReplay, resolveReplayMode, summarizeItems, summarizeLastRun } from '../../lastRun';
import { LastRunRequest } from '../../types';

function request(overrides: Partial<LastRunRequest> = {}): LastRunRequest {
    return {
        kind: 'tags',
        items: ['daily'],
        includeDependencies: false,
        includeDependents: false,
        fullRefresh: false,
        executionMode: 'cli',
        workspaceFolder: '/repo/analytics',
        timestamp: 1_700_000_000_000,
        ...overrides,
    };
}

suite('lastRun.summarizeItems', () => {
    test('lists up to two items and counts the rest', () => {
        assert.strictEqual(summarizeItems(['a']), 'a');
        assert.strictEqual(summarizeItems(['a', 'b']), 'a, b');
        assert.strictEqual(summarizeItems(['a', 'b', 'c', 'd', 'e']), 'a, b +3 more');
    });
});

suite('lastRun.summarizeLastRun', () => {
    test('describes a tag run with dependencies', () => {
        const { label } = summarizeLastRun(request({ includeDependencies: true }), 'cli');
        assert.strictEqual(label, 'tag daily · +dependencies · CLI');
    });

    test('names the actions of a run of actions, which have no file to check for', () => {
        const actions = request({ kind: 'actions', items: ['p.d.orders', 'p.d.orders_graph'] });
        const { label, detail } = summarizeLastRun(actions, 'cli');
        assert.strictEqual(label, '2 actions: p.d.orders, p.d.orders_graph · CLI');
        assert.ok(detail.includes('Actions: p.d.orders, p.d.orders_graph'));
        assert.deepStrictEqual(findMissingItems(actions, undefined, () => false), []);
    });

    test('uses file names in the label and full paths in the detail', () => {
        const { label, detail } = summarizeLastRun(
            request({ kind: 'currentFile', items: ['definitions/marts/orders.sqlx'], fullRefresh: true }),
            'api',
        );
        assert.strictEqual(label, 'file orders.sqlx · full refresh · API');
        assert.ok(detail.includes('Files: definitions/marts/orders.sqlx'));
        assert.ok(detail.includes('Full refresh: yes'));
    });

    test('truncates long file lists in the label', () => {
        const { label } = summarizeLastRun(
            request({ kind: 'files', items: ['d/a.sqlx', 'd/b.sqlx', 'd/c.sqlx'], includeDependents: true }),
            'api_workspace',
        );
        assert.strictEqual(label, '3 files: a.sqlx, b.sqlx +1 more · +dependents · API (remote workspace)');
    });

    test('describes a changed-actions run by its branches and notes the rerun recomputes', () => {
        const { label, detail } = summarizeLastRun(
            request({ kind: 'changed', items: ['p.d.orders', 'p.d.customers'], baseRef: 'origin/main', headRef: 'feat/orders' }),
            'cli',
        );
        assert.strictEqual(label, '2 changed actions in feat/orders vs origin/main · CLI');
        assert.ok(detail.includes('Last ran 2 actions: p.d.orders, p.d.customers (recomputed on rerun)'));
    });

    test('counts the picked files of a changed-actions run that left some out', () => {
        const { label, detail } = summarizeLastRun(
            request({ kind: 'changed', items: ['p.d.orders', 'p.d.a'], files: ['definitions/orders.sqlx', 'definitions/gen.js'], changedFileCount: 5, baseRef: 'origin/main', headRef: 'feat/orders' }),
            'cli',
        );
        assert.strictEqual(label, '2 changed actions (2 of 5 files) in feat/orders vs origin/main · CLI');
        assert.ok(detail.includes('Only changes in: definitions/orders.sqlx, definitions/gen.js'));
    });

    test('counts only the picked files that had changes on a rerun', () => {
        const { label, detail } = summarizeLastRun(
            request({ kind: 'changed', items: ['p.d.orders'], files: ['definitions/orders.sqlx', 'definitions/reverted.sqlx'], changedFileCount: 1, selectedFileCount: 1, baseRef: 'origin/main', headRef: 'feat/orders' }),
            'cli',
        );
        assert.strictEqual(label, '1 changed action (1 of 1 files) in feat/orders vs origin/main · CLI');
        assert.ok(detail.includes('Only changes in: definitions/orders.sqlx, definitions/reverted.sqlx'));
    });

    test('leaves out the branch of changed-actions runs recorded without one', () => {
        const { label } = summarizeLastRun(request({ kind: 'changed', items: ['p.d.orders'], baseRef: 'origin/main' }), 'api');
        assert.strictEqual(label, '1 changed action vs origin/main · API');
    });

    test('lists compiler overrides in the detail only when present', () => {
        assert.ok(!summarizeLastRun(request(), 'cli').detail.includes('Compiler overrides'));
        assert.ok(summarizeLastRun(request(), 'cli', 'schemaSuffix=dev').detail.includes('Compiler overrides: schemaSuffix=dev'));
    });
});

suite('lastRun.describeOverrides', () => {
    test('summarises scalar options and vars, ignoring empty values', () => {
        assert.strictEqual(describeOverrides({}), undefined);
        assert.strictEqual(describeOverrides(undefined), undefined);
        assert.strictEqual(
            describeOverrides({ schemaSuffix: 'dev', tablePrefix: '', vars: { env: 'test' } }),
            'schemaSuffix=dev; vars: env=test',
        );
    });
});

suite('lastRun.resolveReplayMode', () => {
    test('replays CLI runs through the API in remote mode', () => {
        assert.strictEqual(resolveReplayMode('cli', true), 'api');
        assert.strictEqual(resolveReplayMode('cli', false), 'cli');
    });

    test('keeps API modes as recorded', () => {
        assert.strictEqual(resolveReplayMode('api', false), 'api');
        assert.strictEqual(resolveReplayMode('api_workspace', true), 'api_workspace');
    });
});

suite('lastRun.planReplay', () => {
    test('keeps dependencies and dependents distinct', () => {
        const plan = planReplay(request({ includeDependencies: true }), false);
        assert.strictEqual(plan.includeDependencies, true);
        assert.strictEqual(plan.includeDependents, false);
    });

    test('routes tag runs by the mode they replay in', () => {
        assert.strictEqual(planReplay(request({ executionMode: 'cli' }), false).runner, 'tagsCli');
        assert.strictEqual(planReplay(request({ executionMode: 'cli' }), true).runner, 'tagsApi');
        assert.strictEqual(planReplay(request({ executionMode: 'api_workspace' }), false).runner, 'tagsApi');
    });

    test('routes file runs to the matching runner', () => {
        assert.strictEqual(planReplay(request({ kind: 'currentFile', items: ['a.sqlx'] }), false).runner, 'currentFile');
        assert.strictEqual(planReplay(request({ kind: 'files', items: ['a.sqlx'] }), false).runner, 'files');
    });

    test('routes a run of actions to the runner that takes them', () => {
        assert.strictEqual(planReplay(request({ kind: 'actions', items: ['p.d.orders'] }), false).runner, 'actions');
        assert.strictEqual(planReplay(request({ kind: 'actions', items: ['p.d.orders'] }), true).executionMode, 'api');
    });

    test('routes changed-actions runs to the recomputing runner', () => {
        assert.strictEqual(planReplay(request({ kind: 'changed', items: ['p.d.orders'] }), true).runner, 'changed');
    });
});

suite('lastRun.findMissingItems', () => {
    test('reports tags that are no longer in the project', () => {
        assert.deepStrictEqual(findMissingItems(request({ items: ['daily', 'gone'] }), ['daily'], () => true), ['gone']);
    });

    test('skips the tag check when the project could not be compiled', () => {
        assert.deepStrictEqual(findMissingItems(request({ items: ['daily'] }), undefined, () => true), []);
    });

    test('reports every tag when the project no longer has any', () => {
        assert.deepStrictEqual(findMissingItems(request({ items: ['daily'] }), [], () => true), ['daily']);
    });

    test('reports files that no longer exist', () => {
        const missing = findMissingItems(
            request({ kind: 'files', items: ['a.sqlx', 'b.sqlx'] }),
            undefined,
            (relativePath) => relativePath === 'a.sqlx',
        );
        assert.deepStrictEqual(missing, ['b.sqlx']);
    });

    test('never reports changed-actions runs as missing, since they are recomputed', () => {
        assert.deepStrictEqual(findMissingItems(request({ kind: 'changed', items: ['p.d.gone'] }), undefined, () => false), []);
    });
});

suite('lastRun.isFromOtherFolder', () => {
    test('rejects replaying against a different Dataform folder', () => {
        assert.strictEqual(isFromOtherFolder(request(), '/repo/marketing'), true);
        assert.strictEqual(isFromOtherFolder(request(), '/repo/analytics/'), false);
    });
});

suite('lastRun.buildLastRunView', () => {
    test('returns null when nothing has run yet', () => {
        assert.strictEqual(buildLastRunView(undefined, false, {}), null);
    });

    test('shows the mode the replay will actually use', () => {
        const view = buildLastRunView(request({ executionMode: 'cli' }), true, {});
        assert.ok(view?.label.endsWith('· API'));
        assert.strictEqual(view?.executionMode, 'api');
    });
});

suite('lastRun defer to prod', () => {
    test('labels a run recorded with defer to prod so a rerun says it reads prod', () => {
        const { label, detail } = summarizeLastRun(request({ deferToProd: true }), 'cli');
        assert.ok(label.includes('deferred to prod'));
        assert.ok(detail.includes('Defer to prod: yes'));
        assert.ok(!summarizeLastRun(request(), 'cli').label.includes('deferred to prod'));
    });
});
