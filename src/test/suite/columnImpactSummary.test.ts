import * as assert from 'assert';
import { suite, test } from 'mocha';
import {
    ImpactCandidate, ImpactView, MARKDOWN_READERS, ReaderContext, annotateReader, buildImpactSummary, impactMarkdown, impactSeverity, mentions, rankReaders, safeSummary,
} from '../../shared/columnLineage/impactSummary';
import { changeSignature, guessProdTarget } from '../../columnLineage/changeImpact';
import { ColumnLink, LineageDirection, TraceSource } from '../../shared/columnLineage/types';
import { DataformCompiledJson } from '../../types';

/** Readers per `table#column`, readers per table for deleted tables, and tables whose lookups fail */
function fakeSource(columnLinks: Record<string, ColumnLink[]>, tableLinks: Record<string, ColumnLink[]> = {}, failing = new Set<string>()): TraceSource & { calls: string[] } {
    const calls: string[] = [];
    return {
        kind: 'sample',
        calls,
        async links(table: string, column: string, direction: LineageDirection) {
            calls.push(`${direction} ${table}#${column}`);
            if (failing.has(table)) {
                throw new Error('No access to Data Lineage');
            }
            return columnLinks[`${table}#${column}`] ?? [];
        },
        async tableOnlyReaders(table: string, linked: Set<string>) {
            return (tableLinks[table] ?? []).filter((link) => !linked.has(link.table));
        },
        async tableReaders(table: string) {
            calls.push(`readers ${table}`);
            return tableLinks[table] ?? [];
        },
    };
}

const files: Record<string, string> = {
    'p.marts.orders': 'definitions/orders.sqlx',
    'p.marts.revenue': 'definitions/revenue.sqlx',
    'p.marts.daily': 'definitions/daily.sqlx',
    'p.marts.customers': 'definitions/customers.sqlx',
};

function context(changed: string[] = [], sql: Record<string, string> = {}): ReaderContext {
    return { resolveFile: (table) => files[table], changed: new Set(changed), sqlOf: (table) => sql[table] };
}

