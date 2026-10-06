import * as assert from 'assert';
import { suite, test } from 'mocha';
import { applyDeferral, applyDeferralToAction, buildProdTargetMap, builtInDevHint, collectCandidates, computeRunSet, proxyViewSpec, decideDeferral, DeferralCandidate, DeferralEntry, deferralEntryHint, findAccessDeniedTargets, indexGraphActions, isRoutineOperation, matchRef, prodKey, prodMatchesDev, proxyViewAction, rewriteSql } from '../../defer/deferRules';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { dryRunAction } from '../../bigquery/dryRunService';
import { previewQuery } from '../../bigquery/preview';
import { titledSections } from '../../shared/compiledGraph';
import { findRefs } from '../../documentSymbols';
import { createCompilerOptionsObjectForApi } from '../../utils/dataformCompiler';
import { DataformCompiledJson, QueryMeta, Target } from '../../types';

const dev = (name: string, schema = 'sales_dev'): Target => ({ database: 'proj-dev', schema, name });
const prod = (name: string, schema = 'sales'): Target => ({ database: 'proj-prod', schema, name });
const canonical = (name: string): Target => ({ database: 'proj-dev', schema: 'sales', name });

function graph(parts: Partial<Record<'tables' | 'operations' | 'assertions' | 'declarations', unknown[]>>): DataformCompiledJson {
    return { tables: [], operations: [], assertions: [], notebooks: [], declarations: [], tests: [], targets: [], ...parts } as unknown as DataformCompiledJson;
}

function deferred(name: string): DeferralEntry {
    return { dev: dev(name), prod: prod(name), status: 'deferred' };
}

function queryMeta(sql: string): QueryMeta {
    return {
        type: 'table',
        preOpsQuery: sql,
        postOpsQuery: sql,
        incrementalPreOpsQuery: sql,
        assertionQuery: sql,
        operationsQuery: sql,
        testQuery: sql,
        expectedOutputQuery: sql,
        error: '',
        tableQueries: [{ targetName: 't', query: sql, preOpsQuery: sql }],
        incrementalQueries: [{ targetName: 'i', incrementalQuery: sql, nonIncrementalQuery: sql, preOpsQuery: sql, incrementalPreOpsQuery: sql }],
        assertionQueries: [{ targetName: 'a', query: sql }],
        operationQueries: [{ targetName: 'o', query: sql, preOpsQuery: sql }],
        testQueries: [{ name: 'test', testQuery: sql, expectedOutputQuery: sql }],
    } as QueryMeta;
}

suite('deferRules.rewriteSql', () => {
    test('rewrites only backtick-quoted refs of deferred entries', () => {
        const sql = 'SELECT * FROM `proj-dev.sales_dev.orders`\nJOIN `proj-dev.sales_dev.customers` USING (id)\n-- proj-dev.sales_dev.orders';
        const rewritten = rewriteSql(sql, [deferred('orders'), { dev: dev('customers'), status: 'missingEverywhere' }]);
        assert.strictEqual(rewritten, 'SELECT * FROM `proj-prod.sales.orders`\nJOIN `proj-dev.sales_dev.customers` USING (id)\n-- proj-dev.sales_dev.orders');
    });

    test('keeps the line count, leaves UDF names alone and is idempotent', () => {
        const sql = 'SELECT `proj-dev`.sales_dev.orders(x)\nFROM `proj-dev.sales_dev.orders`\nWHERE 1 = 1';
        const once = rewriteSql(sql, [deferred('orders')]);
        assert.strictEqual(once.split('\n').length, sql.split('\n').length);
        assert.ok(once.startsWith('SELECT `proj-dev`.sales_dev.orders(x)'));
        assert.strictEqual(rewriteSql(once, [deferred('orders')]), once);
    });

    test('does not treat a longer table name as a match', () => {
        const sql = 'FROM `proj-dev.sales_dev.orders_v2`';
        assert.strictEqual(rewriteSql(sql, [deferred('orders')]), sql);
    });
});

