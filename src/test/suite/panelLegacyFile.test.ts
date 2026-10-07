import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { fileSlice } from '../../panel/slices';
import { targetId } from '../../shared/compiledGraph';
import type { FileSlice } from '../../shared/panelContract';
import { MIGRATED_FILE_FIELDS, legacyModels, legacyStateFromFileSlice } from '../../shared/panelLegacyFile';
import { toLegacyState } from '../../shared/panelLegacyState';
import type { DataformCompiledJson } from '../../types';
import { findProjectRoot } from './helper';

const dataform = new DataformBackend(async () => ({}));
const compiled: DataformCompiledJson = JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'xf-examples', 'dataform.json'), 'utf8'));
const graph = buildDataformGraph(compiled);
const flatOf = (file: string): Record<string, any> => legacyStateFromFileSlice(fileSlice(graph, dataform, file, 1));
// As the panel gets it: a field without a value does not cross
const sent = (value: unknown) => JSON.parse(JSON.stringify(value));
const target = (name: string) => ({ database: 'p', schema: 'ds', name });

suite('panel: the file slice as the flat query fields the components still read', () => {
    test('a table with assertions: models in the flat state\'s shape, and the scripts joined from them', () => {
        const flat = flatOf('definitions/marts/dim_customers.sqlx');
        assert.deepStrictEqual(Object.keys(flat).sort(), [...MIGRATED_FILE_FIELDS].sort());
        assert.deepStrictEqual(flat.actionTypes, ['table', 'assertion']);
        assert.deepStrictEqual(flat.models.map((model: any) => model.type), ['table', 'assertion', 'assertion']);
        assert.strictEqual(flat.targetTablesOrViews, flat.models);
        assert.deepStrictEqual([flat.modelType, flat.isHelperFile, flat.declarations], ['table', false, null]);

        const raw = compiled.tables.find((table) => table.fileName === 'definitions/marts/dim_customers.sqlx')!;
        const [table] = flat.models;
        // The SQL is the compiled SQL without the blank lines around it
        assert.strictEqual(table.query, raw.query.replace(/^\n+|\n+$/g, ''));
        assert.strictEqual(table.preOps.length, raw.preOps!.length);
        assert.strictEqual(table.postOps.length, raw.postOps!.length);
        assert.deepStrictEqual([table.fileName, table.target, table.incrementalQuery, table.incrementalPreOps], [raw.fileName, raw.target, '', []]);
        assert.strictEqual(table.actionDescriptor.description, raw.actionDescriptor?.description);
        assert.deepStrictEqual(sent(table.dependencyTargets).map(targetId).sort(), raw.dependencyTargets!.map(targetId).sort());

        assert.strictEqual(flat.tableOrViewQuery, `${table.query}\n;`);
        assert.ok(flat.preOperations.startsWith(table.preOps[0]) && /;\s*$/.test(flat.preOperations));
        assert.ok(/;\s*$/.test(flat.postOperations));
        assert.ok(flat.assertionQuery.includes(' -- Assertions: [1] \n') && flat.assertionQuery.includes(' -- Assertions: [2] \n'));
        assert.deepStrictEqual([flat.incrementalQuery, flat.nonIncrementalQuery, flat.incrementalPreOpsQuery, flat.operationsQuery, flat.testQuery, flat.expectedOutputQuery], ['', '', '', '', '', '']);
        // The dependents of the first action, as Targets
        assert.ok(flat.dependents.length > 0 && flat.dependents.every((dependent: object) => Object.keys(dependent).sort().join() === 'database,name,schema'));
    });

    test('an incremental table has both variants', () => {
        const flat = flatOf('definitions/marts/fct_orders.sqlx');
        const [model] = flat.models;
        assert.strictEqual(model.type, 'incremental');
        assert.ok(model.query && model.incrementalQuery && model.query !== model.incrementalQuery);
        assert.deepStrictEqual([flat.nonIncrementalQuery, flat.incrementalQuery, flat.tableOrViewQuery], [model.query, model.incrementalQuery, '']);
        assert.ok(model.preOps.length > 0 && flat.preOperations !== '');
    });

    test('an operation is numbered statement by statement, and says whether it builds a table', () => {
        const withOutput = flatOf('definitions/operations/audit_log.sqlx');
        assert.deepStrictEqual([withOutput.modelType, withOutput.actionTypes, withOutput.models[0].hasOutput], ['operations', ['operations'], true]);
        assert.ok(withOutput.models[0].query.startsWith('\n -- Operations: [1] \n'));
        assert.strictEqual(withOutput.operationsQuery, withOutput.models[0].query);
        assert.strictEqual(flatOf('definitions/operations/create_udf.sqlx').models[0].hasOutput, undefined);
    });

    test('a JavaScript file with several actions is of type js', () => {
        const flat = flatOf('definitions/reports/orders_by_country.js');
        assert.deepStrictEqual([flat.modelType, flat.actionTypes, flat.models.length], ['js', ['view'], 2]);
        assert.strictEqual(flat.tableOrViewQuery, flat.models.map((model: any) => `${model.query}\n;`).join('\n'));
    });

    test('a file of declarations lists them and nothing else', () => {
        const flat = flatOf('definitions/sources/declarations.js');
        assert.deepStrictEqual(Object.keys(flat).sort(), ['declarations', 'errorMessage', 'errorType', 'isHelperFile']);
        assert.deepStrictEqual(flat.declarations.map((declaration: any) => [declaration.target.name, declaration.fileName]), [['customers', 'definitions/sources/declarations.js'], ['orders', 'definitions/sources/declarations.js']]);
        assert.strictEqual(flat.isHelperFile, false);
    });

    test('a file with nothing to show clears the query fields, as the flat messages for it did', () => {
        const helper = flatOf('includes/helpers.js');
        assert.deepStrictEqual([helper.isHelperFile, helper.declarations, helper.tableOrViewQuery, helper.operationsQuery], [true, null, null, null]);
        assert.ok(!('models' in helper) && !('testQuery' in helper));
        assert.strictEqual(flatOf('workflow_settings.yaml').isHelperFile, false);

        const nothing: FileSlice = { compile: 3, file: 'definitions/broken.sqlx', role: 'not compiled', actions: [] };
        const cleared = toLegacyState({ slice: 'file', value: nothing });
        assert.deepStrictEqual([cleared.isHelperFile, cleared.declarations, cleared.models, cleared.tableOrViewQuery, cleared.testQuery, cleared.expectedOutputQuery], [false, null, null, null, null, null]);
        // What was listed for the last file is left as a flat message without it left it
        assert.ok(!('targetTablesOrViews' in cleared) && !('dependents' in cleared) && !('actionTypes' in cleared));
    });

    test('unit tests have a name and two queries; a notebook is a pointer to its file', () => {
        const withTests = buildDataformGraph({
            tables: [{ type: 'table', target: target('orders'), fileName: 'definitions/orders.js', query: 'select 1' }],
            tests: [{ name: 'orders_total', fileName: 'definitions/orders.js', testQuery: 'select 2', expectedOutputQuery: 'select 3' }],
            notebooks: [{ target: target('report'), fileName: 'definitions/report.ipynb', notebookContents: '{"cells": []}', tags: ['daily'] }],
        } as unknown as DataformCompiledJson);
        const slice = fileSlice(withTests, dataform, 'definitions/orders.js', 1, [targetId(target('report'))]);
        const flat = legacyStateFromFileSlice(slice);
        assert.deepStrictEqual(sent(flat.models), [
            { type: 'table', target: target('orders'), fileName: 'definitions/orders.js', query: 'select 1', incrementalQuery: '', incrementalPreOps: [] },
            { type: 'test', name: 'orders_total', fileName: 'definitions/orders.js', testQuery: 'select 2', expectedOutputQuery: 'select 3' },
            { type: 'notebook', tags: ['daily'], target: target('report'), fileName: 'definitions/report.ipynb', query: 'Open: definitions/report.ipynb \n' },
        ]);
        assert.deepStrictEqual([flat.testQuery, flat.expectedOutputQuery], [' -- Test: [1] orders_total \nselect 2\n ;', ' -- Test: [1] orders_total \nselect 3\n ;']);
        assert.strictEqual(flat.modelType, 'notebook');
        // Each model comes with its action, so that the host can match what it sends by position
        assert.deepStrictEqual(legacyModels(slice).map(({ action }) => action.kind), ['table', 'unit test', 'notebook']);
    });

    test('the flat state lists assertions before operations, whatever the order of the slice', () => {
        const mixed = buildDataformGraph({
            tables: [{ type: 'view', target: target('v'), fileName: 'definitions/mixed.js', query: 'select 1' }],
            operations: [{ target: target('op'), fileName: 'definitions/mixed.js', queries: ['select 2', 'select 3'] }],
            assertions: [{ target: target('check'), fileName: 'definitions/mixed.js', query: 'select 4' }],
        } as unknown as DataformCompiledJson);
        const slice = fileSlice(mixed, dataform, 'definitions/mixed.js', 1);
        assert.deepStrictEqual(slice.actions.map((action) => action.kind), ['view', 'operation', 'assertion']);
        const flat = legacyStateFromFileSlice(slice);
        assert.deepStrictEqual(flat.actionTypes, ['view', 'assertion', 'operations']);
        assert.strictEqual(flat.operationsQuery, '\n -- Operations: [1] \nselect 2\n\n -- Operations: [2] \nselect 3\n');
    });
});
