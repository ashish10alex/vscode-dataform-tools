import * as assert from 'assert';
import path from 'path';
import { suite, test } from 'mocha';
import { isInsideRepository } from '../../gitHeadWatcher';

suite('isInsideRepository', () => {
    const repo = path.join(path.sep, 'work', 'repo');
    const other = path.join(path.sep, 'work', 'other');

    test('a file in a watched repository is inside it', () => {
        assert.strictEqual(isInsideRepository([repo], path.join(repo, 'definitions', 'orders.sqlx')), true);
        assert.strictEqual(isInsideRepository([other, repo], path.join(repo, 'workflow_settings.yaml')), true);
        assert.strictEqual(isInsideRepository([repo], repo), true);
    });

    test('a file elsewhere is not', () => {
        assert.strictEqual(isInsideRepository([repo], path.join(other, 'definitions', 'orders.sqlx')), false);
        assert.strictEqual(isInsideRepository([repo], path.join(path.sep, 'work', 'repo-old', 'orders.sqlx')), false);
        assert.strictEqual(isInsideRepository([repo], path.join(path.sep, 'work', 'notes.md')), false);
    });

    test('with no repository watched nothing is inside', () => {
        assert.strictEqual(isInsideRepository([], path.join(repo, 'definitions', 'orders.sqlx')), false);
    });
});
