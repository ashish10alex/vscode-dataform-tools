import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { BIGQUERY_FUNCTIONS, functionHoverMarkdown, functionNamed, generatedSnippetsText, signatureLabel, snippetBody, withoutTabStops } from '../../bigquery/functionCatalog';
import { activeParameter, callAt, functionNameAt, inSql, insideJinja } from '../../bigquery/functionCall';
import { registerBigQueryFunctionProviders } from '../../bigquery/functionProviders';

const snippets = path.resolve(__dirname, '..', '..', '..', '..', 'snippets');
const fn = (name: string) => functionNamed(name)!;

/** The param of a function's signature that the cursor is at, after the text before it */
function active(text: string): { name: string; signature: number; param: string } | undefined {
    const call = callAt(text);
    const found = call && functionNamed(call.name);
    if (!call || !found) {
        return undefined;
    }
    const actives = found.signatures.map((signature) => activeParameter(signature.params, call.separators));
    const signature = Math.max(actives.findIndex((each) => each.fits), 0);
    return { name: found.name, signature, param: found.signatures[signature].params[actives[signature].index]?.name ?? '' };
}

suite('BigQuery functions: the catalog', () => {
    test('the committed snippet file is the one the catalog makes', () => {
        const committed = fs.readFileSync(path.join(snippets, 'bigquery-functions.code-snippets.json'), 'utf8');
        assert.ok(committed === generatedSnippetsText(), 'snippets/bigquery-functions.code-snippets.json is out of date: run `just bigquery-snippets`');
    });

    test('each function has a doc link, a signature, and its optional params after the required ones', () => {
        for (const each of BIGQUERY_FUNCTIONS) {
            assert.ok(each.url.startsWith('https://cloud.google.com/bigquery/docs/reference/standard-sql/'), each.name);
            assert.ok(each.signatures.length > 0 && each.doc, each.name);
            for (const signature of each.signatures) {
                const firstOptional = signature.params.findIndex((param) => param.optional);
                assert.ok(firstOptional < 0 || signature.params.slice(firstOptional).every((param) => param.optional), `${each.name}: a required param after an optional one`);
            }
        }
    });

    test('a function is in the catalog or in the hand-written snippets, not in both', () => {
        const handWritten = Object.keys(JSON.parse(fs.readFileSync(path.join(snippets, 'bigquery.code-snippets.json'), 'utf8'))['.source.sql-bigquery']);
        const both = handWritten.filter((key) => /^([A-Za-z_][\w.]*)\(/.test(key) && functionNamed(key.split('(')[0]));
        assert.deepStrictEqual(both, []);
    });

    test('a snippet inserts the required args only, a dropdown for a fixed set, and the OVER clause a window function needs', () => {
        assert.strictEqual(snippetBody(fn('SAFE_DIVIDE')), 'SAFE_DIVIDE(${1:X}, ${2:Y})');
        assert.strictEqual(snippetBody(fn('DATE_TRUNC')), 'DATE_TRUNC(${1:date_value}, ${2|DAY,WEEK,WEEK(MONDAY),ISOWEEK,MONTH,QUARTER,YEAR,ISOYEAR|})');
        assert.strictEqual(snippetBody(fn('DATE_ADD')), 'DATE_ADD(${1:date_expr}, INTERVAL ${2:1} ${3|DAY,WEEK,MONTH,QUARTER,YEAR|})');
        assert.strictEqual(snippetBody(fn('REGEXP_EXTRACT')), "REGEXP_EXTRACT(${1:value}, r'${2:regex}')");
        assert.strictEqual(snippetBody(fn('JSON_QUERY')), "JSON_QUERY(${1:json_expr}, '${2:\\$.field}')");
        assert.ok(snippetBody(fn('CAST')).startsWith('CAST(${1:expression} AS ${2|STRING,INT64,'));
        assert.strictEqual(snippetBody(fn('LAG')), 'LAG(${1:value}) OVER (PARTITION BY ${2:partition_expr} ORDER BY ${3:order_expr})');
        assert.strictEqual(snippetBody(fn('PERCENTILE_CONT')), 'PERCENTILE_CONT(${1:value}, ${2:percentile}) OVER (PARTITION BY ${3:partition_expr})');
        assert.strictEqual(snippetBody(fn('SUM')), 'SUM(${1:expression})');
        assert.strictEqual(snippetBody(fn('CURRENT_TIMESTAMP')), 'CURRENT_TIMESTAMP()');
        // No optional part is ever left in the SQL as bracket text
        for (const each of BIGQUERY_FUNCTIONS) {
            assert.ok(!/\[|\]/.test(withoutTabStops(snippetBody(each))), each.name);
        }
    });

    test('a signature says each param with its type, optional ones in brackets, and where each is in the line', () => {
        const { label, params } = signatureLabel(fn('REGEXP_EXTRACT'), fn('REGEXP_EXTRACT').signatures[0]);
        assert.strictEqual(label, 'REGEXP_EXTRACT(value: STRING | BYTES, regexp: STRING[, position: INT64][, occurrence: INT64]) → STRING | BYTES');
        assert.deepStrictEqual(params.map(([start, end]) => label.slice(start, end)), ['value: STRING | BYTES', 'regexp: STRING', 'position: INT64', 'occurrence: INT64']);
        assert.strictEqual(signatureLabel(fn('EXTRACT'), fn('EXTRACT').signatures[0]).label,
            'EXTRACT(part: date part FROM value: DATE | DATETIME | TIME | TIMESTAMP [AT TIME ZONE time_zone: STRING]) → INT64 (DATE, DATETIME or TIME for those parts)');
        assert.strictEqual(signatureLabel(fn('COALESCE'), fn('COALESCE').signatures[0]).label, 'COALESCE(expr: ANY, expr: ANY, ...) → the type of the arguments');
        assert.strictEqual(signatureLabel(fn('ROW_NUMBER'), fn('ROW_NUMBER').signatures[0]).label, 'ROW_NUMBER() OVER (...) → INT64');
    });

    test('the hover says every signature, the params, an example and the docs link', () => {
        const hover = functionHoverMarkdown(fn('DATE_TRUNC'));
        assert.ok(hover.startsWith('```sql\nDATE_TRUNC(date_value: DATE | DATETIME, granularity: date part) → same type as the value\nDATE_TRUNC(timestamp_value: TIMESTAMP, '), hover);
        assert.ok(hover.includes('- `granularity` — One of: `DAY`, `WEEK`, `WEEK(MONDAY)`,'), hover);
        assert.ok(hover.includes("Example: `DATE_TRUNC(DATE '2023-12-13', MONTH)` → 2023-12-01"), hover);
        assert.ok(hover.endsWith('[BigQuery docs](https://cloud.google.com/bigquery/docs/reference/standard-sql/date_functions#date_trunc)'), hover);
        assert.ok(functionHoverMarkdown(fn('ROW_NUMBER')).includes('A window function: it takes `OVER (PARTITION BY … ORDER BY …)`.'));
    });

    test('a hand-written snippet reads as plain SQL in a hover', () => {
        assert.strictEqual(withoutTabStops('ARRAY_AGG(${1:[DISTINCT] expression [{IGNORE|RESPECT\\} NULLS]}) ${2:[OVER (...)]}'), 'ARRAY_AGG([DISTINCT] expression [{IGNORE|RESPECT} NULLS]) [OVER (...)]');
        assert.strictEqual(withoutTabStops('IF EXISTS (${1:SELECT expression FROM ${2:table_reference} WHERE condition}) THEN'), 'IF EXISTS (SELECT expression FROM table_reference WHERE condition) THEN');
        assert.strictEqual(withoutTabStops('ROUND(${1|a,b|})$0'), 'ROUND(a|b)');
    });
});

suite('BigQuery functions: where the cursor is', () => {
    test('the argument of a call, counting only its own commas', () => {
        assert.deepStrictEqual(active('SELECT SAFE_DIVIDE('), { name: 'SAFE_DIVIDE', signature: 0, param: 'X' });
        assert.deepStrictEqual(active('SELECT SAFE_DIVIDE(revenue, '), { name: 'SAFE_DIVIDE', signature: 0, param: 'Y' });
        assert.deepStrictEqual(active('select if(x in (1, 2, 3), '), { name: 'IF', signature: 0, param: 'true_result' });
        assert.deepStrictEqual(active('IF(COALESCE(a, b), '), { name: 'IF', signature: 0, param: 'true_result' });
        assert.deepStrictEqual(active('ROUND((a + b'), { name: 'ROUND', signature: 0, param: 'X' });
        assert.deepStrictEqual(active('ARRAY_TO_STRING([a, b, c], '), { name: 'ARRAY_TO_STRING', signature: 0, param: 'delimiter' });
        assert.deepStrictEqual(active('SAFE.SUBSTR(name, '), { name: 'SUBSTR', signature: 0, param: 'position' });
    });

    test('commas in strings and comments are not arguments, and in a string or a comment there is no call', () => {
        assert.deepStrictEqual(active("CONCAT('a, b', "), { name: 'CONCAT', signature: 0, param: 'value' });
        assert.deepStrictEqual(active("REPLACE(s, \"it's, \", "), { name: 'REPLACE', signature: 0, param: 'to_pattern' });
        assert.deepStrictEqual(active('DATE_TRUNC(d, -- a, b\n'), { name: 'DATE_TRUNC', signature: 0, param: 'granularity' });
        assert.deepStrictEqual(active('DATE_TRUNC(d /* a, b */, '), { name: 'DATE_TRUNC', signature: 0, param: 'granularity' });
        assert.strictEqual(active("CONCAT('a, "), undefined);
        assert.strictEqual(active('CONCAT(a -- b, '), undefined);
    });

    test('a call that is no BigQuery function hides the one it is in, and dbt and Dataform code is stepped over', () => {
        assert.strictEqual(active('SAFE_DIVIDE(my_udf(a, '), undefined);
        assert.strictEqual(active('SAFE_DIVIDE(`project.dataset.fn`(a, '), undefined);
        assert.strictEqual(active("SELECT a IN ("), undefined);
        assert.deepStrictEqual(active("DATE_TRUNC({{ ref('orders') }}.created, "), { name: 'DATE_TRUNC', signature: 0, param: 'granularity' });
        assert.deepStrictEqual(active('DATE_DIFF(${ref("orders")}.a, ${self()}.b, '), { name: 'DATE_DIFF', signature: 0, param: 'granularity' });
        assert.deepStrictEqual(active("{# it's, here #} COALESCE(a, "), { name: 'COALESCE', signature: 0, param: 'expr' });
    });

    test('a keyword moves to the next argument where the function takes one, and the signature is the one that fits', () => {
        assert.deepStrictEqual(active('CAST(x AS '), { name: 'CAST', signature: 0, param: 'type' });
        assert.deepStrictEqual(active('CAST(x AS STRING FORMAT '), { name: 'CAST', signature: 0, param: 'format' });
        assert.deepStrictEqual(active('EXTRACT(DAY FROM ts AT TIME ZONE '), { name: 'EXTRACT', signature: 0, param: 'time_zone' });
        assert.deepStrictEqual(active('DATE(ts, '), { name: 'DATE', signature: 0, param: 'time_zone' });
        assert.deepStrictEqual(active('DATE(2024, 3, '), { name: 'DATE', signature: 1, param: 'day' });
        assert.deepStrictEqual(active('COALESCE(a, b, c, '), { name: 'COALESCE', signature: 0, param: 'expr' });
    });

    test('a hover is on a name a ( follows, not on a column of the same name', () => {
        assert.deepStrictEqual(functionNameAt('SELECT DATE_TRUNC (created, DAY)', 9), { name: 'DATE_TRUNC', start: 7, end: 17 });
        assert.deepStrictEqual(functionNameAt('SAFE.SUBSTR(name, 1)', 2), { name: 'SAFE.SUBSTR', start: 0, end: 11 });
        assert.strictEqual(functionNameAt('SELECT date, format FROM t', 8), undefined);
        assert.strictEqual(functionNameAt('LEFT JOIN t', 1), undefined);
    });

    test('inside Jinja', () => {
        assert.strictEqual(insideJinja('select {{ ref('), true);
        assert.strictEqual(insideJinja("select {{ ref('a') }} where {% if "), true);
        assert.strictEqual(insideJinja("select {{ ref('a') }}, date_tr"), false);
        // A delimiter in a closed Jinja comment opens nothing
        assert.strictEqual(insideJinja('{# note: {{ example #}\nselect date_tr'), false);
        assert.strictEqual(insideJinja('{# note #} {{ ref('), true);
    });

    test('in SQL, and not in a string, a comment or Jinja', () => {
        assert.strictEqual(inSql('select '), true);
        assert.strictEqual(inSql("select '"), false);
        assert.strictEqual(inSql('select -- '), false);
        assert.strictEqual(inSql('select {{ '), false);
    });
});

suite('BigQuery functions: the editor', () => {
    const registered: vscode.Disposable[] = [];
    // Plain SQL, which nothing else of the extension answers for
    suiteSetup(() => registered.push(...registerBigQueryFunctionProviders({ language: 'sql', scheme: 'untitled' }, true)));
    suiteTeardown(() => registered.forEach((each) => each.dispose()));

    const sql = (content: string) => vscode.workspace.openTextDocument({ language: 'sql', content });

    test('signature help inside the parentheses of a function, at the argument the cursor is in', async () => {
        const document = await sql('SELECT DATE_DIFF(end_at, start_at, ');
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', document.uri, document.positionAt(document.getText().length), ',');
        assert.strictEqual(help.signatures[0].label, 'DATE_DIFF(end_date: DATE, start_date: DATE, granularity: date part) → INT64');
        assert.strictEqual(help.activeParameter, 2);
    });

    test('the hover of a catalogued function and of a hand-written one', async () => {
        const document = await sql('SELECT SAFE_DIVIDE(a, b), ST_AREA(geo)');
        const text = async (offset: number) => (await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(offset)))
            .flatMap((hover) => hover.contents.map((content) => (typeof content === 'string' ? content : content.value)));
        const [catalogued] = await text(9);
        assert.ok(catalogued.includes('SAFE_DIVIDE(X: INT64 | NUMERIC | BIGNUMERIC | FLOAT64, Y:'), catalogued);
        const [handWritten] = await text(28);
        assert.ok(handWritten.includes('ST_AREA(geography_expression') && !handWritten.includes('${'), handWritten);
    });

    test('no hover or signature help in a string, a comment or Jinja', async () => {
        const document = await sql("SELECT 'SAFE_DIVIDE(a', -- SAFE_DIVIDE(a\n{{ concat(a, ");
        const hover = (needle: string) => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(document.getText().indexOf(needle) + 1));
        assert.deepStrictEqual(await hover("SAFE_DIVIDE(a'"), []);
        assert.deepStrictEqual(await hover('SAFE_DIVIDE(a\n'), []);
        assert.deepStrictEqual(await hover('concat('), []);
        const help = await vscode.commands.executeCommand<vscode.SignatureHelp | undefined>('vscode.executeSignatureHelpProvider', document.uri, document.positionAt(document.getText().length), ',');
        assert.ok(!help || help.signatures.length === 0, JSON.stringify(help));
    });

    test('completions of functions, as snippets, but not in a string', async () => {
        const document = await sql("SELECT date_tr");
        const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, document.positionAt(document.getText().length));
        const item = list.items.find((each) => (typeof each.label === 'string' ? each.label : each.label.label) === 'DATE_TRUNC');
        assert.ok(item?.insertText instanceof vscode.SnippetString, 'expected DATE_TRUNC as a snippet');
        const inString = await sql("SELECT 'date_tr");
        const none = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', inString.uri, inString.positionAt(inString.getText().length));
        assert.ok(!none.items.some((each) => each.kind === vscode.CompletionItemKind.Function), 'expected no function in a string');
    });
});
