import * as assert from 'assert';
import { suite, test } from 'mocha';
import { ApiRunGitState, describeApiRunGitState, isDataformProjectFile, parseNameStatusZ, parseStatusPorcelainZ } from '../../shared/apiRunGitState';

function tracking(overrides: Partial<Extract<ApiRunGitState, { kind: 'tracking' }>> = {}): ApiRunGitState {
    return { kind: 'tracking', branch: 'feat/orders', upstream: 'origin/feat/orders', uncommitted: [], unpushedCommits: 0, unpushedFiles: [], behind: 0, ...overrides };
}

suite('apiRunGitState.isDataformProjectFile', () => {
    test('counts files that change what the API compiles', () => {
        assert.ok(isDataformProjectFile('definitions/orders.sqlx'));
        assert.ok(isDataformProjectFile('includes/helpers.js'));
        assert.ok(isDataformProjectFile('workflow_settings.yaml'));
        assert.ok(isDataformProjectFile('package.json'));
    });

    test('ignores other files', () => {
        assert.ok(!isDataformProjectFile('README.md'));
        assert.ok(!isDataformProjectFile('.vscode/settings.json'));
        assert.ok(!isDataformProjectFile('definitions_old/orders.sqlx'));
    });
});

suite('apiRunGitState.parseStatusPorcelainZ', () => {
    test('strips the Dataform folder prefix and maps statuses', () => {
        const output = ' M df/definitions/a.sqlx\0?? df/includes/new.js\0D  df/definitions/gone.sqlx\0 M README.md\0';
        assert.deepStrictEqual(parseStatusPorcelainZ(output, 'df/'), [
            { path: 'definitions/a.sqlx', status: 'M', source: 'uncommitted' },
            { path: 'includes/new.js', status: 'A', source: 'uncommitted' },
            { path: 'definitions/gone.sqlx', status: 'D', source: 'uncommitted' },
        ]);
    });

    test('works when the Dataform project is the repository root', () => {
        assert.deepStrictEqual(parseStatusPorcelainZ('A  definitions/a.sqlx\0', ''), [
            { path: 'definitions/a.sqlx', status: 'A', source: 'uncommitted' },
        ]);
    });
});

suite('apiRunGitState.parseNameStatusZ', () => {
    test('reads status and path pairs', () => {
        assert.deepStrictEqual(parseNameStatusZ('A\0definitions/b.sqlx\0M\0notes.md\0'), [
            { path: 'definitions/b.sqlx', status: 'A', source: 'unpushed' },
        ]);
    });
});

suite('apiRunGitState.describeApiRunGitState', () => {
    test('shows nothing outside a git repository', () => {
        assert.strictEqual(describeApiRunGitState({ kind: 'unavailable' }), undefined);
        assert.strictEqual(describeApiRunGitState(undefined), undefined);
    });

    test('names the ref it runs when nothing is left out', () => {
        const summary = describeApiRunGitState(tracking());
        assert.strictEqual(summary?.tone, 'muted');
        assert.strictEqual(summary?.label, 'Runs origin/feat/orders');
    });

    test('counts uncommitted files and unpushed commits separately', () => {
        const summary = describeApiRunGitState(tracking({
            uncommitted: [
                { path: 'definitions/a.sqlx', status: 'M', source: 'uncommitted' },
                { path: 'includes/h.js', status: 'A', source: 'uncommitted' },
            ],
            unpushedCommits: 1,
            unpushedFiles: [{ path: 'definitions/b.sqlx', status: 'M', source: 'unpushed' }],
        }));
        assert.strictEqual(summary?.tone, 'warning');
        assert.strictEqual(summary?.label, "2 uncommitted files · 1 unpushed commit won't run");
        assert.ok(summary?.tooltip.includes('  M definitions/b.sqlx (unpushed)'));
    });

    test('mentions upstream commits missing locally in the tooltip only', () => {
        const summary = describeApiRunGitState(tracking({ behind: 2 }));
        assert.strictEqual(summary?.label, 'Runs origin/feat/orders');
        assert.ok(summary?.tooltip.includes("has 2 commits you don't have locally"));
    });

    test('warns that a branch not on the remote cannot run', () => {
        assert.strictEqual(describeApiRunGitState({ kind: 'noUpstream', branch: 'feat/x' })?.label, "feat/x isn't on the git remote — API run will fail");
        assert.strictEqual(describeApiRunGitState({ kind: 'noUpstream' })?.tone, 'error');
    });
});