suite('deferRules.applyDeferral', () => {
    test('rewrites every executable query but not unit tests, without changing the input', () => {
        const sql = 'FROM `proj-dev.sales_dev.orders`';
        const input = queryMeta(sql);
        const output = applyDeferral(input, [deferred('orders')]);
        const expected = 'FROM `proj-prod.sales.orders`';

        assert.strictEqual(output.preOpsQuery, expected);
        assert.strictEqual(output.postOpsQuery, expected);
        assert.strictEqual(output.incrementalPreOpsQuery, expected);
        assert.strictEqual(output.assertionQuery, expected);
        assert.strictEqual(output.operationsQuery, expected);
        assert.deepStrictEqual(output.tableQueries[0], { targetName: 't', query: expected, preOpsQuery: expected });
        assert.deepStrictEqual(output.incrementalQueries[0], { targetName: 'i', incrementalQuery: expected, nonIncrementalQuery: expected, preOpsQuery: expected, incrementalPreOpsQuery: expected });
        assert.strictEqual(output.assertionQueries[0].query, expected);
        assert.deepStrictEqual(output.operationQueries[0], { targetName: 'o', query: expected, preOpsQuery: expected });
        assert.strictEqual(output.testQuery, sql);
        assert.strictEqual(output.testQueries[0].testQuery, sql);
        assert.deepStrictEqual(input, queryMeta(sql));
    });
});

suite('deferRules.prodKey', () => {
    test('matches an action across a dev compile with suffix/prefix and a prod compile with another database', () => {
        const devAction = { target: { database: 'proj-dev', schema: 'sales_aalex', name: 'tmp_orders' }, canonicalTarget: canonical('orders') };
        const prodAction = { target: prod('orders'), canonicalTarget: prod('orders') };
        assert.strictEqual(prodKey(devAction), prodKey(prodAction));
    });
});

suite('deferRules.buildProdTargetMap', () => {
    const clicks = (database: string): Target => ({ database, schema: 'events', name: 'clicks' });
    const prodGraph = graph({
        declarations: [
            { target: clicks('raw-proj'), canonicalTarget: clicks('raw-proj') },
            { target: clicks('warehouse-proj'), canonicalTarget: clicks('warehouse-proj') },
        ],
    });

    test('matches actions sharing a schema and name across databases only by their database', () => {
        const prodTargets = buildProdTargetMap(prodGraph);
        const devActions = indexGraphActions(graph({ declarations: [{ target: clicks('raw-proj'), canonicalTarget: clicks('raw-proj') }] }));
        const selected = [{ type: 'table', target: dev('report'), dependencyTargets: [clicks('raw-proj')] }];
        assert.deepStrictEqual(collectCandidates(selected, devActions, prodTargets), []);
        assert.strictEqual(prodTargets.has('events.clicks'), false);
    });
});

