import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostEstimatorTab } from '../../../webviews/preview_compiled/components/CostEstimatorTab';
import type { PanelState } from '../../../webviews/preview_compiled/types';
import type { DataformBlock } from '../../shared/panelContract';
import { EMPTY_DATAFORM_BLOCK } from '../../shared/panelState';
import type { TagDryRunStatsMeta } from '../../types';

const PROMPT = 'Select one or more tags and click Estimate Cost to see results.';

/** The tab for a cost estimate as the host sends it: in the `dataform` block */
function render(tagCostEstimate?: DataformBlock['tagCostEstimate'], flat: Partial<PanelState> = {}): string {
    const state: PanelState = { ...flat, dataform: { ...EMPTY_DATAFORM_BLOCK, tagCostEstimate } };
    return renderToStaticMarkup(createElement(CostEstimatorTab, { state }));
}

suite('CostEstimatorTab', () => {
    test('shows the error of a failed estimate as the host sends it: text', () => {
        // Typed as the host's own result, so the two sides cannot drift apart again without this failing to compile
        const tagDryRunStatsMeta: TagDryRunStatsMeta = { tagDryRunStatsList: undefined, error: 'Access Denied: bigquery.jobs.create' };
        const html = render({ rows: tagDryRunStatsMeta.tagDryRunStatsList, error: tagDryRunStatsMeta.error });

        assert.ok(html.includes('Estimation Failed'));
        assert.ok(html.includes('Access Denied: bigquery.jobs.create'), 'the error box has no text');
        assert.ok(!html.includes(PROMPT));
    });

    test('shows what is wrong with the file ahead of the error of the estimate', () => {
        const file = { compile: 1, file: 'definitions/a.sqlx', role: 'not compiled' as const, actions: [], problem: { kind: 'other' as const, message: 'Unable to retrieve metadata' } };
        const html = render({ error: 'Access Denied' }, { file });

        assert.ok(html.includes('Unable to retrieve metadata'));
        assert.ok(!html.includes('Access Denied'));
    });

    test('shows no error box before an estimate has been asked for', () => {
        const html = render();

        assert.ok(!html.includes('Estimation Failed'));
        assert.ok(html.includes(PROMPT));
    });
});