suite('Column impact summary: readers', () => {
    test('matches whole identifiers only, ignoring case', () => {
        assert.strictEqual(mentions('SELECT o.Discount FROM orders o', 'discount'), true);
        assert.strictEqual(mentions('SELECT discount_pct FROM orders', 'discount'), false);
        assert.strictEqual(mentions('SELECT `discount` FROM orders', 'discount'), true);
        assert.strictEqual(mentions('SELECT total$ FROM t', 'total'), false, '$ is part of an identifier in Dataform JS output');
    });

    test('flags readers outside the project, and judges readers changed on the branch by their new SQL', () => {
        const ctx = context(['p.marts.revenue', 'p.marts.daily'], {
            'p.marts.revenue': 'SELECT order_id, amount FROM `p.marts.orders`',
            'p.marts.daily': 'SELECT SUM(discount) AS discount FROM `p.marts.orders`',
        });
        const outside = annotateReader({ table: 'p.fin.margins', column: 'discount', dependencyType: 'EXACT_COPY' }, 'discount', ctx);
        const updated = annotateReader({ table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER' }, 'discount', ctx);
        const stillNames = annotateReader({ table: 'p.marts.daily', column: 'discount', dependencyType: 'OTHER' }, 'discount', ctx);
        assert.deepStrictEqual(outside, { table: 'p.fin.margins', column: 'discount', dependencyType: 'EXACT_COPY' });
        assert.deepStrictEqual(updated, { table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER', filePath: 'definitions/revenue.sqlx', changedOnBranch: true, probablyUpdated: true });
        assert.strictEqual(stillNames.stillNamed, true);
        assert.strictEqual(stillNames.probablyUpdated, undefined);
    });

    test('ranks readers outside the project first and those probably updated last, without duplicates', () => {
        const ranked = rankReaders([
            { table: 'p.marts.revenue', dependencyType: 'OTHER', filePath: 'r', changedOnBranch: true, probablyUpdated: true },
            { table: 'p.marts.daily', dependencyType: 'TABLE_ONLY', filePath: 'd' },
            { table: 'p.marts.customers', dependencyType: 'EXACT_COPY', filePath: 'c' },
            { table: 'p.fin.margins', dependencyType: 'OTHER' },
            { table: 'p.marts.customers', dependencyType: 'EXACT_COPY', filePath: 'c' },
        ]);
        assert.deepStrictEqual(ranked.map((reader) => reader.table), ['p.fin.margins', 'p.marts.customers', 'p.marts.daily', 'p.marts.revenue']);
    });
});

suite('Column impact summary: build', () => {
    const orders: ImpactCandidate = {
        table: 'p.marts.orders',
        fileName: 'definitions/orders.sqlx',
        type: 'table',
        prod: [{ name: 'order_id', type: 'INT64' }, { name: 'discount', type: 'NUMERIC' }, { name: 'amount', type: 'FLOAT' }, { name: 'note', type: 'STRING' }],
        dev: [{ name: 'order_id', type: 'INTEGER' }, { name: 'amount', type: 'NUMERIC' }, { name: 'note', type: 'STRING' }, { name: 'channel', type: 'STRING' }],
    };
    const unchanged: ImpactCandidate = {
        table: 'p.marts.daily',
        fileName: 'definitions/daily.sqlx',
        type: 'view',
        prod: [{ name: 'day', type: 'DATE' }],
        dev: [{ name: 'day', type: 'DATE' }, { name: 'orders', type: 'INT64' }],
    };

    test('splits tables into at risk, safe and not checked, and looks up readers only for what is at risk', async () => {
        const source = fakeSource({
            'p.marts.orders#discount': [
                { table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER' },
                { table: 'p.fin.margins', column: 'discount', dependencyType: 'EXACT_COPY' },
                { table: 'p.marts_assertions.orders_nonNull', column: 'discount', dependencyType: 'OTHER', assertion: true },
            ],
        }, {
            'p.marts.orders': [{ table: 'p.ml.events', dependencyType: 'TABLE_ONLY' }, { table: 'p.marts.revenue', dependencyType: 'TABLE_ONLY' }],
            'p.marts.customers': [{ table: 'p.marts.revenue', dependencyType: 'TABLE_ONLY' }],
        });
        const result = await buildImpactSummary([
            orders,
            unchanged,
            { table: 'p.marts.customers', fileName: 'definitions/customers.sqlx', type: 'table', deleted: true },
            { table: 'p.marts.ops', type: 'operations', uncheckedReason: 'operation: a dry run of a script has no schema' },
        ], source, context(['p.marts.revenue'], { 'p.marts.revenue': 'SELECT amount AS net FROM `p.marts.customers`' }));

        assert.ok(result);
        assert.deepStrictEqual(result.atRisk.map((entry) => entry.table), ['p.marts.orders', 'p.marts.customers'], 'most readers still to look at first');
        const [ordersImpact, customers] = result.atRisk;
        assert.deepStrictEqual(ordersImpact.columns.map((column) => [column.column, column.change.kind]), [['discount', 'dropped'], ['amount', 'typeChanged']]);
        assert.deepStrictEqual(ordersImpact.added, ['channel']);
        const discount = ordersImpact.columns[0];
        assert.deepStrictEqual(discount.readers.map((reader) => reader.table), ['p.fin.margins', 'p.ml.events', 'p.marts.revenue'], 'assertions left out, table-level readers added');
        assert.strictEqual(discount.readers[2].probablyUpdated, true);
        assert.strictEqual(customers.deleted, true);
        assert.deepStrictEqual(customers.readers?.map((reader) => [reader.table, reader.stillNamed]), [['p.marts.revenue', true]], 'the deleted table name is what a reader has to stop naming');
        assert.deepStrictEqual(result.safe.map((entry) => [entry.table, entry.added]), [['p.marts.daily', ['orders']]]);
        assert.deepStrictEqual(result.unchecked, [{ table: 'p.marts.ops', fileName: undefined, reason: 'operation: a dry run of a script has no schema' }]);
        assert.ok(!source.calls.some((call) => call.includes('p.marts.daily')), 'no lookups for a safe table');
    });

    test('keeps a failed lookup on its column instead of failing the summary', async () => {
        const result = await buildImpactSummary([orders], fakeSource({}, {}, new Set(['p.marts.orders'])), context());
        assert.deepStrictEqual(result?.atRisk[0].columns.map((column) => column.readersError), ['No access to Data Lineage', 'No access to Data Lineage']);
    });

    test('stops starting lookups once cancelled', async () => {
        const wide: ImpactCandidate = {
            table: 'p.marts.wide',
            type: 'table',
            prod: Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, type: 'INT64' })),
            dev: [{ name: 'id', type: 'INT64' }],
        };
        const source = fakeSource({});
        let cancelled = false;
        const result = await buildImpactSummary([wide], source, context(), (done) => {
            if (done === 1) {
                cancelled = true;
            }
        }, () => cancelled);
        assert.strictEqual(result, undefined);
        assert.strictEqual(source.calls.length, 4, 'only the batch already started');
    });
});

suite('Column impact summary: Markdown', () => {
    const copies = Array.from({ length: MARKDOWN_READERS + 2 }, (_, i) => ({ table: `p.rep.r${i}`, dependencyType: 'EXACT_COPY' as const, filePath: `r${i}.sqlx` }));
    const view: ImpactView = {
        status: 'ready',
        comparison: { headRef: 'feat/x', baseRef: 'origin/main', mergeBaseSha: '52863aa0c1', headLabel: 'working tree' },
        changedCount: 3,
        atRisk: [
            {
                table: 'p.marts.orders',
                type: 'table',
                columns: [
                    {
                        column: 'discount',
                        change: { kind: 'dropped' },
                        readers: [
                            { table: 'p.fin.margins', column: 'discount', dependencyType: 'EXACT_COPY' },
                            ...copies,
                            { table: 'p.marts.daily', column: 'net', dependencyType: 'OTHER', filePath: 'd.sqlx' },
                            { table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER', filePath: 'r.sqlx', changedOnBranch: true, probablyUpdated: true },
                        ],
                    },
                    { column: 'amount', change: { kind: 'typeChanged', from: 'FLOAT64', to: 'NUMERIC' }, readers: [{ table: 'p.marts.daily', column: 'amount', dependencyType: 'OTHER', filePath: 'd.sqlx' }] },
                    { column: 'note', change: { kind: 'dropped' }, readers: [], readersError: 'No access | denied' },
                ],
            },
            { table: 'p.marts.customers', type: 'table', deleted: true, columns: [], readers: [{ table: 'p.marts.revenue', dependencyType: 'TABLE_ONLY', filePath: 'r.sqlx', changedOnBranch: true, probablyUpdated: true }] },
        ],
        safe: [
            { table: 'p.marts.daily', type: 'view', columns: [] },
            { table: 'p.marts.weekly', type: 'table', columns: [], added: ['channel', 'region'] },
        ],
        unchecked: [{ table: 'p.marts.ops', reason: 'operation: a dry run of a script has no schema' }],
    };

    test('has one table per model with change, severity, downstream reader tables and direct copies', () => {
        const lines = impactMarkdown(view).split('\n');
        assert.deepStrictEqual(lines.slice(0, 5), [
            '### Dataform Column Lineage Impact Report',
            '',
            '**Branch:** `feat/x` vs `origin/main` @ `52863aa` | **Evaluated against:** production schemas',
            '',
            '3 changed · 2 at risk · 1 not checked',
        ]);
        assert.ok(lines.includes('**Target model:** `marts.orders`'));
        assert.ok(lines.includes('| Column | Change | Severity | Downstream | Direct copies |'));
        assert.ok(lines.includes('| `discount` | **DROPPED** | 🚨 **CRITICAL** | 8 models, 1 outside project (+1 probably updated) | `fin.margins` *(outside)*, `rep.r0`, `rep.r1`, `rep.r2`, `rep.r3`, +3 more |'));
        assert.ok(lines.includes('| `amount` | `FLOAT64 → NUMERIC` | ⚠️ **WARNING** | 1 model | — |'));
        assert.ok(lines.includes('| `note` | **DROPPED** | ❔ UNKNOWN | lookup failed: No access \\| denied | — |'), 'pipes escaped');
        assert.ok(lines.includes('| *whole table* | **TABLE DELETED** | ℹ️ LOW | none found (+1 probably updated) | — |'), 'nothing left reading it');
        assert.ok(lines.includes('<details><summary>Not checked (1)</summary>'));
    });

    test('lists the changed tables that keep every prod column, with the columns they add', () => {
        const lines = impactMarkdown(view).split('\n');
        const start = lines.indexOf('<details><summary>2 changed tables keep every prod column</summary>');
        assert.ok(start > 0);
        assert.deepStrictEqual(lines.slice(start + 2, start + 4), ['- `marts.daily`', '- `marts.weekly`: adds `channel`, `region`']);
        assert.ok(start < lines.indexOf('<details><summary>Not checked (1)</summary>'), 'before the tables not checked');
        assert.strictEqual(safeSummary(1), '1 changed table keeps every prod column');
    });

    test('rates severity by what is still read', () => {
        const reader = { table: 'p.a.b', dependencyType: 'OTHER' as const };
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [reader]), 'critical');
        assert.strictEqual(impactSeverity('deleted', [reader]), 'critical');
        assert.strictEqual(impactSeverity({ kind: 'typeChanged', from: 'INT64', to: 'STRING' }, [reader]), 'warning');
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [{ ...reader, probablyUpdated: true }]), 'low');
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [], 'boom'), 'unknown');
    });
});

