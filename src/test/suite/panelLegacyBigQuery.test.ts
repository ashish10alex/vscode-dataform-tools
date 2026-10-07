import * as assert from 'assert';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { bigQuerySlice, fileSlice } from '../../panel/slices';
import { madeUpTarget, targetId } from '../../shared/compiledGraph';
import type { HostMessage } from '../../shared/panelContract';
import { MIGRATED_BIGQUERY_FIELDS, legacyStateFromBigQuerySlice } from '../../shared/panelLegacyBigQuery';
import { legacyStateReader, toLegacyState } from '../../shared/panelLegacyState';
import type { DataformCompiledJson } from '../../types';

const dataform = new DataformBackend(async () => ({}));
const target = (name: string) => ({ database: 'p', schema: 'ds', name });
// A JavaScript file whose actions the flat state lists in another order than the slice: assertions before operations
const graph = buildDataformGraph({
    tables: [{ type: 'view', target: target('v'), fileName: 'definitions/mixed.js', query: 'select 1' }],
    operations: [{ target: target('op'), fileName: 'definitions/mixed.js', queries: ['select 2'] }],
    assertions: [{ target: target('check'), fileName: 'definitions/mixed.js', query: 'select 3' }],
    tests: [{ name: 'v_total', fileName: 'definitions/mixed.js', testQuery: 'select 4', expectedOutputQuery: 'select 5' }],
} as unknown as DataformCompiledJson);
const file = fileSlice(graph, dataform, 'definitions/mixed.js', 1);
const asMessage = (message: HostMessage) => message as unknown as Record<string, unknown>;

suite('panel: the bigquery slice as the flat fields the components still read', () => {
    test('dry runs that are out are the flat spinner; none out stops it', () => {
        const out = bigQuerySlice({ results: [], dryRunning: [{ action: 'p.ds.v', script: 'query', incremental: false }] }, 1);
        assert.deepStrictEqual(toLegacyState(asMessage({ slice: 'bigquery', value: out })), { dryRunning: true, currencySymbol: '$' });
        const back = bigQuerySlice({ results: [], currencySymbol: '£' }, 1);
        assert.deepStrictEqual(toLegacyState(asMessage({ slice: 'bigquery', value: back })), { dryRunning: false, currencySymbol: '£' });
    });

    test('what is known of the tables is listed by the position of each action in the flat state', () => {
        const tables = {
            'p.ds.v': { lastModified: '2026-10-06 09:00', modifiedToday: false },
            'p.ds.op': { error: 'Could not retrieve lastModifiedTime for p.ds.op' },
            'p.ds.check': { lastModified: '2026-10-07 08:00', modifiedToday: true },
        };
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results: [], tables }, 1), file);
        assert.deepStrictEqual(Object.keys(flat).sort(), [...MIGRATED_BIGQUERY_FIELDS].sort());
        assert.deepStrictEqual(file.actions.map((action) => action.id), ['p.ds.v', 'p.ds.op', 'p.ds.check', targetId(madeUpTarget('unit test', 'v_total'))]);
        // The flat state's order: the view, the assertion, the operation, and a unit test, which builds no table
        assert.deepStrictEqual(flat.modelsLastUpdateTimesMeta, [
            { lastModifiedTime: '2026-10-06 09:00', modelWasUpdatedToday: false, error: { message: undefined } },
            { lastModifiedTime: '2026-10-07 08:00', modelWasUpdatedToday: true, error: { message: undefined } },
            { lastModifiedTime: undefined, modelWasUpdatedToday: undefined, error: { message: 'Could not retrieve lastModifiedTime for p.ds.op' } },
            null,
        ]);
    });

    test('while the dry runs are out nothing is known of the tables, and the last file\'s times are not left standing', () => {
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results: [], dryRunning: [{ action: 'p.ds.v', script: 'query', incremental: false }] }, 1), file);
        assert.deepStrictEqual(flat.modelsLastUpdateTimesMeta, [undefined, undefined, undefined, null]);
    });

    test('a file with no action to show says nothing of tables', () => {
        const helper = fileSlice(graph, dataform, 'includes/params.js', 1);
        assert.ok(!('modelsLastUpdateTimesMeta' in legacyStateFromBigQuerySlice(bigQuerySlice({ results: [] }, 1), helper)));
        assert.ok(!('modelsLastUpdateTimesMeta' in legacyStateFromBigQuerySlice(bigQuerySlice({ results: [] }, 1), undefined)));
    });

    test('the dry-run results are not passed on yet: the flat maps still arrive the old way', () => {
        const result = { action: 'p.ds.v', script: 'query', incremental: false, sections: ['query'], compile: 1, sql: 'select 1', bytes: 10 };
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results: [result] }, 1), file);
        assert.ok(Object.keys(flat).every((field) => !field.startsWith('dryRunStat') && !field.startsWith('dryRunErrors') && field !== 'compiledQuerySchema'));
    });

    test('a reader gives the bigquery slice the actions of the file slice before it', () => {
        const read = legacyStateReader();
        const tables = { 'p.ds.v': { lastModified: 'today', modifiedToday: true } };
        const slice = asMessage({ slice: 'bigquery', value: bigQuerySlice({ results: [], tables }, 1) });
        // Before any file slice there are no actions to list
        assert.ok(!('modelsLastUpdateTimesMeta' in read(slice)));
        assert.ok('models' in read(asMessage({ slice: 'file', value: file })));
        assert.strictEqual((read(slice).modelsLastUpdateTimesMeta as unknown[]).length, 4);
        // The next file's slice replaces it
        read(asMessage({ slice: 'file', value: fileSlice(graph, dataform, 'includes/params.js', 1) }));
        assert.ok(!('modelsLastUpdateTimesMeta' in read(slice)));
        // A flat message and the other slices pass as they did
        const flat = { recompiling: true };
        assert.strictEqual(read(flat), flat);
        assert.deepStrictEqual(read(asMessage({ slice: 'compile status', value: { compile: 1, status: 'compiling', showingPrevious: false, startedAt: 1 } })), { recompiling: true });
    });
});
