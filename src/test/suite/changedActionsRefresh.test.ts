import * as assert from 'assert';
import { suite, test } from 'mocha';
import { headKey } from '../../gitHeadWatcher';
import { baseCacheDay, noChangesMessage } from '../../changedActions';

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