suite('Column impact summary: host helpers', () => {
    test('guesses a deleted table\'s prod dataset from a table that shared its dev dataset', () => {
        const devToProd: [string, string][] = [['dev-proj.marts_ashish.orders', 'prod-proj.marts.orders']];
        assert.strictEqual(guessProdTarget('dev-proj.marts_ashish.customers', devToProd), 'prod-proj.marts.customers');
        assert.strictEqual(guessProdTarget('dev-proj.other.customers', devToProd), 'dev-proj.other.customers');
    });

    test('changes signature when a changed action\'s SQL does, not when an unchanged one does', () => {
        const graph = (ordersSql: string, dailySql: string) => ({
            tables: [
                { type: 'table', target: { database: 'p', schema: 'marts', name: 'orders' }, query: ordersSql },
                { type: 'table', target: { database: 'p', schema: 'marts', name: 'daily' }, query: dailySql },
            ],
        }) as unknown as DataformCompiledJson;
        const diff = { changed: [{ target: 'p.marts.orders', reasons: ['sql'] }], deleted: [] } as any;
        const before = changeSignature(diff, graph('SELECT 1 AS a', 'SELECT 1'));
        assert.strictEqual(changeSignature(diff, graph('SELECT 1 AS a', 'SELECT 2')), before);
        assert.notStrictEqual(changeSignature(diff, graph('SELECT 1 AS b', 'SELECT 1')), before);
    });
});
