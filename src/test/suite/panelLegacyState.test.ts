import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { CompileStatus, DataformBlock, FileSlice, HostMessage } from '../../shared/panelContract';
import { MIGRATED_DATAFORM_FIELDS, isSliceMessage, legacyStateFromSlice, toLegacyState } from '../../shared/panelLegacyState';

const block = (fields: Partial<DataformBlock> = {}): DataformBlock => ({
    compile: 1, compilerOptions: '', compilationMode: 'cli', snoozeEndTime: null, deferral: null, leftoverProxies: null,
    lastRun: null, propertyGraphs: null, propertyGraphValidations: null, propertyGraphElementSchemas: {}, ...fields,
});

const pick = (flat: Record<string, unknown>) => [flat.errorType, flat.errorMessage];

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

    test('the Compilation Mode keeps the flat name the setting gave it', () => {
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ compilationMode: 'api', compilerOptions: '--schema-suffix=dev', dataformCoreVersion: '3.0.39' }), touched: ['compilationMode', 'compilerOptions', 'dataformCoreVersion'] });
        assert.deepStrictEqual(flat, { compilationBackend: 'api', compilerOptions: '--schema-suffix=dev', dataformCoreVersion: '3.0.39' });
    });

    test('a field not yet moved is not passed on, so its placeholder cannot overwrite what was sent the old way', () => {
        const flat = legacyStateFromSlice({ slice: 'dataform', value: block({ compilerOptions: '', propertyGraphElementSchemas: {} }) });
        for (const field of ['propertyGraphElementSchemas', 'compile']) {
            assert.ok(!(field in flat), field);
        }
    });

    test('the compile status gives the compiling flag, and the other flat fields only where it has something to say of them', () => {
        const flat = (value: CompileStatus) => legacyStateFromSlice({ slice: 'compile status', value });
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiling', showingPrevious: false, startedAt: 1 }), { recompiling: true });
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiled', compiledAt: 1, errors: [] }), { recompiling: false });
        assert.deepStrictEqual(flat({ compile: 2, status: 'tool not found', tool: 'dataform', lookedIn: [] }), { recompiling: false, missingExecutables: ['dataform'], errorType: 'MISSING_EXECUTABLE' });
        // A compile that left errors: the flat state names them its own way, with the source lines the tool printed
        const error = { message: 'Unexpected token', fileName: 'definitions/a.sqlx', line: 10, sourceContext: '  oops\n  ^^^^' };
        assert.deepStrictEqual(flat({ compile: 2, status: 'compiled', compiledAt: 1, errors: [error] }), {
            recompiling: false,
            errorType: 'COMPILATION_ERROR',
            errorMessage: null,
            compilationErrors: [{ error: 'Unexpected token', fileName: 'definitions/a.sqlx', lineNumber: 10, sourceContext: '  oops\n  ^^^^' }],
        });
        assert.deepStrictEqual(flat({ compile: 2, status: 'failed', errors: [{ message: 'dataform: command not found' }] }).compilationErrors, [
            { error: 'dataform: command not found', fileName: '', lineNumber: undefined, sourceContext: undefined },
        ]);
    });

    test('the flat error is the compile\'s when the compile is why there is nothing to show, and the file\'s otherwise', () => {
        const status = (value: CompileStatus) => legacyStateFromSlice({ slice: 'compile status', value });
        const file = (value: Partial<FileSlice>) => legacyStateFromSlice({ slice: 'file', value: { compile: 2, file: 'definitions/a.sqlx', role: 'not compiled', actions: [], ...value } });
        const outside = status({ compile: 2, status: 'no project' });
        assert.strictEqual(outside.errorType, 'NOT_A_DATAFORM_WORKSPACE');
        assert.ok(String(outside.errorMessage).startsWith('This file is not in a Dataform project'));
        // A compile with nothing wrong says nothing of the error: the file slice after it does
        assert.ok(!('errorType' in status({ compile: 2, status: 'compiled', compiledAt: 1, errors: [] })));
        assert.ok(!('errorType' in status({ compile: 2, status: 'failed', errors: [] })));

        // Sent after a status that gave the error: it must leave it standing
        const afterCompileError = file({});
        assert.ok(!('errorType' in afterCompileError) && !('errorMessage' in afterCompileError));
        // The file's own problems, by the names the flat state has for them
        assert.deepStrictEqual(pick(file({ problem: { kind: 'unsupported file type', message: 'File type not supported' } })), ['UNSUPPORTED_FILE_TYPE', 'File type not supported']);
        assert.deepStrictEqual(pick(file({ problem: { kind: 'no action' } })), ['FILE_NOT_FOUND', null]);
        assert.deepStrictEqual(pick(file({ problem: { kind: 'no sql', message: 'Query could not be determined' } })), ['QUERY_META_ERROR', 'Query could not be determined']);
        assert.deepStrictEqual(pick(file({ problem: { kind: 'other', message: 'Unable to retrieve metadata' } })), ['COMPILATION_ERROR', 'Unable to retrieve metadata']);
        // A file with something to show, or known to have nothing, clears the error
        for (const role of ['actions', 'helper', 'project settings'] as const) {
            assert.deepStrictEqual(pick(file({ role })), [null, null], role);
        }
    });

    test('defer to prod and the property graphs arrive through the block, each only when the send is about it', () => {
        const deferral = { status: 'error' as const, message: 'Retry failed' };
        const value = block({ deferral, deferToProd: { enabled: true, available: true }, leftoverProxies: ['p.ds.t'], propertyGraphs: [], propertyGraphValidations: [] });
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['deferral'] }), { deferral });
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['deferToProd', 'leftoverProxies'] }), { deferToProd: { enabled: true, available: true }, leftoverProxies: ['p.ds.t'] });
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['propertyGraphs', 'propertyGraphValidations'] }), { propertyGraphs: [], propertyGraphValidations: [] });
        // The flat state clears a file's graphs and deferral with null
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value: block(), touched: ['propertyGraphs', 'deferral', 'leftoverProxies'] }), { propertyGraphs: null, deferral: null, leftoverProxies: null });
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
        assert.deepStrictEqual(toLegacyState({ slice: 'dataform', value, touched: ['propertyGraphElementSchemas'] }), {});
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
