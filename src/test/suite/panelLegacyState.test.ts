import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { CompileStatus, DataformBlock, HostMessage } from '../../shared/panelContract';
import { MIGRATED_DATAFORM_FIELDS, isSliceMessage, legacyStateFromSlice, toLegacyState } from '../../shared/panelLegacyState';

const block = (fields: Partial<DataformBlock> = {}): DataformBlock => ({
    compile: 1, compilerOptions: '', compilationMode: 'cli', snoozeEndTime: null, deferral: null, leftoverProxies: null,
    lastRun: null, propertyGraphs: null, propertyGraphValidations: null, propertyGraphElementSchemas: {}, ...fields,
});

suite('panel: slices as the flat state the components still read', () => {
    test('a dataform block gives the flat fields that have been moved to it, and only those', () => {
        const lastRun = { label: 'orders', detail: 'with dependencies', timestamp: 5, fullRefresh: false, executionMode: 'cli' as const };
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ lastRun, workflowUrls: [], changedActions: { status: 'idle' }, columnImpact: { file: 'definitions/orders.sqlx', changed: 2 } }) });
        assert.deepStrictEqual([flat.lastRun, flat.workflowUrls, flat.changedActions, flat.apiRunGitState], [lastRun, [], { status: 'idle' }, undefined]);
        assert.deepStrictEqual(flat.columnImpact, { relativeFilePath: 'definitions/orders.sqlx', changed: 2 });
        // Every moved field gives exactly one flat field
        assert.strictEqual(Object.keys(flat).length, MIGRATED_DATAFORM_FIELDS.length);
    });

    test('the fields of part 2 keep their flat names and their way of saying "none"', () => {
        const flat = legacyStateFromSlice({
            slice: 'dataform',
            value: block({ packageJson: { name: 'shop' }, possibleResolutions: ['run dataform install'], snoozeEndTime: 99, tagCostEstimate: { rows: [{ targetName: 't' }], error: undefined } }),
        });
        assert.deepStrictEqual(flat.packageJsonContent, { name: 'shop' });
        // The flat state clears the project config with null, not by leaving it out
        assert.strictEqual(flat.projectConfig, null);
        assert.deepStrictEqual(flat.possibleResolutions, ['run dataform install']);
        assert.strictEqual(flat.snoozeEndTime, 99);
        assert.deepStrictEqual(flat.tagDryRunStatsMeta, { tagDryRunStatsList: [{ targetName: 't' }], error: undefined });
        assert.strictEqual(legacyStateFromSlice({ slice: 'dataform', value: block() }).tagDryRunStatsMeta, undefined);
    });

    test('a field not yet moved is not passed on, so its placeholder cannot overwrite what was sent the old way', () => {
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ compilerOptions: '', deferral: null, propertyGraphs: null }) });
        for (const field of ['compilerOptions', 'compilationMode', 'compilationBackend', 'deferral', 'leftoverProxies', 'propertyGraphs', 'dataformCoreVersion', 'compile']) {
            assert.ok(!(field in flat), field);
        }
    });

    test('the compile status gives the compiling flag, and the other flat fields only where it has something to say of them', () => {
        const flat = (value: CompileStatus) => legacyStateFromSlice({ slice: 'compile status', value });
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiling', showingPrevious: false, startedAt: 1 }), { recompiling: true });
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiled', compiledAt: 1, errors: [] }), { recompiling: false });
        assert.deepStrictEqual(flat({ compile: 2, status: 'no project' }), { recompiling: false });
        assert.deepStrictEqual(flat({ compile: 2, status: 'tool not found', tool: 'dataform', lookedIn: [] }), { recompiling: false, missingExecutables: ['dataform'] });
        // A compile that left errors: the flat state names them its own way, with the source lines the tool printed
        const error = { message: 'Unexpected token', fileName: 'definitions/a.sqlx', line: 10, sourceContext: '  oops\n  ^^^^' };
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiled', compiledAt: 1, errors: [error] }), {
            recompiling: false,
            compilationErrors: [{ error: 'Unexpected token', fileName: 'definitions/a.sqlx', lineNumber: 10, sourceContext: '  oops\n  ^^^^' }],
        });
        assert.deepStrictEqual(flat({ compile: 2, status: 'failed', errors: [{ message: 'dataform: command not found' }] }).compilationErrors, [
            { error: 'dataform: command not found', fileName: '', lineNumber: undefined, sourceContext: undefined },
        ]);
        // What the file itself has wrong is not the compile's to say
        assert.ok(!('errorType' in flat({ compile: 2, status: 'failed', errors: [error] })));
    });

    test('a message sent the old way passes through untouched; a slice no component reads yet adds nothing', () => {
        const flatMessage = { recompiling: true, relativeFilePath: 'definitions/orders.sqlx' };
        assert.strictEqual(isSliceMessage(flatMessage), false);
        assert.strictEqual(toLegacyState(flatMessage), flatMessage);
        const unread: HostMessage = { slice: 'run status', value: { compile: 1 } };
        assert.strictEqual(isSliceMessage(unread), true);
        assert.deepStrictEqual(toLegacyState(unread as unknown as Record<string, unknown>), {});
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
