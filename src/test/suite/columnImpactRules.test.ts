import * as assert from 'assert';
import { suite, test } from 'mocha';
import { columnEntries, diffSchemas } from '../../shared/columnLineage/impactRules';
import { ColumnsController } from '../../shared/columnLineage/columnsController';
import { CachedTraceSource } from '../../shared/columnLineage/cachedSource';
import { SAMPLE_COLUMNS, SampleTraceSource } from '../../shared/columnLineage/sampleSource';
import { tableActions } from '../../shared/columnLineage/tableActions';
import { ColumnsView, LineageDirection, ReaderCounts, TraceSource, TraceState } from '../../shared/columnLineage/types';

suite('Column impact: schema diff', () => {
    test('finds dropped and retyped top-level columns, case-insensitively, treating legacy type names as equal', () => {
        const impacts = diffSchemas(
            [{ name: 'PLAYER_ID', type: 'INTEGER' }, { name: 'goals', type: 'STRING' }, { name: 'is_captain', type: 'BOOL' }],
            [{ name: 'player_id', type: 'INT64' }, { name: 'goals', type: 'INTEGER' }, { name: 'assists', type: 'INTEGER' }, { name: 'is_captain', type: 'BOOLEAN' }],
        );
        assert.deepStrictEqual(impacts, [
            { column: 'goals', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' } },
            { column: 'assists', change: { kind: 'dropped' } },
        ]);
    });

    test('reports nothing when the dry run matches prod', () => {
        assert.deepStrictEqual(diffSchemas([{ name: 'player_id', type: 'INT64' }], [{ name: 'PLAYER_ID', type: 'INTEGER' }]), []);
    });

    test('treats DECIMAL and BIGDECIMAL as NUMERIC and BIGNUMERIC', () => {
        assert.deepStrictEqual(diffSchemas([{ name: 'price', type: 'DECIMAL' }, { name: 'total', type: 'BIGDECIMAL' }], [{ name: 'price', type: 'NUMERIC' }, { name: 'total', type: 'BIGNUMERIC' }]), []);
    });
});

suite('Column impact: column list order', () => {
    const prod = [
        { name: 'player_id', type: 'INT64' },
        { name: 'goals', type: 'INT64' },
        { name: 'assists', type: 'INT64' },
        { name: 'minutes', type: 'INT64' },
        { name: 'team', type: 'STRING' },
    ];
    const dev = [
        { name: 'player_id', type: 'INT64' },
        { name: 'goals', type: 'STRING' },
        { name: 'team', type: 'STRING' },
        { name: 'xg', type: 'FLOAT64' },
    ];
    const counts = (copies: number): ReaderCounts => ({ copies, derived: 0, mayRead: 0 });

    test('changed columns first by readers, dropped before retyped on a tie, then prod order, then new columns', () => {
        const tie = columnEntries(prod, dev, new Map([['goals', counts(1)], ['assists', counts(1)], ['minutes', counts(0)]]));
        assert.deepStrictEqual(tie.map((entry) => entry.column), ['assists', 'goals', 'minutes', 'player_id', 'team', 'xg']);
        assert.deepStrictEqual(tie.find((entry) => entry.column === 'xg'), { column: 'xg', type: 'FLOAT64', isNew: true });

        const mostRead = columnEntries(prod, dev, new Map([['goals', counts(3)], ['assists', counts(1)]]));
        assert.deepStrictEqual(mostRead.slice(0, 3).map((entry) => entry.column), ['goals', 'assists', 'minutes']);
    });

    test('labels nothing without a dry run, and lists every dry-run column as new without a prod table', () => {
        assert.deepStrictEqual(columnEntries(prod, undefined, new Map()).map((entry) => [entry.column, !!entry.change, !!entry.isNew]), prod.map((field) => [field.name, false, false]));
        assert.ok(columnEntries(undefined, dev, new Map()).every((entry) => entry.isNew));
    });
});

/** Counts lookups, to check that counts and traces share them */
class CountingSource implements TraceSource {
    readonly kind = 'sample' as const;
    calls: string[] = [];
    private readonly inner = new SampleTraceSource([0, 0]);

    links(table: string, column: string, direction: LineageDirection) {
        this.calls.push(`${table}#${column}:${direction}`);
        return this.inner.links(table, column, direction);
    }
}

/** Fails the first count of `column`, as a rate-limited lookup would */
class FlakySource extends CountingSource {
    private failed = false;

    constructor(private readonly column: string) {
        super();
    }

    links(table: string, column: string, direction: LineageDirection) {
        if (column === this.column && !this.failed) {
            this.failed = true;
            return Promise.reject(new Error('Quota exceeded'));
        }
        return super.links(table, column, direction);
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function controller() {
    const views: ColumnsView[] = [];
    const traces: (TraceState | null)[] = [];
    const columns = new ColumnsController((view) => views.push(view), (state) => traces.push(state));
    return { columns, views, traces, last: () => views[views.length - 1], trace: () => traces[traces.length - 1] };
}

suite('Column impact: column list controller', () => {
    test('lists every column with counts for the changed ones only, and picks the top one', async () => {
        const { columns, views, last, trace } = controller();
        const source = new CountingSource();
        await columns.load(SAMPLE_COLUMNS, new CachedTraceSource(source));
        await settle();

        assert.ok(views.some((view) => view.status === 'loading'), 'reports loading while the changed columns are counted');
        assert.deepStrictEqual(last().entries.map((entry) => entry.column), ['revenue_usd', 'order_count', 'order_date', 'region', 'avg_basket_usd', 'loaded_at', 'revenue_eur']);
        assert.deepStrictEqual(last().entries.filter((entry) => entry.counts).map((entry) => entry.column), ['revenue_usd', 'order_count']);
        assert.deepStrictEqual(source.calls.filter((call) => call.startsWith(`${SAMPLE_COLUMNS.table}#`) && call.endsWith(':downstream')).sort(), [
            `${SAMPLE_COLUMNS.table}#order_count:downstream`,
            `${SAMPLE_COLUMNS.table}#revenue_usd:downstream`,
        ], 'no lookups for columns that did not change, until one is picked');
        assert.strictEqual(last().selected, 'revenue_usd');
        assert.strictEqual(trace()?.focus.column, 'revenue_usd');
        assert.deepStrictEqual(trace()?.focus.change, { kind: 'dropped' });
        assert.strictEqual(source.calls.filter((call) => call === `${SAMPLE_COLUMNS.table}#revenue_usd:downstream`).length, 1, 'the trace reuses the count lookup');
    });

    test("opens on a changed column, the cursor's if it is on one, and on the cursor's column only when nothing changed", async () => {
        const { columns, last } = controller();
        const source = () => new CachedTraceSource(new SampleTraceSource([0, 0]));
        await columns.load(SAMPLE_COLUMNS, source(), undefined, 'ORDER_COUNT');
        assert.strictEqual(last().selected, 'order_count', 'the cursor is on a changed column');
        await columns.load(SAMPLE_COLUMNS, source(), undefined, 'region');
        assert.strictEqual(last().selected, 'revenue_usd', 'a changed column wins over the cursor');
        await columns.load(SAMPLE_COLUMNS, source(), undefined, 'region', true);
        assert.strictEqual(last().selected, 'region', 'checking again keeps the selection');
        await columns.load({ ...SAMPLE_COLUMNS, dev: undefined }, source(), undefined, 'REGION');
        assert.strictEqual(last().selected, 'region', 'nothing is labelled without a dry run');
        await columns.load(SAMPLE_COLUMNS, source(), undefined, 'revenue_eur');
        columns.select('revenue_eur');
        assert.strictEqual(last().selected, 'revenue_usd', 'new columns have no lineage to select');
    });

    test('moves to a changed column when the first dry run labels a list that opened without one', async () => {
        const { columns, last, trace } = controller();
        await columns.load({ ...SAMPLE_COLUMNS, dev: undefined }, new CachedTraceSource(new SampleTraceSource([0, 0])), undefined, 'region');
        assert.strictEqual(last().selected, 'region');
        await columns.relabel(SAMPLE_COLUMNS.dev!);
        assert.strictEqual(last().selected, 'revenue_usd');
        assert.strictEqual(trace()?.focus.column, 'revenue_usd');
        columns.select('region');
        await columns.relabel(SAMPLE_COLUMNS.dev!);
        assert.strictEqual(last().selected, 'region', 'later dry runs keep the selection');
    });

    test('drops the labels when the dry run fails, rather than keeping the last one\'s', async () => {
        const { columns, last, trace } = controller();
        await columns.load(SAMPLE_COLUMNS, new CachedTraceSource(new SampleTraceSource([0, 0])));
        assert.ok(last().entries.some((entry) => entry.change));
        await columns.relabel(undefined);
        assert.ok(last().unchecked);
        assert.ok(last().entries.every((entry) => !entry.change));
        assert.strictEqual(trace()?.focus.change, undefined);
    });

    test('clears a column\'s count error once a later count of it succeeds', async () => {
        const { columns, last } = controller();
        await columns.load(SAMPLE_COLUMNS, new FlakySource('revenue_usd'));
        assert.strictEqual(last().entries.find((entry) => entry.column === 'revenue_usd')?.countsError, 'Quota exceeded');
        await columns.relabel(SAMPLE_COLUMNS.dev!);
        const entry = last().entries.find((candidate) => candidate.column === 'revenue_usd');
        assert.strictEqual(entry?.countsError, undefined);
        assert.ok(entry?.counts);
    });

    test('relabels after a new dry run, keeping the selection and relabelling its trace', async () => {
        const { columns, last, trace } = controller();
        await columns.load(SAMPLE_COLUMNS, new CachedTraceSource(new SampleTraceSource([0, 0])));
        columns.select('region');
        await settle();

        await columns.relabel(SAMPLE_COLUMNS.dev!.filter((field) => field.name !== 'region'));
        await settle();
        assert.strictEqual(last().selected, 'region');
        // Once table-level readers are counted, region and order_count have two readers each; the drop goes first
        assert.deepStrictEqual(last().entries.filter((entry) => entry.change).map((entry) => entry.column), ['revenue_usd', 'region', 'order_count']);
        assert.deepStrictEqual(trace()?.focus, { table: SAMPLE_COLUMNS.table, column: 'region', change: { kind: 'dropped' } });
    });

    test('carries "show upstream" to the next column, and shows a column picked before from its cache', async () => {
        const { columns, trace } = controller();
        const source = new CountingSource();
        await columns.load(SAMPLE_COLUMNS, new CachedTraceSource(source));
        await settle();
        await columns.setUpstream(true);
        columns.select('order_count');
        await settle();
        assert.strictEqual(trace()?.focus.column, 'order_count');
        assert.strictEqual(trace()?.upstreamShown, true);

        const before = source.calls.length;
        columns.select('revenue_usd');
        assert.strictEqual(trace()?.focus.column, 'revenue_usd');
        assert.ok(trace()?.nodes.some((node) => node.hop < 0), 'keeps the upstream it loaded before');
        await settle();
        assert.strictEqual(source.calls.length, before, 'no new lookups for a column already traced');
    });
});

suite('Column impact: which action to check', () => {
    test('ignores built-in assertions compiled from the same file', () => {
        const actions = [{ type: 'table', name: 'player_stats' }, { type: 'assertion', name: 'player_stats_assertions_uniqueKey_0' }];
        assert.deepStrictEqual(tableActions(actions).map((action) => action.name), ['player_stats']);
        assert.deepStrictEqual(tableActions([{ type: 'operations' }, { type: 'test' }]), []);
        assert.deepStrictEqual(tableActions(undefined), []);
    });

    test('includes operations that create the table they name', () => {
        const actions = [{ type: 'operations', hasOutput: true, name: 'order_clone' }, { type: 'operations', hasOutput: false, name: 'cleanup' }];
        assert.deepStrictEqual(tableActions(actions).map((action) => action.name), ['order_clone']);
    });
});
