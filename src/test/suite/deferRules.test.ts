import * as assert from 'assert';
import { suite, test } from 'mocha';
import { applyDeferral, buildProdTargetMap, collectCandidates, decideDeferral, DeferralCandidate, DeferralEntry, findAccessDeniedTargets, indexGraphActions, prodKey, rewriteSql } from '../../defer/deferRules';
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
