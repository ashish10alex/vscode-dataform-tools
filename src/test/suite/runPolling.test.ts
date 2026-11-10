import * as assert from 'assert';
import { suite, test } from 'mocha';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MAX_POLL_FAILURES, POLL_CANCELING_MS, POLL_FAST_MS, POLL_SLOW_MS, POLL_TIMEOUT_MS, needsPolling, nextPollDelay, polledRuns, runKey } from '../../shared/runPolling';
import type { WorkflowUrlEntry } from '../../types';
import { RunList, whatRan } from '../../../webviews/runs/RunList';
import { RunDetail } from '../../../webviews/runs/RunDetail';

const api = (id: string, state: string | undefined, more: Partial<WorkflowUrlEntry> = {}): WorkflowUrlEntry => ({
    url: `https://console.cloud.google.com/x/${id}`, timestamp: Number(id.replace(/\D/g, '')) || 1, workspace: 'repo', includeDependencies: false, includeDependents: false, fullRefresh: false,
    executionMode: 'api', workflowInvocationId: id, projectId: 'p', location: 'europe-west2', repositoryName: 'repo', state, ...more,
});

suite('Runs: when the history is asked about again', () => {
    test('a run through the API that has not ended is polled; a CLI run, an ended one and an unwatched one are not', () => {
        assert.ok(needsPolling(api('r1', 'RUNNING')));
        assert.ok(needsPolling(api('r1', undefined)));
        assert.ok(!needsPolling(api('r1', 'SUCCEEDED')));
        assert.ok(!needsPolling(api('r1', 'RUNNING', { executionMode: 'cli' })));
        assert.ok(!needsPolling(api('r1', 'RUNNING', { executionMode: 'external', unwatched: true })));
        // The reasons of a failed run are read once more
        assert.ok(needsPolling(api('r1', 'FAILED')));
        assert.ok(!needsPolling(api('r1', 'FAILED', { failedActions: [{ target: 'p.d.t', failureReason: 'boom' }] })));
    });

    test('fast at first, then slow, quicker while one is cancelling, and nothing once all have ended', () => {
        assert.strictEqual(nextPollDelay([api('r1', 'RUNNING')], 0), POLL_FAST_MS);
        assert.strictEqual(nextPollDelay([api('r1', 'RUNNING')], 60_000), POLL_SLOW_MS);
        assert.strictEqual(nextPollDelay([api('r1', 'RUNNING'), api('r2', 'CANCELING')], 60_000), POLL_CANCELING_MS);
        assert.strictEqual(nextPollDelay([api('r1', 'SUCCEEDED')], 0), undefined);
    });

    test('a run of yours is followed for half an hour; a watched workflow until it ends, every 5s', () => {
        const mine = api('r1', 'RUNNING');
        const watched = api('r2', 'RUNNING', { executionMode: 'external' });
        assert.deepStrictEqual(polledRuns([mine, watched], POLL_TIMEOUT_MS).map(runKey), ['r2']);
        assert.strictEqual(nextPollDelay([mine], POLL_TIMEOUT_MS), undefined);
        assert.strictEqual(nextPollDelay([watched], POLL_TIMEOUT_MS), POLL_FAST_MS);
    });

    test(`a run whose checks failed ${MAX_POLL_FAILURES} times is left alone`, () => {
        assert.strictEqual(nextPollDelay([api('r1', 'RUNNING')], 0, new Set(['r1'])), undefined);
    });
});

suite('Runs: the list and the run chosen', () => {
    test('lists the runs as given, marks the one chosen, and names a watched workflow by its ID', () => {
        const runs = [api('r3', 'RUNNING', { executionMode: 'external' }), api('r2', 'FAILED', { includedTags: ['daily'] })];
        const html = renderToStaticMarkup(createElement(RunList, { runs, selected: 'r2', onSelect: () => undefined }));
        assert.ok(html.indexOf('r3') < html.indexOf('tag daily'), html);
        assert.ok(/data-run-key="r2"[^>]*aria-current="true"/.test(html), html);
        assert.ok(!/data-run-key="r3"[^>]*aria-current/.test(html), html);
        assert.strictEqual(whatRan(runs[0]), 'r3');
    });

    test('a watched workflow that is followed can be stopped from watching, and is never offered to be cancelled', () => {
        const html = renderToStaticMarkup(createElement(RunDetail, { entry: api('r3', 'RUNNING', { executionMode: 'external' }) }));
        assert.ok(html.includes('Stop watching'), html);
        assert.ok(html.includes('Reading the workflow&#x27;s actions'), html);
        const stopped = renderToStaticMarkup(createElement(RunDetail, { entry: api('r3', 'RUNNING', { executionMode: 'external', unwatched: true }) }));
        assert.ok(!stopped.includes('Stop watching'), stopped);
    });

    test('says why a run is no longer asked about', () => {
        const html = renderToStaticMarkup(createElement(RunDetail, { entry: api('r1', 'RUNNING'), problem: 'Stopped checking it after 5 failed checks: denied' }));
        assert.ok(html.includes('Stopped checking it after 5 failed checks'), html);
        assert.ok(!html.includes('Reading the workflow'), html);
    });
});
