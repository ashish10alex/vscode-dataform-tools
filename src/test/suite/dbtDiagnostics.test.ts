import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { logErrors } from '../../backend/dbt/errors';
import { dbtDiagnostics } from '../../project/dbtDiagnostics';
import { dbtErrorFoot } from '../../shared/panelDbtView';
import { findProjectRoot } from './helper';

/*
dbt's compile errors, as a real dbt-core and a real dbt v2 logged them for the broken example Project (see
src/test/fixtures/dbt-logs), in the editor and under the panel's error card.
*/

const fixtures = path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures');
const root = path.join(fixtures, 'xf-examples', 'projects', 'dbt-broken');
const errorsOf = (log: string) => logErrors(fs.readFileSync(path.join(fixtures, 'dbt-logs', `${log}.stdout.jsonl`), 'utf8'));
const marks = (log: string) => [...dbtDiagnostics(root, errorsOf(log))].map(([file, diagnostics]) => [path.relative(root, file).split(path.sep).join('/'), diagnostics.map(({ range }) => [range.start.line, range.start.character, range.end.character])]);
const totals = fs.readFileSync(path.join(root, 'models', 'order_totals.sql'), 'utf8').split('\n');

suite('dbt compile errors in the editor', () => {
    test('dbt v2 gives a line: the error is marked on it', () => {
        const line = totals[3];
        assert.deepStrictEqual(marks('dbt-v2-broken'), [['models/order_totals.sql', [[3, line.length - line.trimStart().length, line.length]]]]);
        const [diagnostic] = [...dbtDiagnostics(root, errorsOf('dbt-v2-broken')).values()][0];
        assert.deepStrictEqual([diagnostic.source, diagnostic.code], ['dbt compile', 'dbt1048']);
        assert.ok(diagnostic.message.includes("Ref 'order_lines' not found"));
    });

    test('dbt-core gives no line for a bad ref: it is marked on the ref() it names', () => {
        const column = totals[3].indexOf('order_lines');
        assert.ok(column > 0);
        assert.deepStrictEqual(marks('dbt-core-broken'), [['models/order_totals.sql', [[3, column, column + 'order_lines'.length]]]]);
    });

    test('an error that is not about a file, or names one without a real position, is marked nowhere', () => {
        // An unknown dbt target, on both engines
        assert.deepStrictEqual(marks('dbt-core-target'), []);
        assert.deepStrictEqual(marks('dbt-v2-target'), []);
        // dbt-core names no file for a YAML error
        assert.deepStrictEqual(marks('dbt-core-yaml'), []);
        // A ref() that is not in the file as it is now
        assert.deepStrictEqual(marks('dbt-core-two'), []);
    });

    test('a file that cannot be read is skipped', () => {
        assert.deepStrictEqual([...dbtDiagnostics(root, [{ message: 'x', fileName: 'models/gone.sql', line: 1 }])], []);
    });

    test('every error of a compile is marked, each in its own file', () => {
        const read = (file: string) => (file.endsWith('orders.sql') ? "select * from {{ ref('nope') }}\n" : fs.readFileSync(file, 'utf8'));
        const files = [...dbtDiagnostics(root, errorsOf('dbt-v2-two'), read).keys()].map((file) => path.basename(file));
        assert.deepStrictEqual(files.sort(), ['order_totals.sql', 'orders.sql']);
    });
});

suite('dbt compile errors in the panel: the note under the card', () => {
    const foot = (log: string, flavour: 'dbt-core' | 'dbt v2') => dbtErrorFoot(errorsOf(log)[0], flavour);

    test('an error with a line says it is marked in the editor too', () => {
        assert.strictEqual(foot('dbt-v2-broken', 'dbt v2'), 'Also marked in the editor on that line.');
    });

    test('dbt-core says that it stops at the first error', () => {
        assert.strictEqual(foot('dbt-core-jinja', 'dbt-core'), 'dbt-core stops at the first error, so there may be more. Also marked in the editor on that line.');
        assert.ok(foot('dbt-core-broken', 'dbt-core').endsWith('It is marked in the editor on the ref() it names, if that is in the file.'));
    });

    test('an unknown dbt target points at the dbt target control, in the words of either engine', () => {
        assert.ok(foot('dbt-core-target', 'dbt-core').endsWith('Not about a file. Change the dbt target in the control above.'));
        assert.strictEqual(foot('dbt-v2-target', 'dbt v2'), 'Not about a file. Change the dbt target in the control above.');
    });

    test('another error that names no file says only that', () => {
        assert.ok(foot('dbt-core-yaml', 'dbt-core').endsWith('there may be more. Not about a file.'));
    });

    test('an error in a file with no line and no ref says that nothing is marked', () => {
        assert.strictEqual(dbtErrorFoot({ message: "'cents_to_dolars' is undefined", fileName: 'models/a.sql' }, 'dbt v2'), 'dbt reported no line, so nothing is marked in the editor.');
    });
});
