import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { DataformBlock, HostMessage } from '../../shared/panelContract';
import type { DataformBlockMessage } from '../../shared/panelLegacyState';
import { EMPTY_DATAFORM_BLOCK, applyMessage, initialSlices } from '../../shared/panelState';

const block = (fields: Partial<DataformBlock> = {}): DataformBlock => ({ ...EMPTY_DATAFORM_BLOCK, compile: 1, ...fields });
const about = (value: DataformBlock, ...touched: DataformBlockMessage['touched']): DataformBlockMessage => ({ slice: 'dataform', value, touched });

suite('panel: the slices the panel keeps', () => {
    test('it starts with an empty dataform block, or with the slices of the first page', () => {
        assert.strictEqual(initialSlices().dataform, EMPTY_DATAFORM_BLOCK);
        assert.deepStrictEqual(Object.keys(initialSlices()), ['dataform']);
        const baked = block({ compilerOptions: '--vars=a=b', compilationMode: 'api' });
        assert.strictEqual(initialSlices({ dataform: baked }).dataform, baked);
    });

    test('each slice replaces the last of its name and leaves the others as they were', () => {
        const start = initialSlices();
        const file: HostMessage = { slice: 'file', value: { compile: 1, file: 'definitions/a.sqlx', role: 'helper', actions: [] } };
        const status: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5 } };
        const bigquery: HostMessage = { slice: 'bigquery', value: { compile: 1, results: [], dryRunning: [], tables: {}, currencySymbol: '£' } };
        const after = [file, status, bigquery].reduce((slices, message) => applyMessage(slices, message, undefined), start);
        assert.deepStrictEqual([after.file, after.compile, after.bigquery], [file.value, status.value, bigquery.value]);
        assert.strictEqual(after.dataform, start.dataform);
        const nextFile: HostMessage = { slice: 'file', value: { compile: 2, file: 'definitions/b.sqlx', role: 'not compiled', actions: [] } };
        const later = applyMessage(after, nextFile, undefined);
        assert.strictEqual(later.file, nextFile.value);
        assert.strictEqual(later.bigquery, after.bigquery);
    });

    test('a dataform block changes only the fields it is about; the others keep the very values they had', () => {
        const workflowUrls = [{ url: 'https://example.com/1', timestamp: 1, workspace: 'main', includeDependencies: false, includeDependents: false, fullRefresh: false }];
        const first = applyMessage(initialSlices(), about(block({ workflowUrls, compilerOptions: '--vars=a=b' }), 'workflowUrls'), undefined);
        assert.strictEqual(first.dataform.workflowUrls, workflowUrls);
        // The block held compiler options too, but this send was not about them
        assert.strictEqual(first.dataform.compilerOptions, '');

        // A later send about another field: it carries a copy of the links, as every message does after crossing
        const copy = JSON.parse(JSON.stringify(workflowUrls));
        const second = applyMessage(first, about(block({ workflowUrls: copy, lastRun: { label: 'orders', detail: '', timestamp: 2, fullRefresh: false, executionMode: 'cli' }, compile: 4 }), 'lastRun'), undefined);
        assert.strictEqual(second.dataform.lastRun?.label, 'orders');
        // The polling of workflow statuses keys on this value: it must not look to have arrived again
        assert.strictEqual(second.dataform.workflowUrls, workflowUrls);
        assert.strictEqual(second.dataform.compile, 4);

        // Sent again, it has arrived again
        const third = applyMessage(second, about(block({ workflowUrls: copy }), 'workflowUrls'), undefined);
        assert.strictEqual(third.dataform.workflowUrls, copy);
        // A block that does not say what it is about replaces the whole
        const whole = block({ compilerOptions: '--schema-suffix=dev' });
        assert.strictEqual(applyMessage(third, { slice: 'dataform', value: whole }, undefined).dataform, whole);
    });

    test('a flat message that names another file takes what belonged to the last one off the block', () => {
        const deferral = { status: 'error' as const, message: 'no prod' };
        const graphs = [{ target: { database: 'p', schema: 'ds', name: 'g' } }] as unknown as DataformBlock['propertyGraphs'];
        const shown = applyMessage(initialSlices(), about(block({ deferral, leftoverProxies: ['p.ds.t'], propertyGraphs: graphs, propertyGraphValidations: [], compilerOptions: '--vars=a=b' }), 'deferral', 'leftoverProxies', 'propertyGraphs', 'propertyGraphValidations', 'compilerOptions'), undefined);
        assert.strictEqual(shown.dataform.deferral, deferral);

        // The same file again, or a message that names none: nothing changes
        assert.strictEqual(applyMessage(shown, { relativeFilePath: 'definitions/a.sqlx' }, 'definitions/a.sqlx'), shown);
        assert.strictEqual(applyMessage(shown, { dataformTags: [] }, 'definitions/a.sqlx'), shown);

        const next = applyMessage(shown, { relativeFilePath: 'definitions/b.sqlx' }, 'definitions/a.sqlx');
        assert.deepStrictEqual([next.dataform.deferral, next.dataform.leftoverProxies, next.dataform.propertyGraphs, next.dataform.propertyGraphValidations], [null, null, null, null]);
        // What is the Project's stays
        assert.strictEqual(next.dataform.compilerOptions, '--vars=a=b');
    });

    test('the last compile that finished is kept while the next one runs', () => {
        const failed: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'failed', errors: [{ message: 'boom' }] } };
        const compiling: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5 } };
        const compiled: HostMessage = { slice: 'compile status', value: { compile: 2, status: 'compiled', compiledAt: 9, errors: [] } };
        const first = applyMessage(initialSlices(), failed, undefined);
        assert.deepStrictEqual([first.compile, first.settled], [failed.value, failed.value]);
        const running = applyMessage(first, compiling, undefined);
        assert.deepStrictEqual([running.compile, running.settled], [compiling.value, failed.value]);
        const done = applyMessage(running, compiled, undefined);
        assert.deepStrictEqual([done.compile, done.settled], [compiled.value, compiled.value]);
    });

    test('anything that is not a message is left alone', () => {
        const slices = initialSlices();
        assert.strictEqual(applyMessage(slices, null, undefined), slices);
        assert.strictEqual(applyMessage(slices, 'text', undefined), slices);
        assert.strictEqual(applyMessage(slices, { slice: 'unknown', value: {} }, undefined), slices);
    });
});
