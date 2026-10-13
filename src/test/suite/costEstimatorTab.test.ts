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

    test('lists the actions under their datasets: a dataset with a failure first, then the one that costs the most', () => {
        const row = (targetName: string, fields: object) => ({ targetName, schema: targetName.split('.')[1], type: 'table', statementType: 'SELECT', totalBytesProcessedAccuracy: 'PRECISE', ...fields });
        const html = render({ rows: [
            row('p.cheap.a', { totalGBProcessed: '1.000', costOfRunningModel: 0.01 }),
            row('p.dear.small', { totalGBProcessed: '2.000', costOfRunningModel: 0.02 }),
            row('p.dear.big', { totalGBProcessed: '40.000', costOfRunningModel: 0.25, totalBytesProcessedAccuracy: 'UPPER_BOUND' }),
            row('p.dear.unsure', { bytesEstimateUnknown: true, totalBytesProcessedAccuracy: 'UNKNOWN' }),
            row('p.broken.x', { error: 'Not found: Table p.raw.x' }),
        ] });

        const at = (text: string) => { const index = html.indexOf(text); assert.ok(index >= 0, `${text} is not shown`); return index; };
        // The datasets, then the actions of the one that costs the most: the dearest first, the one with no estimate last
        assert.ok(at('aria-label="p.broken"') < at('aria-label="p.dear"') && at('aria-label="p.dear"') < at('aria-label="p.cheap"'));
        assert.ok(at('>big<') < at('>small<') && at('>small<') < at('>unsure<'));
        assert.ok(html.includes('Not found: Table p.raw.x'));
        assert.ok(html.includes('upper bound'));
        // What has no estimate and what failed are counted, and are in no total
        assert.ok(html.includes('1 failed') && html.includes('1 unknown'));
        assert.ok(html.includes('5 actions · 43.00 GiB · $0.28'));
    });

    test('shows no error box before an estimate has been asked for', () => {
        const html = render();

        assert.ok(!html.includes('Estimation Failed'));
        assert.ok(html.includes(PROMPT));
    });
});
