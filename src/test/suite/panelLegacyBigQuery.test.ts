import * as assert from 'assert';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { DryRunResult, toDryRunResult } from '../../bigquery/dryRunService';
import { bigQuerySlice, fileSlice } from '../../panel/slices';
import { dryRunScripts, madeUpTarget, targetId } from '../../shared/compiledGraph';
import type { HostMessage } from '../../shared/panelContract';
import { MIGRATED_BIGQUERY_FIELDS, dryRunCostSummary, legacyStateFromBigQuerySlice } from '../../shared/panelLegacyBigQuery';
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
        const started = toLegacyState(asMessage({ slice: 'bigquery', value: out }));
        assert.deepStrictEqual([started.dryRunning, started.currencySymbol], [true, '$']);
        // The columns on show stay while dry runs are out
        assert.ok(!('compiledQuerySchema' in started));
        const back = toLegacyState(asMessage({ slice: 'bigquery', value: bigQuerySlice({ results: [], currencySymbol: '£' }, 1) }));
        assert.deepStrictEqual([back.dryRunning, back.currencySymbol], [false, '£']);
    });

    test('what is known of the tables is listed by the position of each action in the flat state', () => {
        const tables = {
            'p.ds.v': { lastModified: '2026-10-06 09:00', modifiedToday: false },
            'p.ds.op': { error: 'Could not retrieve lastModifiedTime for p.ds.op' },
            'p.ds.check': { lastModified: '2026-10-07 08:00', modifiedToday: true },
        };
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results: [], tables }, 1), file);
        assert.deepStrictEqual(Object.keys(flat).sort(), MIGRATED_BIGQUERY_FIELDS.filter((field) => field !== 'compiledQuerySchema').sort());
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

    // BigQuery's answers to the scripts of the file's actions, as results
    const answer = (id: string, script: string, response: object, incremental = false, from = graph): DryRunResult => {
        const action = from.actions[id];
        return toDryRunResult(action, dryRunScripts(action).find((candidate) => candidate.name === script && candidate.incremental === incremental)!, 1, response as any);
    };
    const ok = (bytes: number, fields?: object[]) => ({
        error: { hasError: false, message: '' },
        statistics: { totalBytesProcessed: bytes, cost: { currency: 'USD', value: 0.00625 }, totalBytesProcessedAccuracy: 'PRECISE' },
        ...(fields ? { schema: { fields } } : {}),
    });
    const failed = (message: string, line = 0, column = 0) => ({ error: { hasError: true, message, location: { line, column } } });
    const testId = targetId(madeUpTarget('unit test', 'v_total'));

    test('each result is given by the name of its action: cost, error and the SQL that was dry-run', () => {
        const results = [
            answer('p.ds.v', 'query', ok(1024 ** 3)),
            answer('p.ds.check', 'query', failed('Not found: Table p.ds.v')),
            answer('p.ds.op', 'operation', ok(0)),
            answer(testId, 'test query', ok(1024)),
            answer(testId, 'expected output', failed('Syntax error at [1:8]', 1, 8)),
        ];
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results }, 1), file);
        assert.deepStrictEqual(Object.keys(flat).sort(), [...MIGRATED_BIGQUERY_FIELDS].sort());
        // A unit test is named by its name, and its two queries are told apart
        assert.deepStrictEqual(flat.dryRunStatByNodeName, { 'p.ds.v': '1.00 GiB $0.006', 'p.ds.op': '0 B $0.006', v_total: 'Input: 1.00 KiB $0.006' });
        // An error BigQuery gave no place for is at line 0
        assert.deepStrictEqual(flat.dryRunErrorsByNodeName, { 'p.ds.check': { message: 'Not found: Table p.ds.v', location: { line: 0, column: 0 } } });
        assert.deepStrictEqual(flat.dryRunExpectedOutputErrorsByNodeName, { v_total: { message: 'Syntax error at [1:8]', location: { line: 1, column: 8 } } });
        assert.deepStrictEqual(flat.dryRunQueryByNodeName, { 'p.ds.v': 'select 1', 'p.ds.check': 'select 3', 'p.ds.op': 'select 2' });
        assert.deepStrictEqual([flat.dryRunIncrementalErrorsByNodeName, flat.dryRunIncrementalQueryByNodeName, flat.dryRunNonIncrementalQueryByNodeName], [{}, {}, {}]);
        // The maps by type of action are sent empty, so the last file's do not stand
        assert.deepStrictEqual([flat.dryRunStatByNodeType, flat.dryRunErrorsByNodeType, flat.dryRunIncrementalErrorsByNodeType, flat.dryRunExpectedOutputErrorsByNodeType], [{}, {}, {}, {}]);
    });

    test('an incremental table has both variants, and an error is placed in the script that was sent', () => {
        const incremental = buildDataformGraph({
            tables: [{
                type: 'incremental', target: target('events'), fileName: 'definitions/events.sqlx',
                preOps: ['declare since default date "2026-01-01"'], query: 'select *\nfrom src\nwhere day >= since',
                incrementalPreOps: ['declare since default (select max(day) from p.ds.events)'], incrementalQuery: 'select *\nfrom src\nwhere dy >= since',
            }],
        } as unknown as DataformCompiledJson);
        const shown = fileSlice(incremental, dataform, 'definitions/events.sqlx', 1);
        // BigQuery places the error in the script: the pre-operation is its first line, so line 3 of the query is line 4
        const results = [
            answer('p.ds.events', 'query', ok(2048), false, incremental),
            answer('p.ds.events', 'query', failed('Unrecognized name: dy at [4:7]', 4, 7), true, incremental),
        ];
        assert.deepStrictEqual([results[1].error?.section, results[1].error?.line, results[1].error?.column], ['incremental query', 3, 7]);
        const flat = legacyStateFromBigQuerySlice(bigQuerySlice({ results }, 1), shown);
        assert.deepStrictEqual(flat.dryRunStatByNodeName, { 'p.ds.events': 'Non incremental: 2.00 KiB $0.006' });
        assert.deepStrictEqual(flat.dryRunErrorsByNodeName, {});
        assert.deepStrictEqual(flat.dryRunIncrementalErrorsByNodeName, { 'p.ds.events': { message: 'Unrecognized name: dy at [4:7]', location: { line: 4, column: 7 } } });
        const scripts = [flat.dryRunNonIncrementalQueryByNodeName, flat.dryRunIncrementalQueryByNodeName] as Array<Record<string, string>>;
        assert.strictEqual(scripts[0]['p.ds.events'], 'declare since default date "2026-01-01";\nselect *\nfrom src\nwhere day >= since;');
        assert.strictEqual(scripts[1]['p.ds.events'].split('\n')[3], 'where dy >= since;');
        assert.deepStrictEqual(flat.dryRunQueryByNodeName, {});

        // Sections on show that are not those that were sent: the error is kept and not placed
        const other = { ...shown, actions: shown.actions.map((action) => ({ ...action, sections: action.sections.map((section) => ({ ...section, sql: `${section.sql}\n-- edited` })) })) };
        const unplaced = legacyStateFromBigQuerySlice(bigQuerySlice({ results }, 1), other).dryRunIncrementalErrorsByNodeName as Record<string, { location: object }>;
        assert.deepStrictEqual(unplaced['p.ds.events'].location, { line: 0, column: 0 });
    });

    test('the columns are those of the first action, described as its config describes them', () => {
        const described = buildDataformGraph({
            tables: [{ type: 'table', target: target('orders'), fileName: 'definitions/orders.sqlx', query: 'select 1 as id', actionDescriptor: { columns: [{ path: ['id'], description: 'The order' }] } }],
            assertions: [{ target: target('orders_check'), fileName: 'definitions/orders.sqlx', query: 'select 2 as n' }],
        } as unknown as DataformCompiledJson);
        const shown = fileSlice(described, dataform, 'definitions/orders.sqlx', 1);
        const results = [
            answer('p.ds.orders', 'query', ok(1, [{ name: 'id', type: 'INT64' }, { name: 'total', type: 'NUMERIC' }]), false, described),
            answer('p.ds.orders_check', 'query', ok(1, [{ name: 'n', type: 'INT64' }]), false, described),
        ];
        assert.deepStrictEqual(legacyStateFromBigQuerySlice(bigQuerySlice({ results }, 1), shown).compiledQuerySchema, {
            fields: [{ name: 'id', type: 'INT64', description: 'The order' }, { name: 'total', type: 'NUMERIC' }],
        });
        // A dry run that gave no columns: the one empty column the flat state has for that
        const noColumns = [answer('p.ds.orders', 'query', failed('boom'), false, described)];
        assert.deepStrictEqual(legacyStateFromBigQuerySlice(bigQuerySlice({ results: noColumns }, 1), shown).compiledQuerySchema, { fields: [{ name: '', type: '' }] });
        // No dry run was made, or they are still out: the columns on show stay
        assert.ok(!('compiledQuerySchema' in legacyStateFromBigQuerySlice(bigQuerySlice({ results: [] }, 1), shown)));
        assert.ok(!('compiledQuerySchema' in legacyStateFromBigQuerySlice(bigQuerySlice({ results, dryRunning: [{ action: 'p.ds.orders', script: 'query', incremental: false }] }, 1), shown)));
        // A file with no action to show has no columns
        const helper = fileSlice(described, dataform, 'includes/params.js', 1);
        assert.strictEqual(legacyStateFromBigQuerySlice(bigQuerySlice({ results: [] }, 1), helper).compiledQuerySchema, null);
    });

    test('a result of an earlier compile is not for the SQL on show', () => {
        const stale = { ...answer('p.ds.v', 'query', ok(1024)), compile: 1 };
        assert.deepStrictEqual(legacyStateFromBigQuerySlice(bigQuerySlice({ results: [stale] }, 2), file).dryRunStatByNodeName, {});
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

suite('panel: what a dry run would cost, as text', () => {
    const oneGiB = 1024 ** 3;
    // BigQuery's answer as the dry-run service turns it into a result
    const buildResult = (statistics: any, hasError = false): DryRunResult =>
        toDryRunResult(graph.actions['p.ds.v'], dryRunScripts(graph.actions['p.ds.v'])[0], 1, { statistics, error: { hasError, message: hasError ? 'boom' : '' } } as any);
    const formatDryRunCostSummary = (result: DryRunResult | undefined, label: string, currencySymbol: string) => dryRunCostSummary(result, label, currencySymbol);

    test('formats a precise estimate', () => {
        const result = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'PRECISE'
        });
        assert.strictEqual(formatDryRunCostSummary(result, '', '$'), '1.00 GiB $0.006');
    });

    test('prefixes bound estimates and prepends the label', () => {
        const upperBound = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'UPPER_BOUND'
        });
        assert.strictEqual(formatDryRunCostSummary(upperBound, 'Incremental', '$'), 'Incremental: Up to 1.00 GiB $0.006');

        const lowerBound = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'LOWER_BOUND'
        });
        assert.strictEqual(formatDryRunCostSummary(lowerBound, '', '$'), 'At least 1.00 GiB $0.006');
    });

    test('replaces the 0 bytes UNKNOWN reports with a warning', () => {
        // BigQuery reports totalBytesProcessed "0" whenever accuracy is UNKNOWN
        const result = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SELECT',
            totalBytesProcessedAccuracy: 'UNKNOWN',
            bytesEstimateUnknown: true
        });
        assert.strictEqual(formatDryRunCostSummary(result, '', '$'), '\u26a0 Bytes unknown');
        assert.strictEqual(formatDryRunCostSummary(result, 'Incremental', '$'), 'Incremental: \u26a0 Bytes unknown');
    });

    test('warns for scripts whose bytes could not be computed', () => {
        const unknownScript = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SCRIPT',
            totalBytesProcessedAccuracy: 'UNKNOWN',
            bytesEstimateUnknown: true
        });
        assert.strictEqual(formatDryRunCostSummary(unknownScript, '', '$'), '\u26a0 Bytes unknown');

        // A script with a non-precise but known accuracy keeps the existing note
        const lowerBoundScript = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SCRIPT',
            totalBytesProcessedAccuracy: 'LOWER_BOUND'
        });
        assert.strictEqual(
            formatDryRunCostSummary(lowerBoundScript, '', '$'),
            'NOTE: Could not compute bytes processed estimate for script.'
        );
    });

    test('returns an empty string when there is nothing to show', () => {
        assert.strictEqual(formatDryRunCostSummary(undefined, '', '$'), '');
        assert.strictEqual(formatDryRunCostSummary(buildResult({ totalBytesProcessed: 0 }), '', '$'), '');
        const erroredResult = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 }
        }, true);
        assert.strictEqual(formatDryRunCostSummary(erroredResult, '', '$'), '');
    });
});
