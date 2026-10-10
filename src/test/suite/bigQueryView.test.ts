import * as assert from 'assert';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { DryRunResult, toDryRunResult } from '../../bigquery/dryRunService';
import { bigQuerySlice, fileSlice } from '../../panel/slices';
import { dryRunScripts } from '../../shared/compiledGraph';
import type { BigQuerySlice, CompileStatus, FileSlice, HostMessage } from '../../shared/panelContract';
import { PanelSlices, applyMessage, initialSlices } from '../../shared/panelState';
import type { DataformCompiledJson } from '../../types';
import { bigQueryView, columnsOnShow } from '../../../webviews/preview_compiled/utils/bigQueryView';

const dataform = new DataformBackend(async () => ({}));
const target = (name: string) => ({ database: 'p', schema: 'ds', name });
const graph = buildDataformGraph({
    tables: [{ type: 'table', target: target('orders'), fileName: 'definitions/orders.sqlx', query: 'select 1 as id', actionDescriptor: { columns: [{ path: ['id'], description: 'The order' }] } }],
    assertions: [{ target: target('orders_check'), fileName: 'definitions/orders.sqlx', query: 'select 2 as n' }],
} as unknown as DataformCompiledJson);
const file = fileSlice(graph, dataform, 'definitions/orders.sqlx', 1);
const helper = fileSlice(graph, dataform, 'includes/params.js', 1);
const answer = (id: string, response: object, compile = 1): DryRunResult => toDryRunResult(graph.actions[id], dryRunScripts(graph.actions[id])[0], compile, response as any);
const ok = (fields?: object[]) => ({ error: { hasError: false, message: '' }, statistics: { totalBytesProcessed: 1024, cost: { currency: 'USD', value: 0.01 }, totalBytesProcessedAccuracy: 'PRECISE' }, ...(fields ? { schema: { fields } } : {}) });
const failed = { error: { hasError: true, message: 'Not found: Table p.ds.orders', location: { line: 1, column: 8 } } };
const results = [answer('p.ds.orders', ok([{ name: 'id', type: 'INT64' }])), answer('p.ds.orders_check', failed)];
const tables = { 'p.ds.orders': { lastModified: '2026-10-06 09:00', modifiedToday: false } };
const answered = bigQuerySlice({ results, tables }, 1);
const out = bigQuerySlice({ results: [], dryRunning: [{ action: 'p.ds.orders', script: 'query', incremental: false }] }, 1);
const compiling: CompileStatus = { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 1 };
/** The slices after the host's messages, as the panel keeps them */
const after = (...messages: HostMessage[]): PanelSlices => messages.reduce((slices, message) => applyMessage(slices, message), initialSlices());
const aFile = (value: FileSlice): HostMessage => ({ slice: 'file', value });
const bigquery = (value: BigQuerySlice): HostMessage => ({ slice: 'bigquery', value });

suite('panel: what BigQuery said of the actions on show', () => {
    test('before the host has said anything there is nothing', () => {
        const view = bigQueryView(initialSlices());
        assert.deepStrictEqual([view.dryRunning, view.currencySymbol, view.stats, view.errors, view.queries, view.lastUpdates], [false, '$', {}, {}, {}, []]);
        assert.strictEqual(columnsOnShow(undefined), null);
    });

    test('results are found by the name of each action, and the table times by its position', () => {
        const view = bigQueryView(after(aFile(file), bigquery(answered)));
        assert.deepStrictEqual(view.stats, { 'p.ds.orders': '1.00 KiB $0.010' });
        assert.deepStrictEqual(view.errors, { 'p.ds.orders_check': { message: 'Not found: Table p.ds.orders', location: { line: 1, column: 8 } } });
        assert.deepStrictEqual(view.queries, { 'p.ds.orders': 'select 1 as id', 'p.ds.orders_check': 'select 2 as n' });
        assert.deepStrictEqual(view.lastUpdates, [{ lastModifiedTime: '2026-10-06 09:00', modelWasUpdatedToday: false, error: { message: undefined } }, undefined]);
        assert.strictEqual(view.dryRunning, false);
    });

    test('while a compile runs, costs, errors and table times are not shown; the SQL that was dry-run stays', () => {
        const view = bigQueryView(after(aFile(file), bigquery(answered), { slice: 'compile status', value: compiling }));
        assert.deepStrictEqual([view.stats, view.errors, view.lastUpdates], [{}, {}, []]);
        assert.deepStrictEqual(Object.keys(view.queries), ['p.ds.orders', 'p.ds.orders_check']);
    });

    test('a slice of another compile than the file\'s says nothing of the file', () => {
        const recompiled = fileSlice(graph, dataform, 'definitions/orders.sqlx', 2);
        const view = bigQueryView(after(bigquery(answered), aFile(recompiled)));
        assert.deepStrictEqual([view.stats, view.errors, view.queries, view.lastUpdates], [{}, {}, {}, [undefined, undefined]]);
    });

    test('the columns of the last dry runs stay while the next are out, and when none was made', () => {
        const shown = after(aFile(file), bigquery(answered));
        const columns = columnsOnShow(shown.columns);
        assert.deepStrictEqual(columns, { fields: [{ name: 'id', type: 'INT64', description: 'The order' }] });
        // The same results give the same object, so the Schema tab does not work its rows out again
        assert.strictEqual(columnsOnShow(shown.columns), columns);

        const next = applyMessage(shown, bigquery(out));
        assert.strictEqual(bigQueryView(next).dryRunning, true);
        assert.strictEqual(columnsOnShow(next.columns), columns);
        // No dry run was made, e.g. the compile was already out of date
        assert.strictEqual(columnsOnShow(applyMessage(next, bigquery(bigQuerySlice({ results: [] }, 1))).columns), columns);
        // New results: new columns
        const again = applyMessage(next, bigquery(bigQuerySlice({ results: [answer('p.ds.orders', ok([{ name: 'total', type: 'NUMERIC' }]))] }, 1)));
        assert.deepStrictEqual(columnsOnShow(again.columns), { fields: [{ name: 'total', type: 'NUMERIC' }] });
    });

    test('a file with no action to show has no columns, and a dry run that gave none has one empty column', () => {
        const toHelper = after(aFile(file), bigquery(answered), aFile(helper), bigquery(bigQuerySlice({ results: [] }, 1)));
        assert.strictEqual(columnsOnShow(toHelper.columns), null);
        const noColumns = after(aFile(file), bigquery(bigQuerySlice({ results: [answer('p.ds.orders', failed)] }, 1)));
        assert.deepStrictEqual(columnsOnShow(noColumns.columns), { fields: [{ name: '', type: '' }] });
        // Results that arrive before any file are for nothing on show
        assert.strictEqual(after(bigquery(answered)).columns, undefined);
    });
});
