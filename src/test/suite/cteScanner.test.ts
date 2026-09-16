import * as assert from 'assert';
import { suite, test } from 'mocha';
import { findCteDefinition, findCtes } from '../../cteScanner';

const names = (text: string) => findCtes(text).map(cte => cte.name);

suite('cteScanner.findCtes', () => {
    test('finds comma separated CTEs with ranges covering the body', () => {
        const sql = 'WITH a AS (SELECT (1)), b AS (SELECT * FROM a)\nSELECT * FROM b';
        const ctes = findCtes(sql);
        assert.deepStrictEqual(ctes.map(c => c.name), ['a', 'b']);
        assert.strictEqual(sql.slice(ctes[0].start, ctes[0].end), 'a AS (SELECT (1))');
        assert.strictEqual(sql.slice(ctes[1].start, ctes[1].end), 'b AS (SELECT * FROM a)');
        assert.strictEqual(ctes[0].scopeEnd, sql.length);
    });

    test('is case insensitive and supports RECURSIVE and column lists', () => {
        assert.deepStrictEqual(names('with recursive r (n) as (select 1 union all select n + 1 from r) select * from r'), ['r']);
    });

    test('handles backtick quoted names', () => {
        const sql = 'WITH `my cte` AS (SELECT 1) SELECT * FROM `my cte`';
        const [cte] = findCtes(sql);
        assert.strictEqual(cte.name, 'my cte');
        assert.strictEqual(sql.slice(cte.nameStart, cte.nameEnd), 'my cte');
        assert.strictEqual(sql.slice(cte.start, cte.end), '`my cte` AS (SELECT 1)');
    });

    test('ignores comments and strings', () => {
        const sql = [
            '-- WITH c1 AS (SELECT 1)',
            '# WITH c2 AS (SELECT 1)',
            '/* WITH c3 AS (SELECT 1) */',
            "SELECT 'WITH c4 AS (SELECT 1)', \"WITH c5 AS (\", '''WITH c6 AS (''' ",
            'WITH real AS (SELECT \')\' -- )',
            ')',
            'SELECT * FROM real',
        ].join('\n');
        const ctes = findCtes(sql);
        assert.deepStrictEqual(ctes.map(c => c.name), ['real']);
        assert.ok(sql.slice(ctes[0].start, ctes[0].end).endsWith('-- )\n)'));
    });

    test('treats ${...} templates as opaque inside CTE bodies', () => {
        const sql = 'WITH a AS (SELECT * FROM ${ref("x", ")")}), b AS (SELECT 1) SELECT 1';
        assert.deepStrictEqual(names(sql), ['a', 'b']);
    });

    test('finds CTEs inside SQL template literals within ${...}', () => {
        const sql = 'SELECT 1 ${when(incremental(), `WITH inc AS (SELECT \\`x\\` FROM t -- note\n) SELECT * FROM inc`)} WITH outer_cte AS (SELECT 2) SELECT 3';
        const ctes = findCtes(sql);
        assert.deepStrictEqual(ctes.map(c => c.name), ['inc', 'outer_cte']);
        assert.strictEqual(sql.slice(ctes[0].start, ctes[0].end), 'inc AS (SELECT \\`x\\` FROM t -- note\n)');
    });

    test('finds nested and multiple WITH clauses', () => {
        const sql = 'WITH a AS (WITH inner_a AS (SELECT 1) SELECT * FROM inner_a) SELECT * FROM (WITH sub AS (SELECT 1) SELECT * FROM sub)';
        assert.deepStrictEqual(names(sql), ['a', 'inner_a', 'sub']);
    });

    test('does not treat WITH OFFSET as a CTE', () => {
        assert.deepStrictEqual(names('SELECT * FROM UNNEST([1]) AS x WITH OFFSET AS off'), []);
    });

    test('extends an unterminated CTE to the end of the text', () => {
        const sql = 'WITH a AS (SELECT * FROM t';
        const [cte] = findCtes(sql);
        assert.strictEqual(cte.end, sql.length);
    });
});

suite('cteScanner.findCteDefinition', () => {
    const sql = [
        'pre_operations { WITH x AS (SELECT 1) SELECT * FROM x }',
        'WITH x AS (SELECT 2), y AS (WITH x AS (SELECT 3) SELECT * FROM x)',
        'SELECT * FROM x',
    ].join('\n');
    const ctes = findCtes(sql);

    test('prefers the innermost enclosing WITH scope', () => {
        const offset = sql.indexOf('FROM x)') + 5;
        assert.deepStrictEqual(findCteDefinition(sql, 'x', offset), ctes[3]);
    });

    test('resolves to the latest WITH scope containing the reference', () => {
        assert.deepStrictEqual(findCteDefinition(sql, 'X', sql.lastIndexOf('x')), ctes[1]);
        assert.deepStrictEqual(findCteDefinition(sql, 'x', sql.indexOf('FROM x }') + 5), ctes[0]);
    });

    test('ends a WITH scope at a semicolon', () => {
        const text = 'WITH x AS (SELECT 1) SELECT * FROM x; SELECT * FROM x';
        const [cte] = findCtes(text);
        assert.strictEqual(cte.scopeEnd, text.indexOf(';'));
    });

    test('returns undefined for unknown names', () => {
        assert.strictEqual(findCteDefinition(sql, 'nope', 0), undefined);
    });
});
