import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { DataformBlock, HostMessage } from '../../shared/panelContract';
import { MIGRATED_DATAFORM_FIELDS, isSliceMessage, legacyStateFromSlice, toLegacyState } from '../../shared/panelLegacyState';

const block = (fields: Partial<DataformBlock> = {}): DataformBlock => ({
    compile: 1, compilerOptions: '', compilationMode: 'cli', snoozeEndTime: null, deferral: null, leftoverProxies: null,
    lastRun: null, propertyGraphs: null, propertyGraphValidations: null, propertyGraphElementSchemas: {}, ...fields,
});

suite('panel: slices as the flat state the components still read', () => {
    test('a dataform block gives the flat fields that have been moved to it, and only those', () => {
        const lastRun = { label: 'orders', detail: 'with dependencies', timestamp: 5, fullRefresh: false, executionMode: 'cli' as const };
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ lastRun, workflowUrls: [], changedActions: { status: 'idle' }, columnImpact: { file: 'definitions/orders.sqlx', changed: 2 } }) });
        assert.deepStrictEqual(flat, {
            lastRun,
            workflowUrls: [],
            changedActions: { status: 'idle' },
            apiRunGitState: undefined,
            columnImpact: { relativeFilePath: 'definitions/orders.sqlx', changed: 2 },
        });
        // Each moved field has its flat name here; `columnImpact` is the only one that changes inside
        assert.deepStrictEqual(Object.keys(flat).sort(), [...MIGRATED_DATAFORM_FIELDS].sort());
    });

    test('a field not yet moved is not passed on, so its placeholder cannot overwrite what was sent the old way', () => {
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ compilerOptions: '', deferral: null, propertyGraphs: null }) });
        for (const field of ['compilerOptions', 'compilationMode', 'deferral', 'leftoverProxies', 'propertyGraphs', 'snoozeEndTime', 'compile']) {
            assert.ok(!(field in flat), field);
        }
    });

    test('a message sent the old way passes through untouched; a slice no component reads yet adds nothing', () => {
        const flatMessage = { recompiling: true, relativeFilePath: 'definitions/orders.sqlx' };
        assert.strictEqual(isSliceMessage(flatMessage), false);
        assert.strictEqual(toLegacyState(flatMessage), flatMessage);
        const status: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'no project' } };
        assert.strictEqual(isSliceMessage(status), true);
        assert.deepStrictEqual(toLegacyState(status as unknown as Record<string, unknown>), {});
    });

    test('a send carries only the fields it is about, so nothing else looks to have arrived', () => {
        const value = block({ lastRun: null, workflowUrls: [], changedActions: { status: 'idle' } });
        // A refresh of the workflow links: the polling of workflow statuses must see them arrive, and the last run card must not
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['workflowUrls'] }), { workflowUrls: [] });
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['changedActions', 'lastRun'] }), { changedActions: { status: 'idle' }, lastRun: null });
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: [] }), {});
        // A field that has not been moved is not passed on even when a send names it
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['compilerOptions'] }), {});
    });

    test('the same links sent twice arrive twice, as two flat messages did', () => {
        const arrivals: unknown[] = [];
        const value = block({ workflowUrls: [] });
        for (let refresh = 0; refresh < 2; refresh++) {
            // What posting does: the panel gets a copy
            const received = JSON.parse(JSON.stringify({ slice: 'dataform', value, touched: ['workflowUrls'] }));
            arrivals.push(toLegacyState(received).workflowUrls);
        }
        assert.strictEqual(arrivals.length, 2);
        assert.notStrictEqual(arrivals[0], arrivals[1]);
        assert.deepStrictEqual(arrivals[0], arrivals[1]);
    });
});
