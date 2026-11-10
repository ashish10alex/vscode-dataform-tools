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

    test('in cost order, what cost the most is first, and what has no cost yet follows in the usual order', () => {
        const costing = (target: string, cost: number) =>
            job(target, 'SUCCEEDED', 500, { jobStats: { durationMs: 500, startTime: 0, endTime: 500, totalSlotMs: 1000, cost, costLabel: '$' + cost.toFixed(4) } });
        const entry = {
            timestamp: 1, state: 'RUNNING', executionMode: 'external', workflowInvocationId: 'run-1',
            actions: [
                costing('p.ds.cheap', 0.01),
                job('p.ds.going', 'RUNNING'),
                costing('p.ds.dear', 2.5),
                job('p.ds.broken', 'FAILED', 700, { failureReason: 'boom' }),
                costing('p.ds.middling', 0.3),
            ],
        } as WorkflowUrlEntry;
        const html = renderToStaticMarkup(createElement(WorkflowActionsTable, { entry, className: '', order: 'cost' }));
        const order = ['>dear<', '>middling<', '>cheap<', '>broken<', '>going<'].map((text) => html.indexOf(text));
        assert.ok(order.every((index) => index >= 0), html);
        assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
        assert.ok(html.includes('costliest first'));
    });

    test('while costs are read, a finished action without one says it is coming, and one with a cost keeps it', () => {
        const entry = {
            timestamp: 1, state: 'RUNNING', executionMode: 'external', workflowInvocationId: 'run-1',
            actions: [job('p.ds.read', 'SUCCEEDED', 500), job('p.ds.unread', 'SUCCEEDED')],
        } as WorkflowUrlEntry;
        const loading = renderToStaticMarkup(createElement(WorkflowActionsTable, { entry, className: '', costsLoading: true }));
        assert.strictEqual(loading.split('reading its cost').length - 1, 1);
        assert.ok(loading.includes('$0.0001'));

        const done = renderToStaticMarkup(createElement(WorkflowActionsTable, { entry, className: '' }));
        assert.ok(!done.includes('reading its cost'));
    });
});
