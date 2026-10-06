import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostEstimatorTab } from '../../../webviews/preview_compiled/components/CostEstimatorTab';
import type { WebviewState } from '../../../webviews/preview_compiled/types';
import type { TagDryRunStatsMeta } from '../../types';

const PROMPT = 'Select one or more tags and click Estimate Cost to see results.';

function render(state: WebviewState): string {
    return renderToStaticMarkup(createElement(CostEstimatorTab, { state }));
}

suite('CostEstimatorTab', () => {
    test('shows the error of a failed estimate as the host sends it: text', () => {
        // Typed as the host's own result, so the two sides cannot drift apart again without this failing to compile
        const tagDryRunStatsMeta: TagDryRunStatsMeta = { tagDryRunStatsList: undefined, error: 'Access Denied: bigquery.jobs.create' };
        const html = render({ tagDryRunStatsMeta });

        assert.ok(html.includes('Estimation Failed'));
        assert.ok(html.includes('Access Denied: bigquery.jobs.create'), 'the error box has no text');
        assert.ok(!html.includes(PROMPT));
    });

    test('shows the panel error message ahead of the error of the estimate', () => {
        const html = render({ errorMessage: 'No tags selected', tagDryRunStatsMeta: { error: 'Access Denied' } });

        assert.ok(html.includes('No tags selected'));
        assert.ok(!html.includes('Access Denied'));
    });

    test('shows no error box before an estimate has been asked for', () => {
        const html = render({});

        assert.ok(!html.includes('Estimation Failed'));
        assert.ok(html.includes(PROMPT));
    });
});
