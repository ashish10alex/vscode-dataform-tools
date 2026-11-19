import * as assert from 'assert';
import { suite, test } from 'mocha';
import {
    ImpactCandidate, ImpactView, MARKDOWN_READERS, MARKDOWN_READER_LIST, ReaderContext, annotateReader, breaksRun, buildImpactSummary, impactMarkdown, impactSeverity, isLowImpact, mentions, rankReaders,
    newNote, projectsOf, safeSummary, summaryCounts, unsetHint,
} from '../../shared/columnLineage/impactSummary';
import { CheckDeps, UNKNOWN_PROD_TARGET, changeSignature, checkChanged, checkDeleted, guessProdTarget } from '../../columnLineage/changeImpact';
import { matchProdTargets, prodIndexOf } from '../../columnLineage/prodIndex';
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

    test('matches a dotted table path with or without backticks round each part', () => {
        assert.strictEqual(mentions('SELECT * FROM `p.marts.customers`', 'marts.customers'), true);
        assert.strictEqual(mentions('SELECT * FROM `p`.`Marts`.`customers` c', 'marts.customers'), true);
        assert.strictEqual(mentions('SELECT * FROM marts.customers', 'marts.customers'), true);
        assert.strictEqual(mentions('SELECT * FROM `p.crm.customers`', 'marts.customers'), false, 'moved to another dataset');
        assert.strictEqual(mentions('SELECT * FROM `p.old_marts.customers`', 'marts.customers'), false);
        assert.strictEqual(mentions('SELECT * FROM `p.marts.customers_v2`', 'marts.customers'), false);
        assert.strictEqual(mentions('SELECT * FROM `p.martsXcustomers`', 'marts.customers'), false, 'the dot is literal');
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

    test('folds dev runs into their Prod Target, and marks readers this branch deletes', () => {
        const ctx: ReaderContext = {
            ...context(),
            toProd: (table) => ({ 'dev.marts_ashish.revenue': 'p.marts.revenue', 'dev.marts_ashish.old': 'p.marts.old' } as Record<string, string>)[table] ?? table,
            deleted: new Set(['p.marts.old']),
        };
        const devRun = annotateReader({ table: 'dev.marts_ashish.revenue', column: 'net', dependencyType: 'OTHER' }, 'discount', ctx);
        const deleted = annotateReader({ table: 'dev.marts_ashish.old', dependencyType: 'TABLE_ONLY' }, 'discount', ctx);
        assert.deepStrictEqual(devRun, { table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER', filePath: 'definitions/revenue.sqlx' });
        assert.deepStrictEqual(deleted, { table: 'p.marts.old', dependencyType: 'TABLE_ONLY', deletedOnBranch: true }, 'no file to open, and not outside the project');
        const ranked = rankReaders([deleted, { table: 'p.fin.margins', dependencyType: 'OTHER' }, { ...devRun, changedOnBranch: true, probablyUpdated: true }]);
        assert.deepStrictEqual(ranked.map((reader) => reader.table), ['p.fin.margins', 'p.marts.revenue', 'p.marts.old'], 'deleted readers last');
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

    test('settles a reader of a table moved to another dataset, and matches it as the compiled SQL names it', async () => {
        // The branch moves customers from marts to crm, and revenue's ref() follows it: its new SQL still names
        // customers, but in crm
        const source = fakeSource({}, { 'p.marts.customers': [{ table: 'p.marts.revenue', dependencyType: 'TABLE_ONLY' }] });
        const moved = await buildImpactSummary([{ table: 'p.marts.customers', type: 'table', deleted: true }], source,
            context(['p.marts.revenue'], { 'p.marts.revenue': 'SELECT amount AS net FROM `p.crm.customers`' }));
        assert.deepStrictEqual(moved!.atRisk[0].readers?.map((reader) => [reader.probablyUpdated, reader.stillNamed]), [[true, undefined]]);
        assert.strictEqual(isLowImpact(moved!.atRisk[0]), true);

        // Compiled with a schema suffix, the reader still names the dev table the Prod Target was guessed from
        const suffixed = await buildImpactSummary([{ table: 'p.marts.customers', type: 'table', deleted: true, named: 'dev.marts_ashish.customers' }], source,
            context(['p.marts.revenue'], { 'p.marts.revenue': 'SELECT amount AS net FROM `dev.marts_ashish.customers`' }));
        assert.deepStrictEqual(suffixed!.atRisk[0].readers?.map((reader) => reader.stillNamed), [true]);
        // Or one that names its Prod Target outright
        const outright = await buildImpactSummary([{ table: 'p.marts.customers', type: 'table', deleted: true, named: 'dev.marts_ashish.customers' }], source,
            context(['p.marts.revenue'], { 'p.marts.revenue': 'SELECT amount AS net FROM `p.marts.customers`' }));
        assert.deepStrictEqual(outright!.atRisk[0].readers?.map((reader) => reader.stillNamed), [true]);
    });

    test('compares a renamed table with the one it had, and judges readers by their new name and SQL', async () => {
        // orders moved from marts to sales and dropped discount; revenue moved too, and still names discount
        const source = fakeSource({
            'p.marts.orders#discount': [
                { table: 'p.marts.revenue', column: 'net', dependencyType: 'OTHER' },
                { table: 'p.marts.orders', column: 'discount', dependencyType: 'EXACT_COPY' },
            ],
        }, { 'p.marts.orders': [{ table: 'p.marts.daily', dependencyType: 'TABLE_ONLY' }] });
        const ctx: ReaderContext = {
            ...context(['p.sales.orders', 'p.sales.revenue', 'p.marts.daily'], {
                'p.sales.revenue': 'SELECT discount AS net FROM `p.sales.orders`',
                'p.marts.daily': 'SELECT * FROM `p.sales.orders`',
            }),
            deleted: new Set(['p.marts.orders', 'p.marts.revenue']),
            renamed: new Map([['p.marts.orders', 'p.sales.orders'], ['p.marts.revenue', 'p.sales.revenue']]),
        };
        const result = await buildImpactSummary([
            { ...orders, table: 'p.sales.orders', new: true, target: 'p.marts.orders', renamedFrom: 'p.marts.orders', fromOld: true },
            { table: 'p.marts.orders', type: 'table', deleted: true, renamedTo: 'p.sales.orders' },
        ], source, ctx);

        const [renamed, old] = result!.atRisk;
        assert.deepStrictEqual([renamed.table, renamed.renamedFrom, renamed.fromOld, renamed.exists], ['p.sales.orders', 'p.marts.orders', true, undefined]);
        const discount = renamed.columns.find((column) => column.column === 'discount')!;
        assert.deepStrictEqual(discount.readers.map((reader) => [reader.table, reader.renamedFrom, reader.stillNamed, reader.probablyUpdated]), [
            ['p.sales.revenue', 'p.marts.revenue', true, undefined],
            ['p.marts.daily', undefined, undefined, true],
        ], 'the old table reading itself is left out, and revenue is judged under its new name');
        assert.ok(source.calls.includes('downstream p.marts.orders#discount'), 'the readers looked up are the old table\'s');
        assert.deepStrictEqual([old.table, old.renamedTo], ['p.marts.orders', 'p.sales.orders']);
        assert.deepStrictEqual(old.readers?.map((reader) => reader.probablyUpdated), [true]);
        assert.strictEqual(isLowImpact(old), true);

        const markdown = impactMarkdown({ status: 'ready', changedCount: 2, ...result!, unchecked: [] });
        assert.ok(markdown.includes('**Target model:** `sales.orders` (renamed from `marts.orders`)'), markdown);
        assert.ok(markdown.includes('**Target model:** `marts.orders` (renamed to `sales.orders`)'), markdown);
        assert.ok(markdown.includes('| *whole table* | **RENAMED** to `sales.orders` |'), markdown);
        assert.ok(markdown.includes('| *whole table* | `marts.daily` | — | reads the table | moved to the new name |'), markdown);
        assert.ok(markdown.includes('| `discount` | `sales.revenue` | `net` | derived or filtered | renamed here, still names it |'), markdown);
    });

    test('marks a change the base branch made too as its, and low whoever reads the column', async () => {
        // The base already dropped discount; this branch also retypes amount
        const source = fakeSource({
            'p.marts.orders#discount': [{ table: 'p.fin.margins', column: 'discount', dependencyType: 'EXACT_COPY' }],
            'p.marts.orders#amount': [{ table: 'p.fin.margins', column: 'amount', dependencyType: 'EXACT_COPY' }],
        });
        const base = [{ name: 'order_id', type: 'INT64' }, { name: 'amount', type: 'FLOAT' }, { name: 'note', type: 'STRING' }];
        const result = await buildImpactSummary([{ ...orders, base }], source, context());
        const columns = Object.fromEntries(result!.atRisk[0].columns.map((column) => [column.column, column]));
        assert.strictEqual(columns.discount.change.onBase, true);
        assert.strictEqual(columns.amount.change.onBase, undefined);
        assert.strictEqual(impactSeverity(columns.discount.change, columns.discount.readers), 'low');
        assert.strictEqual(impactSeverity(columns.amount.change, columns.amount.readers), 'warning');
        const markdown = impactMarkdown({ status: 'ready', changedCount: 1, ...result!, comparison: { headRef: 'feat', baseRef: 'origin/main', mergeBaseSha: 'abc1234', headLabel: 'working tree' } });
        assert.ok(markdown.includes('| `discount` | **DROPPED**, already on `origin/main` | ℹ️ LOW |'), markdown);
    });

    test('says a dropped column breaks an incremental table\'s own run, after a full refresh too when uniqueKey names it', async () => {
        assert.strictEqual(breaksRun({ kind: 'dropped' }, 'ID', true, ['`id`']), 'uniqueKey');
        assert.strictEqual(breaksRun({ kind: 'dropped' }, 'note', true, ['id']), 'table');
        assert.strictEqual(breaksRun({ kind: 'typeChanged', from: 'INT64', to: 'STRING' }, 'id', true, ['id']), undefined);
        assert.strictEqual(breaksRun({ kind: 'dropped' }, 'id', false, ['id']), undefined);

        const snapshot: ImpactCandidate = {
            table: 'p.marts.snap', type: 'incremental', ownRun: true, uniqueKey: ['id'],
            prod: [{ name: 'id', type: 'INT64' }, { name: 'note', type: 'STRING' }, { name: 'day', type: 'DATE' }],
            dev: [{ name: 'day', type: 'DATE' }],
            // The base already dropped note, keyed on it too
            base: [{ name: 'id', type: 'INT64' }, { name: 'day', type: 'DATE' }], baseOwnRun: true, baseUniqueKey: ['id'],
        };
        const result = await buildImpactSummary([snapshot], fakeSource({}), context());
        const columns = Object.fromEntries(result!.atRisk[0].columns.map((column) => [column.column, column.change]));
        assert.deepStrictEqual(columns.id, { kind: 'dropped', breaksRun: 'uniqueKey' });
        assert.deepStrictEqual(columns.note, { kind: 'dropped', onBase: true, breaksRun: 'table', baseBreaksRun: 'table' });
        assert.strictEqual(impactSeverity(columns.id, []), 'critical', 'nothing reads it, but its own run fails');
        assert.strictEqual(impactSeverity(columns.note, []), 'low');
        // A table the branch makes incremental: the base's drop breaks a run the base didn't have
        assert.strictEqual(impactSeverity({ kind: 'dropped', onBase: true, breaksRun: 'table' }, []), 'critical');
        assert.strictEqual(impactSeverity({ kind: 'dropped', onBase: true, breaksRun: 'table', baseBreaksRun: 'uniqueKey' }, []), 'low', 'it fixes the base\'s worse break');
        const markdown = impactMarkdown({ status: 'ready', changedCount: 1, ...result! });
        assert.ok(markdown.includes('**Its own incremental run fails every time: `uniqueKey` still names `id`, which its query no longer returns.**'), markdown);
        assert.ok(markdown.includes("Its own incremental run fails, as on the base branch: Dataform's MERGE or INSERT names `note`"), markdown);
    });

    test('says what a renamed table with nothing to lose was renamed from', () => {
        assert.strictEqual(newNote({ table: 'p.sales.orders', type: 'table', columns: [], new: true, renamedFrom: 'p.marts.orders' }), 'renamed from `marts.orders`; nothing reads it yet');
        assert.strictEqual(newNote({ table: 'p.sales.orders', type: 'table', columns: [], new: true, renamedFrom: 'p.marts.orders', fromOld: true, added: ['channel'] }),
            'renamed from `marts.orders`, keeps every column and adds `channel`');
        assert.strictEqual(newNote({ table: 'p.marts.fresh', type: 'table', columns: [], new: true, readBy: ['p.marts.daily', 'p.rep.r1'] }), 'read by `marts.daily`, `rep.r1` on this branch');
        assert.strictEqual(newNote({ table: 'p.sales.orders', type: 'table', columns: [], new: true, renamedFrom: 'p.marts.orders', readBy: ['p.marts.daily'] }),
            'renamed from `marts.orders`; read by `marts.daily` on this branch');
    });

    test('lists a new action as new: with no table it has nothing to lose, and with one it is still compared', async () => {
        const result = await buildImpactSummary([
            // No table yet: not dry run, so no schemas
            { table: 'p.marts.fresh', fileName: 'definitions/fresh.sqlx', type: 'table', new: true, noTable: true },
            // A table is already there, e.g. a run of the branch built it: every column survives
            { ...unchanged, table: 'p.marts.back', new: true },
            // ...or one doesn't, and it is at risk like any other table
            { ...orders, new: true },
        ], fakeSource({}), context());

        assert.ok(result);
        assert.deepStrictEqual(result.new, [
            { table: 'p.marts.back', fileName: unchanged.fileName, type: 'view', columns: [], added: ['orders'], new: true, exists: true },
            { table: 'p.marts.fresh', fileName: 'definitions/fresh.sqlx', type: 'table', columns: [], new: true },
        ]);
        assert.deepStrictEqual(result.atRisk.map((entry) => [entry.table, entry.new]), [['p.marts.orders', true]]);
        assert.deepStrictEqual([result.safe, result.unchecked], [[], []]);

        const view: ImpactView = { status: 'ready', changedCount: 3, ...result, against: ['p'] };
        assert.strictEqual(summaryCounts(view), '3 changed · 0 at risk · 1 low · 2 new');
        assert.deepStrictEqual([newNote(result.new[0]), newNote(result.new[1])], ['table already in `p`, keeps every column and adds `orders`', 'nothing reads it yet']);
        const lines = impactMarkdown(view).split('\n');
        assert.ok(lines.includes('**Target model:** `marts.orders` (new on this branch)'));
        const start = lines.indexOf('<details><summary>New (2)</summary>');
        assert.deepStrictEqual(lines.slice(start + 2, start + 4), ['- `marts.back`: table already in `p`, keeps every column and adds `orders`', '- `marts.fresh`: nothing reads it yet']);
    });

    test('says when it compared with the default targets because prodCompilerOptions is not set', () => {
        const view: ImpactView = { status: 'ready', changedCount: 0, atRisk: [], safe: [], new: [], unchecked: [], against: ['acme-dev'] };
        assert.ok(!impactMarkdown(view).includes('<sub>'), 'no hint when the setting is set');
        const hint = 'Compared with the project\'s default targets (`acme-dev`), which may be dev tables. Set `prodCompilerOptions` to compare with prod.';
        assert.strictEqual(unsetHint({ ...view, unset: 'prodCompilerOptions' }), hint);
        assert.ok(impactMarkdown({ ...view, unset: 'prodCompilerOptions' }).endsWith(`\n\n<sub>${hint}</sub>`));
    });

    test('settles a deleted table read only by an assertion the branch deletes too, in prod and in a dev run', async () => {
        const source = fakeSource({}, {
            'p.marts.snap': [
                { table: 'p.marts_assertions.compare_snap', dependencyType: 'TABLE_ONLY' },
                { table: 'dev.marts_assertions.compare_snap', dependencyType: 'TABLE_ONLY' },
                { table: 'dev.marts_assertions.orders_nonNull', dependencyType: 'TABLE_ONLY' },
                { table: 'dev.scratch.someone_else', dependencyType: 'TABLE_ONLY' },
            ],
        });
        const ctx: ReaderContext = {
            ...context(),
            toProd: (table) => ({
                'dev.marts_assertions.compare_snap': 'p.marts_assertions.compare_snap',
                'dev.marts_assertions.orders_nonNull': 'p.marts_assertions.orders_nonNull',
            } as Record<string, string>)[table] ?? table,
            deleted: new Set(['p.marts.snap', 'p.marts_assertions.compare_snap']),
            isAssertion: (table) => table === 'p.marts_assertions.orders_nonNull',
        };
        const result = await buildImpactSummary([{ table: 'p.marts.snap', type: 'table', deleted: true }], source, ctx);
        const snap = result!.atRisk[0];
        assert.deepStrictEqual(snap.readers, [
            { table: 'dev.scratch.someone_else', dependencyType: 'TABLE_ONLY' },
            { table: 'p.marts_assertions.compare_snap', dependencyType: 'TABLE_ONLY', deletedOnBranch: true },
        ], 'one row for both runs of the deleted assertion; an assertion still on the branch left out; an unknown dev reader kept');
        snap.readers = snap.readers!.filter((reader) => reader.deletedOnBranch);
        assert.strictEqual(isLowImpact(snap), true);
        assert.strictEqual(summaryCounts({ changedCount: 1, atRisk: [snap], new: [], unchecked: [] }), '1 changed · 0 at risk · 1 low');
        assert.ok(impactMarkdown({ status: 'ready', changedCount: 1, atRisk: [snap], safe: [], new: [], unchecked: [] })
            .includes('| *whole table* | **TABLE DELETED** | ℹ️ LOW | none left (+1 deleted here) | — |'));
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
        new: [],
        unchecked: [{ table: 'p.marts.ops', reason: 'operation: a dry run of a script has no schema' }],
    };

    test('has one table per model with change, severity, downstream reader tables and direct copies', () => {
        const lines = impactMarkdown(view).split('\n');
        assert.deepStrictEqual(lines.slice(0, 5), [
            '### Dataform Column Lineage Impact Report',
            '',
            '**Branch:** `feat/x` vs `origin/main` @ `52863aa` | **Evaluated against:** production schemas',
            '',
            '3 changed · 1 at risk · 1 low · 1 not checked',
        ]);
        assert.ok(lines.includes('**Target model:** `marts.orders`'));
        assert.ok(lines.includes('| Column | Change | Severity | Downstream | Direct copies |'));
        assert.ok(lines.includes('| `discount` | **DROPPED** | 🚨 **CRITICAL** | 8 models, 1 outside project (+1 probably updated) | `fin.margins` *(outside)*, `rep.r0`, `rep.r1`, `rep.r2`, `rep.r3`, +3 more |'));
        assert.ok(lines.includes('| `amount` | `FLOAT64 → NUMERIC` | ⚠️ **WARNING** | 1 model | — |'));
        assert.ok(lines.includes('| `note` | **DROPPED** | ❔ UNKNOWN | lookup failed: No access \\| denied | — |'), 'pipes escaped');
        assert.ok(lines.includes('| *whole table* | **TABLE DELETED** | ℹ️ LOW | none left (+1 probably updated) | — |'), 'nothing left reading it');
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

    test('names the project of copies outside the changed table\'s project', () => {
        const markdown = impactMarkdown({
            status: 'ready',
            changedCount: 1,
            atRisk: [{
                table: 'p.marts.orders',
                type: 'table',
                columns: [{ column: 'id', change: { kind: 'dropped' }, readers: [{ table: 'dev.scratch.copy', column: 'id', dependencyType: 'EXACT_COPY' }] }],
            }],
            safe: [],
            new: [],
            unchecked: [],
        });
        assert.ok(markdown.includes('| `id` | **DROPPED** | 🚨 **CRITICAL** | 1 outside project | `dev.scratch.copy` *(outside)* |'));
        assert.ok(markdown.includes('| `id` | `dev.scratch.copy` | `id` | copy | outside project |'));
    });

    test('lists who reads each column below its model, a page of reader tables per column', () => {
        const lines = impactMarkdown(view).split('\n');
        const start = lines.indexOf('<details><summary>Readers (11)</summary>');
        assert.ok(start > lines.indexOf('**Target model:** `marts.orders`') && start < lines.indexOf('**Target model:** `marts.customers`'), 'right after its model');
        assert.deepStrictEqual(lines.slice(start + 2, start + 5), [
            '| Column | Reader | Reads | Link | On this branch |',
            '| --- | --- | --- | --- | --- |',
            '| `discount` | `fin.margins` | `discount` | copy | outside project |',
        ]);
        assert.ok(lines.includes('| `discount` | `marts.revenue` | `net` | derived or filtered | probably updated |'));
        assert.ok(lines.includes('| *whole table* | `marts.revenue` | — | reads the table | probably updated |'));

        const many = Array.from({ length: MARKDOWN_READER_LIST + 3 }, (_, i) => ({ table: `p.rep.r${i}`, column: 'x', dependencyType: 'OTHER' as const, filePath: `r${i}.sqlx` }));
        const wide = ['a', 'b', 'c', 'd', 'e'].map((column) => ({ table: 'p.rep.wide', column, dependencyType: 'OTHER' as const, filePath: 'w.sqlx' }));
        const markdown = impactMarkdown({
            status: 'ready',
            changedCount: 1,
            atRisk: [{ table: 'p.marts.orders', type: 'table', columns: [{ column: 'a', change: { kind: 'dropped' }, readers: [...wide, ...many] }] }],
            safe: [],
            new: [],
            unchecked: [],
        });
        assert.ok(markdown.includes('| `a` | `rep.wide` | `a`, `b`, `c`, +2 more | derived or filtered |  |'));
        assert.ok(markdown.includes('| `a` | +4 more | | | |'));
    });

    test('names the projects it compared with, when it knows them', () => {
        const one = impactMarkdown({ ...view, against: ['acme-prod'] }).split('\n');
        assert.strictEqual(one[2], '**Branch:** `feat/x` vs `origin/main` @ `52863aa` | **Evaluated against:** tables in `acme-prod`');
        assert.ok(one.includes('<details><summary>2 changed tables keep every column they have in `acme-prod`</summary>'));
        const two = impactMarkdown({ ...view, comparison: undefined, against: ['acme-dev', 'acme-prod'] }).split('\n');
        assert.strictEqual(two[2], '**Evaluated against:** tables in `acme-dev`, `acme-prod`');
        assert.strictEqual(impactMarkdown({ ...view, against: [] }).split('\n')[2], '**Branch:** `feat/x` vs `origin/main` @ `52863aa` | **Evaluated against:** production schemas');
        assert.strictEqual(safeSummary(1, ['acme-prod']), '1 changed table keeps every column it has in `acme-prod`');
        assert.strictEqual(safeSummary(2, ['acme-dev', 'acme-prod']), '2 changed tables keep every column they have in `acme-dev`, `acme-prod`');
        assert.strictEqual(safeSummary(2, []), '2 changed tables keep every prod column');
        assert.deepStrictEqual(projectsOf(['b.marts.x', 'a.marts.y', 'b.marts.z']), ['a', 'b']);
    });

    test('rates severity by what is still read', () => {
        const reader = { table: 'p.a.b', dependencyType: 'OTHER' as const };
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [reader]), 'critical');
        assert.strictEqual(impactSeverity('deleted', [reader]), 'critical');
        assert.strictEqual(impactSeverity({ kind: 'typeChanged', from: 'INT64', to: 'STRING' }, [reader]), 'warning');
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [{ ...reader, probablyUpdated: true }]), 'low');
        assert.strictEqual(impactSeverity('deleted', [{ ...reader, deletedOnBranch: true }]), 'low');
        assert.strictEqual(impactSeverity({ kind: 'dropped' }, [], 'boom'), 'unknown');
    });
});

suite('Column impact summary: host helpers', () => {
    test('guesses a deleted table\'s prod dataset from a table that shared its dev dataset', () => {
        const devToProd: [string, string][] = [['dev-proj.marts_ashish.orders', 'prod-proj.marts.orders']];
        assert.strictEqual(guessProdTarget('dev-proj.marts_ashish.customers', devToProd), 'prod-proj.marts.customers');
        assert.strictEqual(guessProdTarget('dev-proj.other.customers', devToProd), undefined, 'no table shared its dev dataset');
    });

    const target = (database: string, schema: string, name: string) => ({ database, schema, name });
    const devIndex = new Map(['dev.marts.orders', 'dev.marts.scratch'].map((fqn) => [fqn, { fqn, type: 'table', dependsOn: [] }]));
    const devToProd = matchProdTargets(
        [{ target: target('dev', 'marts', 'orders') }, { target: target('dev', 'marts', 'scratch') }],
        new Map([['marts.orders', target('prod', 'marts', 'orders')]]),
    );

    test('has no Prod Target for an action the prodCompilerOptions compile doesn\'t match', () => {
        const strict = prodIndexOf(devIndex, devToProd, true);
        assert.strictEqual(strict.prodTarget('dev.marts.orders'), 'prod.marts.orders');
        assert.strictEqual(strict.prodTarget('dev.marts.scratch'), undefined);
        assert.strictEqual(strict.toProd('dev.marts.scratch'), 'dev.marts.scratch', 'readers still fold by dev target');
        assert.deepStrictEqual([...strict.index.keys()], ['prod.marts.orders', 'dev.marts.scratch']);
        const defaults = prodIndexOf(devIndex, devToProd, false);
        assert.strictEqual(defaults.prodTarget('dev.marts.scratch'), 'dev.marts.scratch', 'without prodCompilerOptions dev is prod, as before');
    });

    const deps = (prodTarget: CheckDeps['prodTarget'], tables: Record<string, { columns?: { name: string; type: string }[]; error?: string }>): CheckDeps & { reads: string[] } => {
        const reads: string[] = [];
        return {
            reads,
            prodTarget,
            read: async (table) => {
                reads.push(table);
                return tables[table] ?? {};
            },
            dryRun: async () => ({ fields: [{ name: 'order_id', type: 'INT64' }] }),
        };
    };
    const orders = { target: 'dev.marts.orders', fileName: 'definitions/orders.sqlx', type: 'table' };
    const scratch = { target: 'dev.marts.scratch', fileName: 'definitions/scratch.sqlx', type: 'table' };
    const action = { type: 'table', query: 'SELECT 1 AS order_id' };

    test('leaves an action with no Prod Target unchecked instead of comparing it with its dev table', async () => {
        const strict = prodIndexOf(devIndex, devToProd, true);
        const fake = deps(strict.prodTarget, {
            'prod.marts.orders': { columns: [{ name: 'order_id', type: 'INT64' }, { name: 'discount', type: 'NUMERIC' }] },
            'dev.marts.scratch': { columns: [{ name: 'order_id', type: 'INT64' }] },
        });
        const candidates = [
            await checkChanged(orders, action, fake),
            await checkChanged(scratch, action, fake),
            await checkDeleted({ target: 'dev.other.gone', type: 'table' }, undefined, fake.read),
        ];
        assert.deepStrictEqual(fake.reads, ['prod.marts.orders'], 'the dev table is never read');
        assert.deepStrictEqual(candidates[1], { table: 'dev.marts.scratch', fileName: 'definitions/scratch.sqlx', type: 'table', uncheckedReason: UNKNOWN_PROD_TARGET });
        assert.strictEqual(candidates[2].uncheckedReason, 'deleted, and its prod table is unknown: nothing in the compile with prodCompilerOptions matches it');

        const result = await buildImpactSummary(candidates, fakeSource({}), context());
        assert.deepStrictEqual(result!.atRisk.map((entry) => entry.table), ['prod.marts.orders']);
        assert.deepStrictEqual(result!.safe, []);
        assert.deepStrictEqual(result!.unchecked.map((entry) => entry.table), ['dev.marts.scratch', 'dev.other.gone']);
        const markdown = impactMarkdown({ status: 'ready', changedCount: 3, ...result!, against: projectsOf(['prod.marts.orders']) });
        assert.ok(markdown.includes('**Evaluated against:** tables in `prod`'));
        assert.ok(markdown.includes('- `marts.scratch`: its prod table is unknown: nothing in the compile with prodCompilerOptions matches it'));
    });

    test('does not dry run an action the base does not have while it has no table', async () => {
        let dryRuns = 0;
        const fake = deps((dev) => dev.replace(/^dev\./, 'prod.'), { 'prod.marts.scratch': { columns: [{ name: 'order_id', type: 'INT64' }] } });
        const counting: CheckDeps = { ...fake, dryRun: async (a) => { dryRuns++; return fake.dryRun(a); } };
        const fresh = await checkChanged({ ...orders, reasons: ['new'] }, action, counting);
        assert.deepStrictEqual(fresh, { table: 'prod.marts.orders', fileName: 'definitions/orders.sqlx', type: 'table', new: true, noTable: true });
        assert.strictEqual(dryRuns, 0);
        // Its table is already there: compared like any other
        const built = await checkChanged({ ...scratch, reasons: ['new'] }, action, counting);
        assert.deepStrictEqual([built.new, built.noTable, built.dev?.length, dryRuns], [true, undefined, 1, 1]);
    });

    test('compares a renamed action with the table it had while its own isn\'t built', async () => {
        const fake = deps((dev) => dev.replace(/^dev\./, 'prod.'), {
            'prod.marts.orders': { columns: [{ name: 'order_id', type: 'INT64' }, { name: 'discount', type: 'NUMERIC' }] },
        });
        const moved = { target: 'dev.sales.orders', fileName: 'definitions/orders.sqlx', type: 'table', reasons: ['new'], renamedFrom: 'dev.marts.orders' };
        const candidate = await checkChanged(moved, action, fake, 'prod.marts.orders');
        assert.deepStrictEqual(fake.reads, ['prod.sales.orders', 'prod.marts.orders']);
        assert.deepStrictEqual([candidate.table, candidate.target, candidate.fromOld, candidate.renamedFrom, candidate.prod?.length], ['prod.sales.orders', 'prod.marts.orders', true, 'prod.marts.orders', 2]);

        const gone = await checkDeleted({ target: 'dev.marts.orders', type: 'table', renamedTo: 'dev.sales.orders' }, 'prod.marts.orders', fake.read, 'prod.sales.orders');
        assert.deepStrictEqual([gone.deleted, gone.renamedTo, gone.named], [true, 'prod.sales.orders', 'dev.marts.orders']);
        const unknown = await checkDeleted({ target: 'dev.marts.orders', type: 'table', renamedTo: 'dev.sales.orders' }, undefined, fake.read, 'prod.sales.orders');
        assert.strictEqual(unknown.uncheckedReason, `renamed to prod.sales.orders, and ${UNKNOWN_PROD_TARGET}`);
    });

    test('dry runs the action at the merge-base only when the branch drops or retypes a column', async () => {
        const dryRuns: string[] = [];
        const base = { type: 'incremental', query: 'SELECT 1 AS order_id', uniqueKey: ['order_id'] };
        const fake: CheckDeps = {
            ...deps((dev) => dev.replace(/^dev\./, 'prod.'), { 'prod.marts.orders': { columns: [{ name: 'order_id', type: 'INT64' }, { name: 'discount', type: 'NUMERIC' }] } }),
            dryRun: async (a) => {
                dryRuns.push(a.query ?? '');
                return { fields: [{ name: 'order_id', type: 'INT64' }] };
            },
            baseAction: (target) => target === 'dev.marts.orders' ? base : undefined,
        };
        const candidate = await checkChanged(orders, { ...action, type: 'incremental', uniqueKey: ['order_id'] }, fake);
        assert.deepStrictEqual(dryRuns, ['SELECT 1 AS order_id', 'SELECT 1 AS order_id'], 'the branch, then the base');
        assert.deepStrictEqual([candidate.ownRun, candidate.uniqueKey, candidate.base?.length, candidate.baseOwnRun, candidate.baseUniqueKey], [true, ['order_id'], 1, true, ['order_id']]);

        dryRuns.length = 0;
        const kept = await checkChanged(orders, action, { ...fake, read: async () => ({ columns: [{ name: 'order_id', type: 'INT64' }] }) });
        assert.deepStrictEqual([dryRuns.length, kept.base], [1, undefined], 'nothing dropped, so the base is not dry run');
    });

    test('names the project with no such table, and why a table could not be read', async () => {
        const fake = deps((dev) => dev.replace(/^dev\./, 'prod.'), { 'prod.marts.scratch': { error: 'Access Denied: Table prod:marts.scratch' } });
        assert.strictEqual((await checkChanged(orders, action, fake)).uncheckedReason, 'no table in prod yet');
        assert.strictEqual((await checkChanged(scratch, action, fake)).uncheckedReason, 'prod.marts.scratch could not be read: Access Denied: Table prod:marts.scratch');
        assert.strictEqual((await checkDeleted(orders, 'prod.marts.orders', fake.read)).uncheckedReason, 'deleted, and no table in prod');
        assert.strictEqual((await checkDeleted(scratch, 'prod.marts.scratch', fake.read)).uncheckedReason, 'deleted, and prod.marts.scratch could not be read: Access Denied: Table prod:marts.scratch');
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

    test('changes signature when only an incremental table\'s incremental query or post operations do', () => {
        const graph = (extra: object) => ({
            tables: [{ type: 'incremental', target: { database: 'p', schema: 'marts', name: 'orders' }, query: 'SELECT 1 AS a', ...extra }],
        }) as unknown as DataformCompiledJson;
        const diff = { changed: [{ target: 'p.marts.orders', reasons: ['sql'] }], deleted: [] } as any;
        const before = changeSignature(diff, graph({ incrementalQuery: 'SELECT 1 AS a WHERE x', postOps: ['SELECT 1'] }));
        assert.notStrictEqual(changeSignature(diff, graph({ incrementalQuery: 'SELECT 1 AS b WHERE x', postOps: ['SELECT 1'] })), before);
        assert.notStrictEqual(changeSignature(diff, graph({ incrementalQuery: 'SELECT 1 AS a WHERE x', postOps: ['SELECT 2'] })), before);
    });
});
