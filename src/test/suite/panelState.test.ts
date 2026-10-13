import * as assert from 'assert';
import { suite, test } from 'mocha';
import type { DataformBlock, HostMessage } from '../../shared/panelContract';
import { EMPTY_DATAFORM_BLOCK, applyMessage, fileOnShow, initialSlices } from '../../shared/panelState';

const block = (fields: Partial<DataformBlock> = {}): DataformBlock => ({ ...EMPTY_DATAFORM_BLOCK, compile: 1, ...fields });
type BlockMessage = Extract<HostMessage, { slice: 'dataform' }>;
const about = (value: DataformBlock, ...touched: NonNullable<BlockMessage['touched']>): BlockMessage => ({ slice: 'dataform', value, touched });

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
        const after = [file, status, bigquery].reduce((slices, message) => applyMessage(slices, message), start);
        assert.deepStrictEqual([after.file, after.compile, after.bigquery], [file.value, status.value, bigquery.value]);
        // A file was named for the first time: nothing of a last file was on the block to take off
        assert.deepStrictEqual(after.dataform, start.dataform);
        const nextFile: HostMessage = { slice: 'file', value: { compile: 2, file: 'definitions/b.sqlx', role: 'not compiled', actions: [] } };
        const later = applyMessage(after, nextFile);
        assert.strictEqual(later.file, nextFile.value);
        assert.strictEqual(later.bigquery, after.bigquery);
    });

    test('a dataform block changes only the fields it is about; the others keep the very values they had', () => {
        const workflowUrls = [{ url: 'https://example.com/1', timestamp: 1, workspace: 'main', includeDependencies: false, includeDependents: false, fullRefresh: false }];
        const first = applyMessage(initialSlices(), about(block({ workflowUrls, compilerOptions: '--vars=a=b' }), 'workflowUrls'));
        assert.strictEqual(first.dataform.workflowUrls, workflowUrls);
        // The block held compiler options too, but this send was not about them
        assert.strictEqual(first.dataform.compilerOptions, '');

        // A later send about another field: it carries a copy of the links, as every message does after crossing
        const copy = JSON.parse(JSON.stringify(workflowUrls));
        const second = applyMessage(first, about(block({ workflowUrls: copy, lastRun: { label: 'orders', detail: '', timestamp: 2, fullRefresh: false, executionMode: 'cli' }, compile: 4 }), 'lastRun'));
        assert.strictEqual(second.dataform.lastRun?.label, 'orders');
        // The polling of workflow statuses keys on this value: it must not look to have arrived again
        assert.strictEqual(second.dataform.workflowUrls, workflowUrls);
        assert.strictEqual(second.dataform.compile, 4);

        // Sent again, it has arrived again
        const third = applyMessage(second, about(block({ workflowUrls: copy }), 'workflowUrls'));
        assert.strictEqual(third.dataform.workflowUrls, copy);
        // A block that does not say what it is about replaces the whole
        const whole = block({ compilerOptions: '--schema-suffix=dev' });
        assert.strictEqual(applyMessage(third, { slice: 'dataform', value: whole }).dataform, whole);
    });

    test('the file the panel names is the one a running compile is for, else the one on show', () => {
        const fileA: HostMessage = { slice: 'file', value: { compile: 1, file: 'definitions/a.sqlx', role: 'actions', actions: [] } };
        const forB: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5, file: 'definitions/b.sqlx' } };
        const done: HostMessage = { slice: 'compile status', value: { compile: 2, status: 'compiled', compiledAt: 9, errors: [] } };
        assert.strictEqual(fileOnShow(initialSlices()), undefined);
        const onA = applyMessage(initialSlices(), fileA);
        assert.strictEqual(fileOnShow(onA), 'definitions/a.sqlx');
        // A compile for another file: it is named at once, though the actions on show are still the last file's
        const compilingB = applyMessage(onA, forB);
        assert.deepStrictEqual([fileOnShow(compilingB), compilingB.file], ['definitions/b.sqlx', fileA.value]);
        // The compile is over and the file's slice has not come: the name follows what is on show
        assert.strictEqual(fileOnShow(applyMessage(compilingB, done)), 'definitions/a.sqlx');
        // A slice for no file names none
        const none: HostMessage = { slice: 'file', value: { compile: 2, file: '', role: 'not compiled', actions: [] } };
        assert.strictEqual(fileOnShow(applyMessage(onA, none)), undefined);
    });

    test('when the file the panel names changes, what belonged to the last one is taken off the block', () => {
        const deferral = { status: 'error' as const, message: 'no prod' };
        const graphs = [{ target: { database: 'p', schema: 'ds', name: 'g' } }] as unknown as DataformBlock['propertyGraphs'];
        const lineage = { dependencies: ['p.ds.report'] };
        const fileA: HostMessage = { slice: 'file', value: { compile: 1, file: 'definitions/a.sqlx', role: 'actions', actions: [] } };
        const ofA = about(block({ deferral, leftoverProxies: ['p.ds.t'], propertyGraphs: graphs, propertyGraphValidations: [], compilerOptions: '--vars=a=b', lineage }), 'deferral', 'leftoverProxies', 'propertyGraphs', 'propertyGraphValidations', 'compilerOptions', 'lineage');
        const shown = applyMessage(applyMessage(initialSlices(), fileA), ofA);
        assert.strictEqual(shown.dataform.deferral, deferral);

        // The same file again, a compile for it, or a message that names none: the block is left alone
        assert.strictEqual(applyMessage(shown, { slice: 'file', value: { ...fileA.value, compile: 2 } }).dataform, shown.dataform);
        assert.strictEqual(applyMessage(shown, { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5, file: 'definitions/a.sqlx' } }).dataform, shown.dataform);
        assert.strictEqual(applyMessage(shown, { slice: 'file', value: { compile: 2, file: '', role: 'not compiled', actions: [] } }).dataform, shown.dataform);
        assert.strictEqual(applyMessage(shown, { rerunAborted: true }), shown);

        // Another file's slice, or a compile started for another file
        for (const message of [
            { slice: 'file', value: { compile: 1, file: 'definitions/b.sqlx', role: 'actions', actions: [] } },
            { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5, file: 'definitions/b.sqlx' } },
        ] as HostMessage[]) {
            const next = applyMessage(shown, message);
            assert.deepStrictEqual([next.dataform.deferral, next.dataform.leftoverProxies, next.dataform.propertyGraphs, next.dataform.propertyGraphValidations], [null, null, null, null], message.slice);
            // What is the Project's stays, and so does what the host clears itself
            assert.deepStrictEqual([next.dataform.compilerOptions, next.dataform.lineage], ['--vars=a=b', lineage]);
        }
    });

    test('the last compile that finished is kept while the next one runs', () => {
        const failed: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'failed', errors: [{ message: 'boom' }] } };
        const compiling: HostMessage = { slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 5 } };
        const compiled: HostMessage = { slice: 'compile status', value: { compile: 2, status: 'compiled', compiledAt: 9, errors: [] } };
        const first = applyMessage(initialSlices(), failed);
        assert.deepStrictEqual([first.compile, first.settled], [failed.value, failed.value]);
        const running = applyMessage(first, compiling);
        assert.deepStrictEqual([running.compile, running.settled], [compiling.value, failed.value]);
        const done = applyMessage(running, compiled);
        assert.deepStrictEqual([done.compile, done.settled], [compiled.value, compiled.value]);
    });

    test('the host can take the Project back, so that the next file is not drawn as the last Project\'s', () => {
        const project: HostMessage = { slice: 'project', value: { compile: 1, root: '/work/shop', backend: 'dbt', parts: { runner: true, changes: false }, tags: [] } };
        const shown = applyMessage(initialSlices(), project);
        assert.strictEqual(shown.project?.backend, 'dbt');
        const left = applyMessage(shown, { slice: 'project', value: null });
        assert.strictEqual(left.project, undefined);
        assert.strictEqual(left.dataform, shown.dataform);
    });

    test('the last run is kept', () => {
        const run: HostMessage = { slice: 'run status', value: { compile: 2, lastRun: { request: { actions: ['p.d.t'], tags: [], includeDependencies: false, includeDependents: false, fullRefresh: false }, command: 'dbt build --select shop.t --target dev', startedAt: 9 } } };
        assert.deepStrictEqual(applyMessage(initialSlices(), run).run, run.value);
    });

    test('anything that is not a message is left alone', () => {
        const slices = initialSlices();
        assert.strictEqual(applyMessage(slices, null), slices);
        assert.strictEqual(applyMessage(slices, 'text'), slices);
        assert.strictEqual(applyMessage(slices, { slice: 'unknown', value: {} }), slices);
    });
});
