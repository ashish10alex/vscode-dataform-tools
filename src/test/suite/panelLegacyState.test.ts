import * as assert from 'assert';
import { suite, test } from 'mocha';
import { SliceSender } from '../../panel/sliceSender';
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

    test('the block is sent once per change, and whole again after a render', () => {
        const merged: Record<string, unknown> = {};
        const sender = new SliceSender((message) => Object.assign(merged, toLegacyState(message as unknown as Record<string, unknown>)));
        let state = block();
        const update = (fields: Partial<DataformBlock>) => {
            state = { ...state, ...fields };
            return sender.send('dataform', state);
        };
        assert.strictEqual(update({ changedActions: { status: 'computing' } }), true);
        assert.strictEqual(update({ changedActions: { status: 'computing' } }), false);
        assert.strictEqual(update({ workflowUrls: [] }), true);
        assert.deepStrictEqual([merged.changedActions, merged.workflowUrls, merged.lastRun], [{ status: 'computing' }, [], null]);
        // A render starts from nothing known, so the same block goes again
        sender.reset();
        assert.strictEqual(update({}), true);
    });
});
