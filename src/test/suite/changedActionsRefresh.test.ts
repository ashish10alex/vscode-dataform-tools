import * as assert from 'assert';
import { suite, test } from 'mocha';
import { headKey } from '../../gitHeadWatcher';
import { baseCacheDay, noChangesMessage, selectChangedFiles } from '../../changedActions';
import { ChangedAction } from '../../utils/compiledGraphDiff';

function repo(name: string | undefined, commit: string | undefined) {
    return { state: { HEAD: name === undefined && commit === undefined ? undefined : { name, commit } } } as any;
}

suite('gitHeadWatcher.headKey', () => {
    test('changes when the branch or the commit changes', () => {
        const base = headKey(repo('main', 'abc'));
        assert.notStrictEqual(headKey(repo('feature', 'abc')), base);
        assert.notStrictEqual(headKey(repo('main', 'def')), base);
        assert.strictEqual(headKey(repo('main', 'abc')), base);
    });

    test('handles a detached HEAD and a repository with no HEAD yet', () => {
        assert.strictEqual(headKey(repo(undefined, 'abc')), '@abc');
        assert.strictEqual(headKey(repo(undefined, undefined)), '@');
    });
});

suite('changedActions.noChangesMessage', () => {
    test('explains that the default branch has nothing to compare against itself', () => {
        const message = noChangesMessage({ baseRef: 'origin/main', headRef: 'main', defaultBranch: 'main', onDefaultBranch: true });
        assert.ok(message.startsWith("You're on main, the branch Run Changed compares against"));
    });

    test('names both branches on a feature branch', () => {
        assert.strictEqual(
            noChangesMessage({ baseRef: 'origin/main', headRef: 'feat/orders', defaultBranch: 'main', onDefaultBranch: false }),
            'No changed actions in feat/orders vs origin/main',
        );
    });
});

suite('changedActions.baseCacheDay', () => {
    test('keys the base by UTC day, so date-dependent includes compile alike on both sides', () => {
        assert.strictEqual(baseCacheDay(new Date('2026-09-28T23:59:59Z')), '2026-09-28');
        assert.notStrictEqual(baseCacheDay(new Date('2026-09-27T10:54:00Z')), baseCacheDay(new Date('2026-09-28T09:00:00Z')));
    });
});

function action(name: string, fileName: string): ChangedAction {
    return { target: `p.d.${name}`, targetObj: { database: 'p', schema: 'd', name }, fileName, type: 'table', reasons: ['sql'] };
}

suite('changedActions.selectChangedFiles', () => {
    const changed = [action('orders', 'definitions/orders.sqlx'), action('a', 'definitions/gen.js'), action('b', 'definitions/gen.js'), action('x', '')];

    test('runs every changed action when no files were picked', () => {
        const selection = selectChangedFiles(changed, undefined);
        assert.strictEqual(selection.actions.length, 4);
        assert.strictEqual(selection.subset, false);
        assert.strictEqual(selection.changedFileCount, 3);
    });

    test('keeps every action of the picked files, and actions without a file under their shared key', () => {
        const selection = selectChangedFiles(changed, ['definitions/gen.js', '(unknown file)']);
        assert.deepStrictEqual(selection.actions.map((a) => a.target), ['p.d.a', 'p.d.b', 'p.d.x']);
        assert.strictEqual(selection.subset, true);
    });

    test('is not a subset when every changed file was picked', () => {
        assert.strictEqual(selectChangedFiles(changed, ['definitions/orders.sqlx', 'definitions/gen.js', '(unknown file)', 'definitions/old.sqlx']).subset, false);
    });

    test('leaves out files that became changed after the pick', () => {
        const selection = selectChangedFiles([...changed, action('new', 'definitions/new.sqlx')], ['definitions/orders.sqlx', 'definitions/gen.js', '(unknown file)']);
        assert.ok(!selection.actions.some((a) => a.target === 'p.d.new'));
        assert.strictEqual(selection.subset, true);
    });

    test('selects nothing when the picked files no longer have changes', () => {
        assert.deepStrictEqual(selectChangedFiles(changed, ['definitions/reverted.sqlx']).actions, []);
    });
});
