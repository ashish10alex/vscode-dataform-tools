import * as assert from 'assert';
import { suite, test } from 'mocha';
import { parseCompilationStack } from '../../parseCompilationStack';

suite('parseCompilationStack', () => {

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    test('returns empty object for undefined input', () => {
        const result = parseCompilationStack(undefined);
        assert.deepStrictEqual(result, {});
    });

    test('returns empty object for empty string', () => {
        const result = parseCompilationStack('');
        assert.deepStrictEqual(result, {});
    });

    test('returns only lineNumber when stack has no context lines', () => {
        const stack = '/tmp/definitions/file.sqlx:5';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.lineNumber, 5);
        assert.strictEqual(result.sourceContext, undefined);
    });

    test('returns undefined lineNumber when first line has no line number', () => {
        const stack = '/tmp/definitions/file.sqlx\n  some context';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.lineNumber, undefined);
        assert.strictEqual(result.sourceContext, '  some context');
    });

    // -------------------------------------------------------------------------
    // Line number extraction
    // -------------------------------------------------------------------------

    test('extracts line number with :line format', () => {
        const stack = '/tmp/definitions/file.sqlx:10\n  bad line here';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.lineNumber, 10);
    });

    test('extracts line number with :line:col format', () => {
        const stack = '/tmp/definitions/file.sqlx:42:7\n  bad line here';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.lineNumber, 42);
    });

    test('handles line number 1', () => {
        const stack = '/tmp/definitions/file.sqlx:1\n  config {}';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.lineNumber, 1);
    });

    // -------------------------------------------------------------------------
    // Source context extraction
    // -------------------------------------------------------------------------

    test('strips node stack frames starting with 4-space "at "', () => {
        const stack = [
            '/tmp/definitions/file.sqlx:10',
            '  dependencies: ["0300_DATA],',
            '                 ^^^^^^^^^^^',
            '',
            'SyntaxError: Invalid or unexpected token',
            '    at new Script (node:vm:117:7)',
            '    at VMScript._compile (/node_modules/vm2/lib/script.js:335:10)',
        ].join('\n');

        const result = parseCompilationStack(stack);

        assert.ok(result.sourceContext, 'sourceContext should be defined');
        assert.ok(!result.sourceContext!.includes('at new Script'), 'should strip node frames');
        assert.ok(!result.sourceContext!.includes('at VMScript'), 'should strip node_modules frames');
        assert.ok(result.sourceContext!.includes('dependencies:'), 'should keep code snippet');
        assert.ok(result.sourceContext!.includes('SyntaxError'), 'should keep error label');
    });

    test('preserves caret pointer lines in source context', () => {
        const stack = [
            '/tmp/definitions/file.sqlx:10',
            '  dependencies: ["0300_DATA],',
            '                 ^^^^^^^^^^^',
            '',
            'SyntaxError: Invalid or unexpected token',
            '    at new Script (node:vm:117:7)',
        ].join('\n');

        const result = parseCompilationStack(stack);

        assert.ok(result.sourceContext!.includes('^^^^^^^^^^^'), 'should preserve caret line');
    });

    test('trims trailing blank lines from source context', () => {
        const stack = [
            '/tmp/definitions/file.sqlx:3',
            '  some bad sql',
            '',
            '',
        ].join('\n');

        const result = parseCompilationStack(stack);

        assert.ok(result.sourceContext, 'sourceContext should be defined');
        assert.ok(!result.sourceContext!.endsWith('\n'), 'should not have trailing newline');
        assert.strictEqual(result.sourceContext, '  some bad sql');
    });

    test('returns undefined sourceContext when all lines are blank after path line', () => {
        const stack = '/tmp/definitions/file.sqlx:7\n\n\n';
        const result = parseCompilationStack(stack);
        assert.strictEqual(result.sourceContext, undefined);
    });

    test('returns undefined sourceContext when only stack frames follow path line', () => {
        const stack = [
            '/tmp/definitions/file.sqlx:7',
            '    at new Script (node:vm:117:7)',
            '    at VMScript._compile (/node_modules/vm2/script.js:10)',
        ].join('\n');

        const result = parseCompilationStack(stack);
        assert.strictEqual(result.sourceContext, undefined);
    });

    // -------------------------------------------------------------------------
    // Real-world stack format from Dataform CLI
    // -------------------------------------------------------------------------

    test('parses a realistic Dataform CLI syntax error stack', () => {
        const stack = [
            '/private/var/folders/vz/mwhrymmx5xs3j45cv039kv_w0000gn/T/tmp-29844-4Ko8AnBvCw1h/definitions/test-dir/intermediate/0400_WIP_HISTORY.sqlx:10',
            '  dependencies: ["0100_MODEL_NAME],',
            '                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^',
            '',
            'SyntaxError: Invalid or unexpected token',
            '    at new Script (node:vm:117:7)',
            '    at VMScript._compile (/Users/ashishalex/.nvm/versions/node/v24.14.0/lib/node_modules/@dataform/cli/node_modules/vm2/lib/script.js:335:10)',
            '    at NodeVM.run (/Users/ashishalex/.nvm/versions/node/v24.14.0/lib/node_modules/@dataform/cli/node_modules/vm2/lib/nodevm.js:384:47)',
        ].join('\n');

        const result = parseCompilationStack(stack);

        assert.strictEqual(result.lineNumber, 10);
        assert.ok(result.sourceContext, 'sourceContext should be defined');

        // Should contain the code snippet
        assert.ok(result.sourceContext!.includes('dependencies: ["0100_MODEL_NAME]'));
        // Should contain the caret pointer
        assert.ok(result.sourceContext!.includes('^^^^^^^^^^^^^^^^^^^^^^^^^^^'));
        // Should contain the error label
        assert.ok(result.sourceContext!.includes('SyntaxError: Invalid or unexpected token'));
        // Should NOT contain any node stack frames
        assert.ok(!result.sourceContext!.includes('at new Script'));
        assert.ok(!result.sourceContext!.includes('node_modules'));
        assert.ok(!result.sourceContext!.includes('NodeVM.run'));
    });

    test('parses a stack with only a SyntaxError label and no code snippet', () => {
        const stack = [
            '/tmp/definitions/file.sqlx:1',
            '',
            'SyntaxError: Unexpected end of input',
            '    at new Script (node:vm:117:7)',
        ].join('\n');

        const result = parseCompilationStack(stack);

        assert.strictEqual(result.lineNumber, 1);
        assert.ok(result.sourceContext, 'sourceContext should be defined');
        assert.ok(result.sourceContext!.includes('SyntaxError: Unexpected end of input'));
        assert.ok(!result.sourceContext!.includes('at new Script'));
    });
});
