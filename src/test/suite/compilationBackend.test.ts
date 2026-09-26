import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { isTransientGitRemoteError, pickBackendConfigurationTarget } from '../../utils/remoteCompiler';

suite('remoteCompiler.pickBackendConfigurationTarget', () => {
    test('updates the workspace value that shadows the user setting', () => {
        // User settings "api" + workspace "cli": writing to user settings would have no effect
        assert.strictEqual(
            pickBackendConfigurationTarget({ globalValue: 'api', workspaceValue: 'cli' }, true),
            vscode.ConfigurationTarget.Workspace,
        );
    });

    test('prefers a workspace folder value over workspace and user values', () => {
        assert.strictEqual(
            pickBackendConfigurationTarget({ globalValue: 'api', workspaceValue: 'cli', workspaceFolderValue: 'cli' }, true),
            vscode.ConfigurationTarget.WorkspaceFolder,
        );
    });

    test('keeps a user-level choice in user settings', () => {
        assert.strictEqual(pickBackendConfigurationTarget({ globalValue: 'cli' }, true), vscode.ConfigurationTarget.Global);
    });

    test('writes to the workspace when nothing is set, or to user settings without a workspace', () => {
        assert.strictEqual(pickBackendConfigurationTarget({}, true), vscode.ConfigurationTarget.Workspace);
        assert.strictEqual(pickBackendConfigurationTarget(undefined, false), vscode.ConfigurationTarget.Global);
    });
});

suite('remoteCompiler.isTransientGitRemoteError', () => {
    test('retries git remote timeouts reported by the Dataform API', () => {
        assert.ok(isTransientGitRemoteError({ code: 3, details: 'Error during remote operation: `Connection time out`.' }));
        assert.ok(isTransientGitRemoteError({ code: 3, details: 'Error during remote operation: `Read timed out`.' }));
        assert.ok(isTransientGitRemoteError({ code: 14, details: 'Service unavailable' }));
    });

    test('does not retry genuine invalid arguments', () => {
        assert.ok(!isTransientGitRemoteError({ code: 3, details: 'Error during remote operation: `Couldn\'t find remote ref feature/x`.' }));
        assert.ok(!isTransientGitRemoteError({ code: 3, details: 'Invalid compilation config' }));
        assert.ok(!isTransientGitRemoteError({ code: 7, details: 'Permission denied' }));
    });
});
