import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowActionsTable } from '../../../webviews/preview_compiled/components/WorkflowActionsTable';
import type { WorkflowUrlEntry } from '../../../webviews/preview_compiled/types';
import type { WorkflowAction } from '../../types';

const job = (target: string, state: string, durationMs?: number, more: Partial<WorkflowAction> = {}): WorkflowAction =>
    ({ target, state, jobId: `job_${target}`, jobStats: durationMs === undefined ? undefined : { durationMs, startTime: 0, endTime: durationMs, totalSlotMs: 1000, bytesBilledLabel: '10.00 MiB', costLabel: '$0.0001' }, ...more });

function render(actions: WorkflowAction[], executionMode: WorkflowUrlEntry['executionMode'] = 'cli'): string {
    const entry = { timestamp: 1, state: 'RUNNING', executionMode, workflowInvocationId: 'run-1', actions } as WorkflowUrlEntry;
    return renderToStaticMarkup(createElement(WorkflowActionsTable, { entry, className: '' }));
}

suite('WorkflowActionsTable: the list of what a run ran', () => {
    test('has what failed first, then what is at work, then what is done from the slowest', () => {
        const html = render([
            job('p.ds.quick', 'SUCCEEDED', 500),
            job('p.ds.waiting', 'PENDING'),
            job('p.ds.slow', 'SUCCEEDED', 9000),
            job('p.ds.going', 'RUNNING'),
            job('p.ds.broken', 'FAILED', 700, { failureReason: 'Not found: Table p.raw.x' }),
        ]);

        const at = (text: string) => { const index = html.indexOf(text); assert.ok(index >= 0, `${text} is not shown`); return index; };
        const order = ['>broken<', '>going<', '>waiting<', '>slow<', '>quick<'].map(at);
        assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
        // The reason is under the line of what failed, and what has no cost says how it stands instead
        assert.ok(at('Not found: Table p.raw.x') > at('>broken<') && at('Not found: Table p.raw.x') < at('>going<'));
        assert.ok(html.includes('>pending<') && html.includes('>running<'));
        assert.ok(html.includes('1 failed') && html.includes('1 running') && html.includes('1 pending'));
        assert.ok(html.includes('2 of 5 BigQuery jobs done'));
    });

    test('names the actions of a run through the API, each with its executed SQL', () => {
        const html = render([job('p.ds.a', 'SUCCEEDED', 500)], 'api');

        assert.ok(html.includes('1 of 1 action done'));
        assert.ok(html.includes('View executed SQL'));
        assert.ok(!render([job('p.ds.a', 'SUCCEEDED', 500)]).includes('View executed SQL'));
    });

    test('shows nothing for a run whose actions are not known', () => {
        assert.strictEqual(render([]), '');
    });
});
