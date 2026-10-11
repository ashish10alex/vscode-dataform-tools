import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowURLsTab, gitRunLine } from '../../../webviews/preview_compiled/components/WorkflowURLsTab';
import type { PanelState } from '../../../webviews/preview_compiled/types';
import type { ApiRunGitState } from '../../shared/apiRunGitState';
import { EMPTY_DATAFORM_BLOCK } from '../../shared/panelState';

const tracking = (fields: Partial<Extract<ApiRunGitState, { kind: 'tracking' }>> = {}): ApiRunGitState =>
    ({ kind: 'tracking', branch: 'feat/x', upstream: 'origin/feat/x', uncommitted: [], unpushedCommits: 0, unpushedFiles: [], behind: 0, ...fields });

function render(apiRunGitState?: ApiRunGitState): string {
    const state: PanelState = { dataform: { ...EMPTY_DATAFORM_BLOCK, apiRunGitState } };
    return renderToStaticMarkup(createElement(WorkflowURLsTab, { state }));
}

suite('WorkflowURLsTab: what a run from the git remote would use', () => {
    test('names the branch on the remote, and says so where it is what the local files are', () => {
        assert.strictEqual(gitRunLine(tracking()), 'Runs origin/feat/x, which matches your local files');
        assert.strictEqual(gitRunLine(tracking({ behind: 2 })), "Runs origin/feat/x, which has 2 commits you don't have locally");
    });

    test('warns of the local changes a run would leave out, beside the branch it runs', () => {
        const html = render(tracking({ uncommitted: [{ path: 'definitions/a.sqlx', status: 'M', source: 'uncommitted' }] }));

        assert.ok(html.includes('1 uncommitted file won&#x27;t run'));
        assert.ok(html.includes('Runs origin/feat/x, not your local files'));
    });

    test('says a branch that is not on the remote has to be pushed', () => {
        const html = render({ kind: 'noUpstream', branch: 'feat/x' });

        assert.ok(html.includes('feat/x isn&#x27;t on the git remote'));
        assert.ok(html.includes('Push the branch first'));
    });

    test('says what a run from git is where nothing is known of the repository', () => {
        assert.ok(render().includes('Runs the committed code of your active git branch'));
        assert.ok(render({ kind: 'unavailable' }).includes('Runs the committed code of your active git branch'));
    });
});
