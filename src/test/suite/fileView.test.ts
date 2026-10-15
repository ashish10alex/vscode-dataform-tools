import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { DataformBackend } from '../../backend/dataform/backend';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { fileSlice } from '../../panel/slices';
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

    test('the same slice gives the same view and the same models, so nothing looks to have changed between renders', () => {
        const file = slice('definitions/marts/dim_customers.sqlx');
        assert.strictEqual(fileView(file), fileView(file));
        assert.deepStrictEqual(fileView(file).actionTypes, ['table', 'assertion']);
        assert.strictEqual(fileView(file).models[0], fileView(file).models[0]);
        // The next slice of the same file is another view
        assert.notStrictEqual(fileView(slice('definitions/marts/dim_customers.sqlx')), fileView(file));
    });
});
