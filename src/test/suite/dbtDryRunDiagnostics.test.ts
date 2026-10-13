import * as assert from 'assert';
import path from 'path';
import { suite, test } from 'mocha';
import type { DryRunResult } from '../../bigquery/dryRunService';
import { dbtDryRunDiagnostics } from '../../project/dbtDiagnostics';
import { Action, buildCompiledGraph } from '../../shared/compiledGraph';

const action = (name: string, kind: Action['kind'], fileName: string, sql: string): Action => ({
    id: `p.d.${name}`, target: { database: 'p', schema: 'd', name }, kind, fileName, tags: [],
    sections: [{ title: 'query', sql, compiled: true } as Action['sections'][number]], sqlPresent: true, dependencyTargets: [],
});

const SOURCE = "select\n  o.id,\n  o.totl\nfrom {{ ref('orders') }} as o\n";
const COMPILED = 'select\n  o.id,\n  o.totl\nfrom `p`.`d`.`orders` as o\n';
const YAML = 'models:\n  - name: fct\n    columns:\n      - name: id\n        data_tests: [not_null]\n';

suite('dbt: dry-run errors in the editor', () => {
    const root = path.resolve('/work/shop');
    const graph = buildCompiledGraph([
        action('fct', 'table', 'models/fct.sql', COMPILED),
        action('not_null_fct_id', 'test', 'models/_fct.yml', 'select id\nfrom `p`.`d`.`fct`\nwhere id is null'),
        action('no_file', 'table', '', 'select 1'),
    ]);
    const files: Record<string, string> = { 'models/fct.sql': SOURCE, 'models/_fct.yml': YAML };
    const read = (file: string) => files[path.relative(root, file).split(path.sep).join('/')];
    const result = (name: string, error?: DryRunResult['error']): DryRunResult => ({ action: `p.d.${name}`, script: 'query', incremental: false, sections: ['query'], compile: 1, sql: '', ...(error ? { error } : {}) });
    const marked = (results: DryRunResult[], editor?: Parameters<typeof dbtDryRunDiagnostics>[3]) =>
        [...dbtDryRunDiagnostics(root, graph, results, editor, read)].map(([file, diagnostics]) => [
            path.relative(root, file).split(path.sep).join('/'),
            ...diagnostics.map((each) => `${each.range.start.line}:${each.range.start.character}-${each.range.end.character} [${each.source}] ${each.message}`),
        ]);

    test('on the line of the source that the compiled line is, as BigQuery worded it', () => {
        assert.deepStrictEqual(marked([result('fct', { message: 'Unrecognized name: totl', section: 'query', line: 3, column: 5 })]), [
            ['models/fct.sql', '2:2-8 [BigQuery dry run] Unrecognized name: totl'],
        ]);
    });

    test('on the first line when Jinja built the line, or BigQuery gave no place, saying where in the compiled query', () => {
        assert.deepStrictEqual(marked([result('fct', { message: 'Not found: Table p:d.orders', section: 'query', line: 4, column: 6 })]), [
            ['models/fct.sql', '0:0-6 [BigQuery dry run] Not found: Table p:d.orders\n\nThe error is in the compiled query at line 4, column 6. Open the Compiled Query panel to see it there.'],
        ]);
        assert.deepStrictEqual(marked([result('fct', { message: 'Access Denied' })]), [
            ['models/fct.sql', '0:0-6 [BigQuery dry run] Access Denied\n\nThe error is in the compiled query. Open the Compiled Query panel to see it there.'],
        ]);
    });

    test('a generic test on the line that declares it, named, and never by a line of its SQL', () => {
        const editor = { placeOf: () => ({ fileName: 'models/_fct.yml', lineIn: () => 4 }) };
        const error = { message: 'Unrecognized name: id', section: 'query', line: 1, column: 8 };
        assert.deepStrictEqual(marked([result('not_null_fct_id', error)], editor), [
            ['models/_fct.yml', '4:8-30 [BigQuery dry run] test not_null_fct_id: Unrecognized name: id\n\nThe error is in the compiled query at line 1, column 8. Open the Compiled Query panel to see it there.'],
        ]);
        // With nothing to say where: the first line of its file
        assert.strictEqual(marked([result('not_null_fct_id', error)])[0][1].startsWith('0:0-7 '), true);
    });

    test('nothing for a dry run that passed, an action with no file, or a file that cannot be read', () => {
        assert.deepStrictEqual(marked([result('fct'), result('no_file', { message: 'x' }), result('gone', { message: 'x' })]), []);
        assert.deepStrictEqual([...dbtDryRunDiagnostics(root, graph, [result('fct', { message: 'x' })], undefined, () => undefined)], []);
    });
});