suite('deferRules.collectCandidates and decideDeferral', () => {
    const devGraph = graph({
        tables: [
            { type: 'table', target: dev('orders'), canonicalTarget: canonical('orders') },
            { type: 'table', target: dev('customers'), canonicalTarget: canonical('customers') },
            { type: 'table', target: dev('report'), canonicalTarget: canonical('report') },
            { type: 'table', target: dev('new_on_branch'), canonicalTarget: canonical('new_on_branch') },
        ],
        operations: [{ type: 'operations', hasOutput: false, target: dev('cleanup'), canonicalTarget: canonical('cleanup') }],
        declarations: [{ target: { database: 'lake', schema: 'raw', name: 'events' }, canonicalTarget: { database: 'lake', schema: 'raw', name: 'events' } }],
    });
    const prodGraph = graph({
        tables: [
            { type: 'table', target: prod('orders'), canonicalTarget: prod('orders') },
            { type: 'table', target: prod('customers'), canonicalTarget: prod('customers') },
            { type: 'table', target: prod('report'), canonicalTarget: prod('report') },
        ],
        declarations: [{ target: { database: 'lake', schema: 'raw', name: 'events' }, canonicalTarget: { database: 'lake', schema: 'raw', name: 'events' } }],
    });
    const selected = [{
        type: 'table',
        target: dev('report'),
        dependencyTargets: [dev('orders'), dev('customers'), dev('cleanup'), dev('new_on_branch'), { database: 'lake', schema: 'raw', name: 'events' }, dev('report')],
    }];

    test('skips selected actions, operations without output and upstream tables that are the same in dev and prod', () => {
        const candidates = collectCandidates(selected, indexGraphActions(devGraph), buildProdTargetMap(prodGraph));
        assert.deepStrictEqual(candidates, [
            { dev: dev('orders'), prod: prod('orders') },
            { dev: dev('customers'), prod: prod('customers') },
            { dev: dev('new_on_branch'), prod: undefined },
        ] as DeferralCandidate[]);
    });

    test('defers only what is missing in dev and readable in prod', () => {
        const candidates: DeferralCandidate[] = [
            { dev: dev('built_in_dev'), prod: prod('built_in_dev') },
            { dev: dev('orders'), prod: prod('orders') },
            { dev: dev('customers'), prod: prod('customers') },
            { dev: dev('not_in_prod'), prod: prod('not_in_prod') },
            { dev: dev('new_on_branch') },
        ];
        const entries = decideDeferral(candidates, {
            devExists: (target) => target.name === 'built_in_dev',
            prodStatus: (target) => target.name === 'orders' ? 'exists' : target.name === 'customers' ? 'unreadable' : 'missing',
        });
        assert.deepStrictEqual(entries.map((entry) => [entry.dev.name, entry.status]), [
            ['orders', 'deferred'],
            ['customers', 'unreadable'],
            ['not_in_prod', 'missingEverywhere'],
            ['new_on_branch', 'missingEverywhere'],
        ]);
    });
});

suite('deferRules.prodMatchesDev', () => {
    const lake = { database: 'lake', schema: 'raw', name: 'events' };
    const devGraph = graph({
        tables: [{ type: 'table', target: dev('orders'), canonicalTarget: canonical('orders') }],
        operations: [
            { type: 'operations', hasOutput: true, target: dev('udf'), canonicalTarget: canonical('udf') },
            { type: 'operations', hasOutput: false, target: dev('cleanup'), canonicalTarget: canonical('cleanup') },
        ],
        declarations: [{ target: lake, canonicalTarget: lake }],
    });

    test('is true when prod names the same table as dev for every built action', () => {
        const sameGraph = graph({
            tables: [{ type: 'table', target: dev('orders'), canonicalTarget: canonical('orders') }],
            operations: [{ type: 'operations', hasOutput: true, target: dev('udf'), canonicalTarget: canonical('udf') }],
            declarations: [{ target: lake, canonicalTarget: lake }],
        });
        assert.strictEqual(prodMatchesDev(devGraph, buildProdTargetMap(sameGraph)), true);
    });

    test('is false when any built action has another prod table, or none can be matched', () => {
        const prodGraph = graph({
            tables: [{ type: 'table', target: prod('orders'), canonicalTarget: prod('orders') }],
            operations: [{ type: 'operations', hasOutput: true, target: dev('udf'), canonicalTarget: canonical('udf') }],
        });
        assert.strictEqual(prodMatchesDev(devGraph, buildProdTargetMap(prodGraph)), false);
        assert.strictEqual(prodMatchesDev(devGraph, new Map()), false);
    });
});

suite('deferRules.findAccessDeniedTargets', () => {
    test('reads the tables out of BigQuery access denied errors', () => {
        const message = 'Access Denied: Table proj-prod:sales.orders: User does not have permission to query table proj-prod:sales.orders, or perhaps it does not exist.';
        assert.deepStrictEqual(findAccessDeniedTargets(message), [prod('orders')]);
        assert.deepStrictEqual(findAccessDeniedTargets('Not found: Table proj-dev:sales_dev.orders'), []);
        assert.deepStrictEqual(findAccessDeniedTargets(undefined), []);
        assert.deepStrictEqual(findAccessDeniedTargets('Access Denied: Table proj-prod:sales.orders. User does not have permission'), [prod('orders')]);
    });
});

