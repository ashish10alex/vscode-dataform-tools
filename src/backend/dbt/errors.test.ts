import * as assert from 'assert';
import { suite, test } from 'mocha';
import { compileError, invocationErrors, logErrors, outputDetail } from './errors';
import { readDbtLog, readRecordedManifest } from './fixtures';

const errorsOf = (name: string) => logErrors(readDbtLog(name).stdout);

suite('dbt errors from its log', () => {
    test('dbt-core: a ref that is not found names the file, and has no line', () => {
        assert.deepStrictEqual(errorsOf('dbt-core-broken'), [{
            fileName: 'models/order_totals.sql',
            message: "Compilation Error\n  Model 'model.xf_broken.order_totals' (models/order_totals.sql) depends on a node named 'order_lines' which was not found",
        }]);
    });

    test('dbt-core: a Jinja error has the line it gives in prose', () => {
        const [error, ...others] = errorsOf('dbt-core-jinja');
        assert.deepStrictEqual(others, []);
        assert.strictEqual(error.fileName, 'models/orders.sql');
        assert.strictEqual(error.line, 2);
        assert.match(error.message, /^Compilation Error in model orders \(models\/orders\.sql\)\n {2}Expected an expression/);
    });

    test('dbt-core: a YAML error names no path, so it has no position, and is still an error', () => {
        const [error, ...others] = errorsOf('dbt-core-yaml');
        assert.deepStrictEqual(others, []);
        assert.strictEqual(error.fileName, undefined);
        assert.strictEqual(error.line, undefined);
        assert.match(error.message, /^Parsing Error\n {2}Error reading xf_broken: _m\.yml/);
    });

    test('dbt-core stops at the first error; dbt v2 reports each', () => {
        assert.strictEqual(errorsOf('dbt-core-two').length, 1);
        assert.deepStrictEqual(errorsOf('dbt-v2-two').map((error) => [error.fileName, error.line, error.code]), [
            ['models/order_totals.sql', 4, 'dbt1048'],
            ['models/orders.sql', 1, 'dbt1048'],
        ]);
    });

    test('dbt v2: the position comes off the end of the message, and the code is kept with it', () => {
        assert.deepStrictEqual(errorsOf('dbt-v2-broken'), [{
            fileName: 'models/order_totals.sql',
            line: 4,
            code: 'dbt1048',
            message: "[DependencyNotFound (dbt1048)]: Ref 'order_lines' not found in project. Searched for 'xf_broken.order_lines, order_lines'",
        }]);
        assert.deepStrictEqual(errorsOf('dbt-v2-jinja').map((error) => [error.fileName, error.line, error.code]), [['models/orders.sql', 2, 'dbt1502']]);
        assert.deepStrictEqual(errorsOf('dbt-v2-yaml').map((error) => [error.fileName, error.line, error.code]), [['models/_m.yml', 6, 'dbt1013']]);
        assert.deepStrictEqual(errorsOf('dbt-v2-macro').map((error) => [error.fileName, error.line, error.code]), [['models/orders.sql', 1, 'dbt1501']]);
    });

    test('an error that is not about a file has only its message', () => {
        assert.deepStrictEqual(errorsOf('dbt-core-target'), [{
            message: "Runtime Error\n  The profile 'xf_example' does not have a target named 'nope'. The valid target names for this profile are:\n   - dev",
        }]);
        assert.deepStrictEqual(errorsOf('dbt-v2-target'), [{ code: 'dbt1005', message: "[InvalidConfig (dbt1005)]: target 'nope' not found in profile 'xf_example'" }]);
    });

    test('a log without an error gives none', () => {
        // dbt-core does not render a model's macros when it parses
        assert.deepStrictEqual(errorsOf('dbt-core-macro'), []);
        assert.deepStrictEqual(logErrors(''), []);
        assert.deepStrictEqual(logErrors('not json\n{"info":{"level":"error"}}\n{"info":{"level":"info","msg":"an \\"error\\" in passing"}}\n'), []);
    });

    test('agrees with what xf read from the same errors', () => {
        for (const [log, recording] of [['dbt-core-broken', 'dbt-core-broken'], ['dbt-v2-broken', 'dbt-v2-broken']] as const) {
            const [ours] = errorsOf(log);
            const [theirs] = readRecordedManifest(recording).xf_errors!;
            assert.strictEqual(ours.message, theirs.Message, log);
            assert.strictEqual(ours.fileName, theirs.FileName, log);
            assert.strictEqual(theirs.Stack, ours.line === undefined ? '' : `${ours.fileName}:${ours.line}`, log);
        }
    });

    test('a file path as Windows gives it is written with forward slashes', () => {
        const [theirs] = readRecordedManifest('dbt-core-broken-windows').xf_errors!;
        assert.strictEqual(compileError(theirs.Message).fileName, 'models/order_totals.sql');
        assert.strictEqual(compileError('[error] [X (dbt1)]: bad\n  --> models\\a.sql:3:1').fileName, 'models/a.sql');
    });

    test('a position in a form that is not known leaves the error without one', () => {
        assert.deepStrictEqual(compileError('[error] [TypeMismatch (dbt0227)]: no column `x`\n  at models/a.sql line 3'), {
            code: 'dbt0227', message: '[TypeMismatch (dbt0227)]: no column `x`\n  at models/a.sql line 3',
        });
        // A file without a line, and colour codes
        assert.deepStrictEqual(compileError('\x1b[31m[error]\x1b[0m boom\n  --> dbt_project.yml'), { fileName: 'dbt_project.yml', message: 'boom' });
    });

    test('the same error logged twice is one error', () => {
        const line = JSON.stringify({ info: { level: 'error', msg: '[error] boom' } });
        assert.deepStrictEqual(logErrors(`${line}\n${line}\n`), [{ message: 'boom' }]);
    });

    test('a command that failed without logging an error gives what else it printed', () => {
        for (const name of ['dbt-core-badflag', 'dbt-v2-badflag']) {
            const [error, ...others] = invocationErrors({ ...readDbtLog(name), exitCode: 2 });
            assert.deepStrictEqual(others, []);
            assert.match(error.message, /--no-such-flag/);
            assert.strictEqual(error.fileName, undefined);
        }
        assert.strictEqual(outputDetail('{"info":{}}\nTraceback\n', 'a\n\nb \n'), 'a\nb\nTraceback');
        assert.strictEqual(outputDetail(Array.from({ length: 50 }, (_, index) => `line ${index}`).join('\n'), '').split('\n').length, 40);
        // A command that succeeded has no errors, whatever it printed
        assert.deepStrictEqual(invocationErrors({ stdout: '', stderr: 'a deprecation warning\n', exitCode: 0 }), []);
        assert.deepStrictEqual(invocationErrors({ ...readDbtLog('dbt-v2-broken'), exitCode: 1 }).length, 1);
    });
});
