import * as assert from 'assert';
import { suite, test } from 'mocha';
import { headKey } from '../../gitHeadWatcher';
import { noChangesMessage } from '../../changedActions';

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
        const message = noChangesMessage({ baseRef: 'origin/main', onDefaultBranch: true });
        assert.ok(message.startsWith("You're on main, the branch Run Changed compares against"));
    });

    test('names the base on a feature branch', () => {
        assert.strictEqual(noChangesMessage({ baseRef: 'origin/main', onDefaultBranch: false }), 'No changed actions vs origin/main');
    });
});