suite('dataformCompiler.createCompilerOptionsObjectForApi', () => {
    test('maps compiler flags, including default database and vars, to the API compilation config', () => {
        const options = createCompilerOptionsObjectForApi(['--default-database=proj-prod --schema-suffix="dev" --table-prefix=tmp --vars=env=prod,cleanupDays=30 --default-location=EU --unknown=1 --flag']);
        assert.deepStrictEqual(options, {
            defaultDatabase: 'proj-prod',
            schemaSuffix: 'dev',
            tablePrefix: 'tmp',
            vars: { env: 'prod', cleanupDays: '30' },
            defaultLocation: 'EU',
        });
    });

    test('accepts vars as JSON and returns nothing for no options', () => {
        assert.deepStrictEqual(createCompilerOptionsObjectForApi(['--vars={"env":"prod"}']), { vars: { env: 'prod' } });
        assert.deepStrictEqual(createCompilerOptionsObjectForApi([]), {});
        assert.deepStrictEqual(createCompilerOptionsObjectForApi(['']), {});
    });

    test('keeps quoted values with spaces in one option', () => {
        assert.deepStrictEqual(
            createCompilerOptionsObjectForApi(['--vars="env=prod, tier=gold" --schema-suffix=dev']),
            { vars: { env: 'prod', tier: 'gold' }, schemaSuffix: 'dev' },
        );
        assert.deepStrictEqual(
            createCompilerOptionsObjectForApi([`--vars='{"env": "prod", "tier": "gold"}'  --table-prefix=tmp`]),
            { vars: { env: 'prod', tier: 'gold' }, tablePrefix: 'tmp' },
        );
    });
});

suite('deferRules.computeRunSet', () => {
    // raw -> staging -> mart -> report, plus a test and an assertion on mart
    const action = (name: string, deps: string[], extra: Record<string, unknown> = {}) => ({
        type: 'table', fileName: `definitions/${name}.sqlx`, tags: [], target: dev(name), dependencyTargets: deps.map((d) => dev(d)), ...extra,
    });
    const g = graph({
        tables: [
            action('staging', ['raw']),
            action('mart', ['staging'], { tags: ['daily'] }),
            action('report', ['mart']),
            action('mart_test', ['mart'], { type: 'test' }),
        ],
        assertions: [{ type: 'assertion', fileName: 'definitions/mart.sqlx', tags: [], target: dev('mart_assert'), dependencyTargets: [dev('mart')] }],
        declarations: [{ target: dev('raw'), canonicalTarget: canonical('raw') }],
    });
    const names = (selection: Parameters<typeof computeRunSet>[1]) => computeRunSet(g, selection).map((a) => a.target.name).sort();
    const base = { includeDependencies: false, includeDependents: false };

    test('selects by file, tag or target id and leaves tests out', () => {
        assert.deepStrictEqual(names({ ...base, kind: 'currentFile', items: ['definitions/mart.sqlx'] }), ['mart', 'mart_assert']);
        assert.deepStrictEqual(names({ ...base, kind: 'tags', items: ['daily'] }), ['mart']);
        assert.deepStrictEqual(names({ ...base, kind: 'changed', items: ['proj-dev.sales_dev.report'] }), ['report']);
    });

    test('adds transitive dependencies or dependents when the run includes them, but never declarations', () => {
        assert.deepStrictEqual(names({ kind: 'changed', items: ['proj-dev.sales_dev.report'], includeDependencies: true, includeDependents: false }), ['mart', 'report', 'staging']);
        assert.deepStrictEqual(names({ kind: 'changed', items: ['proj-dev.sales_dev.staging'], includeDependencies: false, includeDependents: true }), ['mart', 'mart_assert', 'report', 'staging']);
    });
});

