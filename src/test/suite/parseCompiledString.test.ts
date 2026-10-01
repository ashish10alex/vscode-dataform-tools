import * as assert from 'assert';
import { suite, test } from 'mocha';
import { parseCompiledString } from '../../utils/dataformCompiler';

suite('dataformCompiler.parseCompiledString', () => {
    test('parses a single JSON object', () => {
        const compiled = parseCompiledString(JSON.stringify({ tables: [{ query: 'select 1' }] }));
        assert.strictEqual(compiled.tables?.[0].query, 'select 1');
    });

    test('takes the second object from v2 CLI output with multiple JSON objects', () => {
        const output = `${JSON.stringify({ status: 'compiling' })}\n${JSON.stringify({ tables: [{ query: 'select 2' }] })}`;
        const compiled = parseCompiledString(output);
        assert.strictEqual(compiled.tables?.[0].query, 'select 2');
    });

    test('ignores braces and escaped quotes inside JSON strings', () => {
        const query = `select '{' as open_brace, "}}" as close, regexp_extract(s, r'\\{(\\d+)\\}') as n`;
        const output = `${JSON.stringify({ status: 'a } b' })}\n${JSON.stringify({ tables: [{ query }] })}`;
        const compiled = parseCompiledString(output);
        assert.strictEqual(compiled.tables?.[0].query, query);
    });
});
