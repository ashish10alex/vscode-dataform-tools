import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { fileSlice } from '../../panel/slices';
import type { FileSlice } from '../../shared/panelContract';
import { fileView } from '../../../webviews/preview_compiled/utils/fileView';
import { findProjectRoot } from './helper';

const dataform = new DataformBackend(async () => ({}));
const graph = buildDataformGraph(JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'xf-examples', 'dataform.json'), 'utf8')));
const slice = (file: string) => fileSlice(graph, dataform, file, 1);

suite('panel: what is shown of the file, from the file slice', () => {
    test('before the host has sent a file there is nothing to show', () => {
        const view = fileView(undefined);
        assert.deepStrictEqual([view.models, view.dependents, view.actionTypes, view.isHelperFile, view.declarations], [[], [], [], false, null]);
        assert.deepStrictEqual([view.tableOrViewQuery, view.assertionQuery, view.incrementalQuery, view.operationsQuery, view.testQuery, view.expectedOutputQuery], ['', '', '', '', '', '']);
    });

    test('a file with a table and assertions: a model for each, the first one\'s dependents, and the scripts', () => {
        const view = fileView(slice('definitions/marts/dim_customers.sqlx'));
        assert.deepStrictEqual(view.models.map((model) => model.type), ['table', 'assertion', 'assertion']);
        assert.deepStrictEqual(view.actionTypes, ['table', 'assertion']);
        assert.ok(view.dependents.length > 0);
        assert.ok(view.tableOrViewQuery !== '' && view.assertionQuery !== '');
        assert.deepStrictEqual([view.isHelperFile, view.declarations], [false, null]);
    });

    test('the same slice gives the same view and the same models, so nothing looks to have changed between renders', () => {
        const file = slice('definitions/marts/dim_customers.sqlx');
        assert.strictEqual(fileView(file), fileView(file));
        assert.strictEqual(fileView(file).models[0], fileView(file).models[0]);
        // The next slice of the same file is another view
        assert.notStrictEqual(fileView(slice('definitions/marts/dim_customers.sqlx')), fileView(file));
    });

    test('a file with no action to show has no models, whatever the last file had', () => {
        const helper = fileView(slice('includes/helpers.js'));
        assert.deepStrictEqual([helper.isHelperFile, helper.models, helper.dependents, helper.actionTypes, helper.tableOrViewQuery], [true, [], [], [], '']);
        assert.strictEqual(fileView(slice('workflow_settings.yaml')).isHelperFile, false);
        const declarations = fileView(slice('definitions/sources/declarations.js'));
        assert.deepStrictEqual(declarations.declarations?.map((declaration) => declaration.target.name), ['customers', 'orders']);
        assert.deepStrictEqual(declarations.models, []);
        const broken: FileSlice = { compile: 2, file: 'definitions/a.sqlx', role: 'not compiled', actions: [], problem: { kind: 'no action' } };
        assert.deepStrictEqual([fileView(broken).models, fileView(broken).declarations, fileView(broken).isHelperFile], [[], null, false]);
    });
});