suite('deferRules.proxyViewSpec', () => {
    test('builds a labelled view at the Dev Target that reads the Prod Target', () => {
        const spec = proxyViewSpec(deferred('orders'));
        assert.deepStrictEqual(
            { projectId: spec.projectId, datasetId: spec.datasetId, tableId: spec.tableId, query: spec.query, labels: spec.labels },
            { projectId: 'proj-dev', datasetId: 'sales_dev', tableId: 'orders', query: 'SELECT * FROM `proj-prod.sales.orders`', labels: { dataform_tools_proxy: 'true' } },
        );
        assert.throws(() => proxyViewSpec({ dev: dev('new_table'), status: 'missingEverywhere' }));
    });
});

suite('deferRules.matchRef and documentSymbols.findRefs', () => {
    test('finds refs outside comments with their arguments', () => {
        const text = 'SELECT * FROM ${ref("orders")}\n/* ${ref("old")} */\nJOIN ${ref(\'sales\', \'customers\')}';
        const refs = findRefs(text);
        assert.deepStrictEqual(refs.map((ref) => ref.args), [['orders'], ['sales', 'customers']]);
        assert.strictEqual(text.slice(refs[0].index, refs[0].index + refs[0].length), '${ref("orders")}');
    });

    test('matches a ref to a dependency by canonical name, ignoring prefixes and suffixes', () => {
        const dependencies = [
            { target: { database: 'proj-dev', schema: 'sales_aalex', name: 'ABA_orders' }, canonicalTarget: canonical('orders') },
            { target: dev('customers'), canonicalTarget: canonical('customers') },
            { target: dev('customers', 'crm_dev'), canonicalTarget: { database: 'proj-dev', schema: 'crm', name: 'customers' } },
        ];
        assert.deepStrictEqual(matchRef(['orders'], dependencies), dependencies[0].target);
        assert.strictEqual(matchRef(['customers'], dependencies), undefined, 'ambiguous without a schema');
        assert.deepStrictEqual(matchRef(['crm', 'customers'], dependencies), dependencies[2].target);
        assert.strictEqual(matchRef(['missing'], dependencies), undefined);
    });
});

suite('deferRules functions and procedures', () => {
    const op = (queries: string[], hasOutput = true) => ({ type: 'operations', hasOutput, target: dev('fn'), canonicalTarget: canonical('fn'), queries });

    test('recognises operations that create a function or procedure', () => {
        assert.ok(isRoutineOperation(op(['CREATE OR REPLACE FUNCTION `proj`.ds.fn(x STRING) RETURNS STRING AS (x)'])));
        assert.ok(isRoutineOperation(op(['create temp function f() as (1); CREATE PROCEDURE ds.p() BEGIN END'])));
        assert.ok(isRoutineOperation(op(['CREATE OR REPLACE TABLE FUNCTION ds.tvf(d DATE) AS SELECT 1'])));
        assert.ok(!isRoutineOperation(op(['CREATE OR REPLACE TABLE ds.t AS SELECT 1'])));
        assert.ok(!isRoutineOperation(op(['CREATE OR REPLACE FUNCTION ds.fn() AS (1)'], false)));
        assert.ok(!isRoutineOperation({ type: 'table', target: dev('t') }));
    });

    test('flags function candidates and entries so runs build them instead of making a proxy view', () => {
        const devGraph = graph({ operations: [op(['CREATE OR REPLACE FUNCTION ds.fn() AS (1)'])] });
        const prodGraph = graph({ operations: [{ ...op([]), target: prod('fn'), canonicalTarget: prod('fn') }] });
        const candidates = collectCandidates([{ type: 'table', target: dev('report'), dependencyTargets: [dev('fn')] }], indexGraphActions(devGraph), buildProdTargetMap(prodGraph));
        assert.deepStrictEqual(candidates, [{ dev: dev('fn'), prod: prod('fn'), routine: true }]);
        const entries = decideDeferral(candidates, { devExists: () => false, prodStatus: () => 'exists' });
        assert.deepStrictEqual(entries, [{ dev: dev('fn'), prod: prod('fn'), status: 'deferred', routine: true }]);
        assert.strictEqual(rewriteSql('SELECT `proj-dev.sales_dev.fn`(x)', entries), 'SELECT `proj-prod.sales.fn`(x)');
    });
});

