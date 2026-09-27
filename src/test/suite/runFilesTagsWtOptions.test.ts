import * as assert from 'assert';
import { suite, test } from 'mocha';
import { getRunSingleTagCommand } from '../../runFilesTagsWtOptions';

suite('runFilesTagsWtOptions.getRunSingleTagCommand', () => {
    const workspaceFolder = '/repo/analytics';

    test('includes --include-deps only when dependencies are requested', () => {
        const withDeps = getRunSingleTagCommand(workspaceFolder, 'daily', true, false, false);
        assert.ok(withDeps.includes('--tags=daily'));
        assert.ok(withDeps.includes('--include-deps'));
        assert.ok(!withDeps.includes('--include-dependents'));

        const withoutDeps = getRunSingleTagCommand(workspaceFolder, 'daily', false, false, false);
        assert.ok(!withoutDeps.includes('--include-deps'));
    });

    test('does not add --include-deps when only dependents are requested', () => {
        const cmd = getRunSingleTagCommand(workspaceFolder, 'daily', false, true, false);
        assert.ok(cmd.includes('--include-dependents'));
        assert.ok(!cmd.includes('--include-deps'));
    });

    test('adds --full-refresh when requested', () => {
        const cmd = getRunSingleTagCommand(workspaceFolder, 'daily', false, false, true);
        assert.ok(cmd.includes('--full-refresh'));
    });
});
