import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { fileSlice } from '../../panel/slices';
import { targetId } from '../../shared/compiledGraph';
import type { FileSlice } from '../../shared/panelContract';
import { EMPTY_FILE_VIEW, fileModels, fileViewOf } from '../../shared/panelFileView';
import type { DataformCompiledJson } from '../../types';
import { findProjectRoot } from './helper';

const dataform = new DataformBackend(async () => ({}));
const compiled: DataformCompiledJson = JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'xf-examples', 'dataform.json'), 'utf8'));
const graph = buildDataformGraph(compiled);
const viewOf = (file: string) => fileViewOf(fileSlice(graph, dataform, file, 1));
// As the panel gets it: a field without a value does not cross
const sent = (value: unknown) => JSON.parse(JSON.stringify(value));
const target = (name: string) => ({ database: 'p', schema: 'ds', name });

suite('panel: what is shown of a Dataform file', () => {
    test('a table with assertions: a model for each, and the scripts joined from them', () => {
        const view = viewOf('definitions/marts/dim_customers.sqlx');
        assert.deepStrictEqual(Object.keys(view).sort(), Object.keys(EMPTY_FILE_VIEW).sort());
        assert.deepStrictEqual(view.actionTypes, ['table', 'assertion']);
        assert.deepStrictEqual(view.models.map((model) => model.type), ['table', 'assertion', 'assertion']);
        assert.deepStrictEqual([view.isHelperFile, view.declarations], [false, null]);

        const raw = compiled.tables.find((table) => table.fileName === 'definitions/marts/dim_customers.sqlx')!;
        const [table] = view.models;
        // The SQL is the compiled SQL without the blank lines around it
        assert.strictEqual(table.query, raw.query.replace(/^\n+|\n+$/g, ''));
        assert.strictEqual(table.preOps?.length, raw.preOps!.length);
        assert.strictEqual(table.postOps?.length, raw.postOps!.length);
        assert.deepStrictEqual([table.fileName, table.target, table.incrementalQuery, table.incrementalPreOps], [raw.fileName, raw.target, '', []]);
        assert.strictEqual(table.actionDescriptor?.description, raw.actionDescriptor?.description);
        assert.deepStrictEqual(sent(table.dependencyTargets).map(targetId).sort(), raw.dependencyTargets!.map(targetId).sort());

        assert.strictEqual(view.tableOrViewQuery, `${table.query}\n;`);
        assert.ok(view.assertionQuery.includes(' -- Assertions: [1] \n') && view.assertionQuery.includes(' -- Assertions: [2] \n'));
        assert.deepStrictEqual([view.incrementalQuery, view.operationsQuery, view.testQuery, view.expectedOutputQuery], ['', '', '', '']);
        // The dependents of the first action, as Targets
        assert.ok(view.dependents.length > 0 && view.dependents.every((dependent) => Object.keys(dependent).sort().join() === 'database,name,schema'));
    });

    test('an incremental table has both variants', () => {
        const view = viewOf('definitions/marts/fct_orders.sqlx');
        const [model] = view.models;
        assert.strictEqual(model.type, 'incremental');
        assert.ok(model.query && model.incrementalQuery && model.query !== model.incrementalQuery);
        assert.deepStrictEqual([view.incrementalQuery, view.tableOrViewQuery], [model.incrementalQuery, '']);
        assert.ok((model.preOps?.length ?? 0) > 0);
    });

    test('an operation is numbered statement by statement, and says whether it builds a table', () => {
        const withOutput = viewOf('definitions/operations/audit_log.sqlx');
        assert.deepStrictEqual([withOutput.actionTypes, withOutput.models[0].hasOutput], [['operations'], true]);
        assert.ok(withOutput.models[0].query?.startsWith('\n -- Operations: [1] \n'));
        assert.strictEqual(withOutput.operationsQuery, withOutput.models[0].query);
        assert.strictEqual(viewOf('definitions/operations/create_udf.sqlx').models[0].hasOutput, undefined);
    });

    test('a JavaScript file with several actions has a model for each', () => {
        const view = viewOf('definitions/reports/orders_by_country.js');
        assert.deepStrictEqual([view.actionTypes, view.models.length], [['view'], 2]);
        assert.strictEqual(view.tableOrViewQuery, view.models.map((model) => `${model.query}\n;`).join('\n'));
    });

    test('a file of declarations lists them and nothing else', () => {
        const view = viewOf('definitions/sources/declarations.js');
        assert.deepStrictEqual([view.models, view.tableOrViewQuery], [[], '']);
        assert.deepStrictEqual(view.declarations?.map((declaration) => [declaration.target.name, declaration.fileName]), [['customers', 'definitions/sources/declarations.js'], ['orders', 'definitions/sources/declarations.js']]);
        assert.strictEqual(view.isHelperFile, false);
    });

    test('a file with nothing to show has an empty view, whatever the last file had', () => {
        const helper = viewOf('includes/helpers.js');
        assert.deepStrictEqual(helper, { ...EMPTY_FILE_VIEW, isHelperFile: true });
        assert.deepStrictEqual(viewOf('workflow_settings.yaml'), EMPTY_FILE_VIEW);
        const nothing: FileSlice = { compile: 3, file: 'definitions/broken.sqlx', role: 'not compiled', actions: [], problem: { kind: 'no action' } };
        assert.strictEqual(fileViewOf(nothing), EMPTY_FILE_VIEW);
    });

    test('unit tests have a name and two queries; a notebook is a pointer to its file', () => {
        const withTests = buildDataformGraph({
            tables: [{ type: 'table', target: target('orders'), fileName: 'definitions/orders.js', query: 'select 1' }],
            tests: [{ name: 'orders_total', fileName: 'definitions/orders.js', testQuery: 'select 2', expectedOutputQuery: 'select 3' }],
            notebooks: [{ target: target('report'), fileName: 'definitions/report.ipynb', notebookContents: '{"cells": []}', tags: ['daily'] }],
        } as unknown as DataformCompiledJson);
        const slice = fileSlice(withTests, dataform, 'definitions/orders.js', 1, [targetId(target('report'))]);
        const view = fileViewOf(slice);
        assert.deepStrictEqual(sent(view.models), [
            { type: 'table', target: target('orders'), fileName: 'definitions/orders.js', query: 'select 1', incrementalQuery: '', incrementalPreOps: [] },
            { type: 'test', name: 'orders_total', fileName: 'definitions/orders.js', testQuery: 'select 2', expectedOutputQuery: 'select 3' },
            { type: 'notebook', tags: ['daily'], target: target('report'), fileName: 'definitions/report.ipynb', query: 'Open: definitions/report.ipynb \n' },
        ]);
        assert.deepStrictEqual([view.testQuery, view.expectedOutputQuery], [' -- Test: [1] orders_total \nselect 2\n ;', ' -- Test: [1] orders_total \nselect 3\n ;']);
        // Each model comes with its action, so that the host can match what it sends by position
        assert.deepStrictEqual(fileModels(slice).map(({ action }) => action.kind), ['table', 'unit test', 'notebook']);
    });

    test('the panel lists assertions before operations, whatever the order of the slice', () => {
        const mixed = buildDataformGraph({
            tables: [{ type: 'view', target: target('v'), fileName: 'definitions/mixed.js', query: 'select 1' }],
            operations: [{ target: target('op'), fileName: 'definitions/mixed.js', queries: ['select 2', 'select 3'] }],
            assertions: [{ target: target('check'), fileName: 'definitions/mixed.js', query: 'select 4' }],
        } as unknown as DataformCompiledJson);
        const slice = fileSlice(mixed, dataform, 'definitions/mixed.js', 1);
        assert.deepStrictEqual(slice.actions.map((action) => action.kind), ['view', 'operation', 'assertion']);
        const view = fileViewOf(slice);
        assert.deepStrictEqual(view.actionTypes, ['view', 'assertion', 'operations']);
        assert.strictEqual(view.operationsQuery, '\n -- Operations: [1] \nselect 2\n\n -- Operations: [2] \nselect 3\n');
    });
});