suite('deferRules.proxyViewAction', () => {
    const spec = proxyViewSpec(deferred('orders'));
    const proxy = (query: string) => ({ labels: { dataform_tools_proxy: 'true' }, view: { query } });

    test('creates a missing view, keeps one that already reads the Prod Target and repoints one that does not', () => {
        assert.strictEqual(proxyViewAction(undefined, spec), 'create');
        assert.strictEqual(proxyViewAction(proxy('SELECT * FROM `proj-prod.sales.orders`\n'), spec), 'keep');
        assert.strictEqual(proxyViewAction(proxy('SELECT * FROM `old-prod.sales.orders`'), spec), 'update');
    });

    test('never touches a real dev table or view', () => {
        assert.strictEqual(proxyViewAction({ view: { query: 'SELECT 1' } }, spec), 'leaveRealTable');
        assert.strictEqual(proxyViewAction({ labels: { team: 'sales' } }, spec), 'leaveRealTable');
    });
});

suite('deferRules.deferralEntryHint', () => {
    test('a deferred upstream action reads prod', () => {
        const hint = deferralEntryHint(deferred('orders'));
        assert.strictEqual(hint.label, '→ deferred to prod');
        assert.strictEqual(hint.kind, 'prod');
        assert.match(hint.hover, /not built in dev, so read from prod/);
        assert.match(hint.hover, /`proj-dev\.sales_dev\.orders`\n\n→ `proj-prod\.sales\.orders`/);
        assert.match(hint.hover, /Open prod table in BigQuery\]\(https:\/\/console\.cloud\.google\.com\/bigquery\?project=proj-prod&.*!2ssales!3sorders\)/);
    });

    test('a Stale Deferral warns that prod may be out of date', () => {
        const hint = deferralEntryHint({ ...deferred('orders'), stale: true });
        assert.strictEqual(hint.label, '⚠ prod · changed on this branch');
        assert.strictEqual(hint.kind, 'warning');
        assert.match(hint.hover, /changed on this branch, so prod may be out of date/);
        assert.match(hint.hover, /Open prod table in BigQuery/);
    });

    test('an unreadable Prod Target is not built', () => {
        const hint = deferralEntryHint({ dev: dev('orders'), prod: prod('orders'), status: 'unreadable' });
        assert.strictEqual(hint.label, '⚠ not built in dev · no prod access');
        assert.strictEqual(hint.kind, 'warning');
        assert.match(hint.hover, /no read access to prod/);
        assert.doesNotMatch(hint.hover, /Open prod table/);
    });

    test('an action missing everywhere has no prod route', () => {
        const hint = deferralEntryHint({ dev: dev('orders'), status: 'missingEverywhere' });
        assert.strictEqual(hint.label, '⚠ not built in dev or prod');
        assert.strictEqual(hint.kind, 'warning');
        assert.match(hint.hover, /not built in dev or prod/);
        assert.doesNotMatch(hint.hover, /→/);
    });

    test('a built Dev Target is read from dev', () => {
        const built = Date.UTC(2026, 9, 1, 8, 0);
        const hint = builtInDevHint({ dev: dev('orders'), lastModified: built }, built + 12 * 60_000);
        assert.strictEqual(hint.label, '✓ dev · built 12 min ago');
        assert.strictEqual(builtInDevHint({ dev: dev('orders'), lastModified: built }, built + 3 * 3_600_000).label, '✓ dev · built 3 h ago');
        assert.strictEqual(hint.kind, 'dev');
        assert.match(hint.hover, /built in dev, so read from dev/);
        assert.match(hint.hover, /`proj-dev\.sales_dev\.orders`/);
        assert.match(hint.hover, /Last updated /);
        const unknownAge = builtInDevHint({ dev: dev('orders') }, built);
        assert.strictEqual(unknownAge.label, '✓ dev · built in dev');
        assert.doesNotMatch(unknownAge.hover, /Last updated/);
    });
});

