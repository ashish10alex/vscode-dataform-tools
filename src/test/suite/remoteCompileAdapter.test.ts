import * as assert from 'assert';
import { suite, test } from 'mocha';
import { ApiCompilationResult, ApiCompilationResultAction, toDataformCompiledJson } from '../../utils/remoteCompileAdapter';

const target = (name: string, schema = 'dataform') => ({ database: 'my-project', schema, name });

// Mirrors what the Dataform API returns: proto defaults ("" / [] / 0 / false) for unset fields
const emptyRelation = {
    dependencyTargets: [], tags: [], preOperations: [], postOperations: [], clusterExpressions: [],
    additionalOptions: {}, disabled: false, relationDescriptor: null, selectQuery: '',
    incrementalTableConfig: {
        uniqueKeyParts: [], incrementalPreOperations: [], incrementalPostOperations: [],
        incrementalSelectQuery: '', refreshDisabled: false, updatePartitionFilter: '',
    },
    partitionExpression: '', partitionExpirationDays: 0, requirePartitionFilter: false,
};

const result: ApiCompilationResult = {
    name: 'projects/my-project/locations/europe-west2/repositories/repo/compilationResults/abc',
    resolvedGitCommitSha: '0123456789abcdef',
    dataformCoreVersion: '3.0.50',
    codeCompilationConfig: {
        defaultDatabase: 'my-project', defaultSchema: 'dataform', assertionSchema: 'dataform_assertions',
        defaultLocation: 'EU', vars: { env: 'dev' }, databaseSuffix: '', schemaSuffix: '', tablePrefix: '',
        builtinAssertionNamePrefix: '', defaultNotebookRuntimeOptions: null,
    },
    compilationErrors: [],
};

const actions: ApiCompilationResultAction[] = [
    {
        target: target('orders'), canonicalTarget: target('orders'), filePath: 'definitions/orders.sqlx',
        relation: {
            ...emptyRelation,
            relationType: 'TABLE',
            selectQuery: 'SELECT 1 AS id',
            tags: ['daily'],
            dependencyTargets: [target('raw_orders', 'raw')],
            preOperations: ['DECLARE x INT64'],
            partitionExpression: 'DATE(created_at)',
            clusterExpressions: ['id'],
            relationDescriptor: { description: 'Orders', columns: [{ path: ['id'], description: 'Order id' }], bigqueryLabels: { team: 'sales' } },
        },
    },
    {
        target: target('orders_inc'), canonicalTarget: target('orders_inc'), filePath: 'definitions/orders_inc.sqlx',
        relation: {
            ...emptyRelation,
            relationType: 'INCREMENTAL_TABLE',
            selectQuery: 'SELECT * FROM raw',
            incrementalTableConfig: {
                ...emptyRelation.incrementalTableConfig,
                incrementalSelectQuery: 'SELECT * FROM raw WHERE ts > 0',
                incrementalPreOperations: ['DECLARE max_ts TIMESTAMP'],
                uniqueKeyParts: ['id'],
                refreshDisabled: true,
            },
        },
    },
    {
        target: target('orders_mv'), canonicalTarget: target('orders_mv'), filePath: 'definitions/orders_mv.sqlx',
        relation: { ...emptyRelation, relationType: 'MATERIALIZED_VIEW', selectQuery: 'SELECT 2' },
    },
    {
        target: target('orders_assertions_uniqueKey_0', 'dataform_assertions'),
        canonicalTarget: target('orders_assertions_uniqueKey_0', 'dataform_assertions'),
        filePath: 'definitions/orders.sqlx',
        assertion: {
            selectQuery: 'SELECT id FROM orders GROUP BY id HAVING COUNT(*) > 1',
            dependencyTargets: [target('orders')], parentAction: target('orders'), tags: [], disabled: false, relationDescriptor: null,
        },
    },
    {
        target: target('cleanup'), canonicalTarget: target('cleanup'), filePath: 'definitions/cleanup.sqlx',
        operations: { queries: ['DELETE FROM x WHERE true'], hasOutput: false, tags: ['ops'], dependencyTargets: [], disabled: false, relationDescriptor: null },
    },
    {
        target: target('raw_orders', 'raw'), canonicalTarget: target('raw_orders', 'raw'), filePath: 'definitions/sources.js',
        declaration: { relationDescriptor: null },
    },
    {
        target: target('report'), canonicalTarget: target('report'), filePath: 'definitions/report.ipynb',
        notebook: { contents: '{"cells":[]}', tags: [], dependencyTargets: [target('orders')], disabled: false },
    },
];

suite('remoteCompileAdapter.toDataformCompiledJson', () => {
    const compiled = toDataformCompiledJson(result, actions);

    test('maps a table like the CLI, dropping proto defaults', () => {
        assert.deepStrictEqual(compiled.tables[0], {
            type: 'table',
            target: target('orders'),
            canonicalTarget: target('orders'),
            fileName: 'definitions/orders.sqlx',
            query: 'SELECT 1 AS id',
            disabled: false,
            tags: ['daily'],
            dependencyTargets: [target('raw_orders', 'raw')],
            preOps: ['DECLARE x INT64'],
            bigquery: { partitionBy: 'DATE(created_at)', clusterBy: ['id'], labels: { team: 'sales' } },
            actionDescriptor: { description: 'Orders', columns: [{ path: ['id'], description: 'Order id' }], bigqueryLabels: { team: 'sales' } },
        });
    });

    test('maps incremental table fields', () => {
        const inc = compiled.tables[1] as any;
        assert.strictEqual(inc.type, 'incremental');
        assert.strictEqual(inc.incrementalQuery, 'SELECT * FROM raw WHERE ts > 0');
        assert.deepStrictEqual(inc.incrementalPreOps, ['DECLARE max_ts TIMESTAMP']);
        assert.deepStrictEqual(inc.uniqueKey, ['id']);
        assert.strictEqual(inc.protected, true);
    });

    test('maps materialized views to views', () => {
        const mv = compiled.tables[2] as any;
        assert.strictEqual(mv.type, 'view');
        assert.strictEqual(mv.materialized, true);
        assert.strictEqual(mv.incrementalQuery, undefined);
    });

    test('maps assertions, operations, declarations and notebooks', () => {
        assert.strictEqual(compiled.assertions[0].query, 'SELECT id FROM orders GROUP BY id HAVING COUNT(*) > 1');
        assert.deepStrictEqual((compiled.assertions[0] as any).parentAction, target('orders'));
        assert.deepStrictEqual(compiled.operations[0].queries, ['DELETE FROM x WHERE true']);
        assert.strictEqual(compiled.operations[0].hasOutput, undefined);
        assert.deepStrictEqual(compiled.declarations[0], {
            target: target('raw_orders', 'raw'), canonicalTarget: target('raw_orders', 'raw'),
            fileName: 'definitions/sources.js', tags: [], dependencyTargets: [],
        });
        assert.strictEqual(compiled.notebooks[0].notebookContents, '{"cells":[]}');
        assert.strictEqual(compiled.targets.length, actions.length);
    });

    test('builds projectConfig from the code compilation config', () => {
        assert.deepStrictEqual(compiled.projectConfig, {
            warehouse: 'bigquery', defaultDatabase: 'my-project', defaultSchema: 'dataform',
            assertionSchema: 'dataform_assertions', defaultLocation: 'EU', tablePrefix: '', vars: { env: 'dev' },
        });
        assert.strictEqual(compiled.dataformCoreVersion, '3.0.50');
        assert.deepStrictEqual(compiled.tests, []);
    });

    test('maps compilation errors to graphErrors', () => {
        const withErrors = toDataformCompiledJson({
            ...result,
            compilationErrors: [{ message: 'Could not resolve "missing"', stack: 'Error: ...', path: 'definitions/orders.sqlx', actionTarget: target('orders') }],
        }, []);
        assert.deepStrictEqual(withErrors.graphErrors.compilationErrors, [
            { fileName: 'definitions/orders.sqlx', message: 'Could not resolve "missing"', stack: 'Error: ...' },
        ]);
    });
});