suite('deferRules.applyDeferralToAction', () => {
    const devRef = '`proj-dev.sales_dev.orders`';
    const prodRef = '`proj-prod.sales.orders`';
    const entries: DeferralEntry[] = [
        { dev: { database: 'proj-dev', schema: 'sales_dev', name: 'orders' }, prod: { database: 'proj-prod', schema: 'sales', name: 'orders' }, status: 'deferred' },
        { dev: { database: 'proj-dev', schema: 'sales_dev', name: 'customers' }, status: 'missingEverywhere' },
    ];
    const compiled = {
        tables: [{
            type: 'incremental',
            target: { database: 'proj-dev', schema: 'sales_dev', name: 'report' },
            fileName: 'definitions/report.sqlx',
            preOps: [`declare latest date default (select max(day) from ${devRef})`],
            query: `select *\nfrom ${devRef}\njoin \`proj-dev.sales_dev.customers\` using (id)`,
            postOps: [`select count(*) from ${devRef}`],
            incrementalQuery: `select * from ${devRef} where day > latest`,
            dependencyTargets: [],
        }],
        tests: [{ name: 'report_total', fileName: 'definitions/report_total.sqlx', testQuery: `select * from ${devRef}`, expectedOutputQuery: 'select 1' }],
    } as unknown as DataformCompiledJson;
    const graph = buildDataformGraph(compiled);
    const report = graph.actions['proj-dev.sales_dev.report'];

    test('every compiled section reads the Deferred Action from prod, and nothing else changes', () => {
        const deferred = applyDeferralToAction(report, entries);
        assert.notStrictEqual(deferred, report);
        assert.deepStrictEqual(deferred.sections.map((section) => section.title), report.sections.map((section) => section.title));
        for (const section of deferred.sections) {
            assert.ok(!section.sql.includes(devRef), section.title);
        }
        assert.strictEqual(deferred.sections.filter((section) => section.sql.includes(prodRef)).length, 5);
        // An upstream action that is missing everywhere keeps its dev name
        assert.ok(deferred.sections.find((section) => section.title === 'query')!.sql.includes('`proj-dev.sales_dev.customers`'));
        // The action handed in is left as it was
        assert.ok(report.sections.every((section) => !section.sql.includes(prodRef)));
        assert.deepStrictEqual({ ...deferred, sections: [] }, { ...report, sections: [] });
    });

    test('the dry-run service and the preview work from the rewritten sections without knowing of defer', async () => {
        const deferred = applyDeferralToAction(report, entries);
        const sent: string[] = [];
        const results = await dryRunAction(deferred, 1, async (sql) => {
            sent.push(sql);
            return { error: { hasError: true, message: 'Unrecognized name: nope at [3:1]', location: { line: 3, column: 1 } } };
        });
        assert.strictEqual(sent.length, 4);
        assert.ok(sent.every((sql) => sql.includes(prodRef) && !sql.includes(devRef)));
        // The rewrite keeps every newline, so an error is still placed on the right line of its section
        assert.deepStrictEqual([results[0].error?.section, results[0].error?.line], ['query', 2]);
        assert.ok(previewQuery(deferred, 'query')?.sql.includes(prodRef));
    });

    test('a unit test, SQL shown as written, and an action with nothing deferred are returned untouched', () => {
        const unitTest = graph.actions['unit test.report_total'];
        assert.strictEqual(applyDeferralToAction(unitTest, entries), unitTest);
        assert.strictEqual(applyDeferralToAction(report, [entries[1]]), report);
        assert.strictEqual(applyDeferralToAction(report, []), report);

        const hook = titledSections('pre-hook', [`grant select on ${devRef} to x`], { compiled: false, dryRun: [] });
        const model = { ...report, sections: [...hook, ...report.sections] };
        assert.strictEqual(applyDeferralToAction(model, entries).sections[0], hook[0]);
    });
});
