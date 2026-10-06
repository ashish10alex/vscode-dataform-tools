import * as assert from 'assert';
globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.compilerOptionsMap = {};
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, test } from 'mocha';
import { buildDataformGraph } from '../../backend/dataform/graph';
import { DryRunResult, RunDryRun, toDryRunResult } from '../../bigquery/dryRunService';
import { sqlxDiagnostics } from '../../bigquery/sqlxDiagnostics';
import { setCompiled } from '../../project';
import { resolveDataformOptions } from '../../project/dataformOptions';
import { Action, CompiledGraph, DryRunScript, actionsInFile, dryRunScripts, hasIncrementalVariant } from '../../shared/compiledGraph';
import { getMetadataForSqlxFileBlocks } from '../../sqlxFileParser';
import { BigQueryDryRunResponse, DataformCompiledJson } from '../../types';
import { compileDataform, dryRunAndShowDiagnostics, getQueryMetaForCurrentFile } from '../../utils';
import { findProjectRoot } from './helper';

const workspaceFolder = path.join(findProjectRoot(__dirname), 'src', 'test', 'test-workspace');

const fine = (): BigQueryDryRunResponse => ({ statistics: { totalBytesProcessed: 1024 }, schema: { fields: [{ name: 'id', type: 'INT64' }] }, error: { hasError: false, message: '' } });
const failing = (message: string, line: number, column: number): BigQueryDryRunResponse => ({ error: { hasError: true, message, location: { line, column } } });

/** The line and column, as BigQuery counts them, of the start of line `index` of `section` within `script` */
function positionOfSectionLine(action: Action, script: DryRunScript, section: string, index: number): { line: number; column: number } {
    const part = script.parts.find((candidate) => candidate.source === section)!;
    const text = action.sections.find((candidate) => candidate.title === section)!.sql.split('\n')[index];
    const firstLine = script.sql.slice(0, part.start).split('\n').length;
    const indent = text.length - text.trimStart().length;
    // The script drops the indent of a section's first line
    return { line: firstLine + index, column: (index === 0 ? 0 : indent) + 1 };
}

suite('sqlx diagnostics from section results', function () {
    this.timeout(60_000);
    let compiled: DataformCompiledJson;
    let graph: CompiledGraph;

    suiteSetup(async () => {
        const { compiledString } = await compileDataform(workspaceFolder, resolveDataformOptions(workspaceFolder, 'cli'));
        assert.ok(compiledString, 'the test workspace compiles');
        compiled = JSON.parse(compiledString);
        graph = buildDataformGraph(compiled);
    });

    const open = async (file: string) => {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceFolder, file)));
        const actions = actionsInFile(graph, file);
        assert.ok(actions.length > 0, `${file} defines an action`);
        return { document, actions, main: actions[0], blocks: getMetadataForSqlxFileBlocks(document) };
    };

    // An error reported at the start of each line of the compiled query must be marked on the line of the file that
    // line was written on. The file's own text proves it: outside `${...}`, a compiled line is the source line.
    const FILES: Record<string, string> = {
        'a view with no other block': 'definitions/0100_CLUBS.sqlx',
        'a table with assertions in its config': 'definitions/0100_GAMES_META.sqlx',
        'a table with a pre_operations block': 'definitions/0200_PLAYER_TRANSFERS.sqlx',
        'an incremental table with a pre_operations block': 'definitions/0300_INCREMENTAL.sqlx',
        'an assertion': 'definitions/assertions/0100_CLUBS_ASSER.sqlx',
        'a table with two pre_operations and two post_operations blocks': 'definitions/tests_for_vscode_extension/0100_MULTIPLE_PRE_POST_OPS.sqlx',
        'a table with a single-line config': 'definitions/tests_for_vscode_extension/0100_SINGLE_LINE_CONFIG.sqlx',
    };
    for (const [what, file] of Object.entries(FILES)) {
        test(`${what}: an error on any line of the query is marked on that line of the file`, async () => {
            const { document, actions, main, blocks } = await open(file);
            const incremental = hasIncrementalVariant(main);
            const script = dryRunScripts(main).find((candidate) => candidate.name === 'query' && candidate.incremental === incremental)!;
            const section = incremental ? 'incremental query' : 'query';
            const lines = main.sections.find((candidate) => candidate.title === section)!.sql.split('\n');
            let compared = 0;
            for (const [index, text] of lines.entries()) {
                if (text.trim() === '') {
                    continue;
                }
                const at = positionOfSectionLine(main, script, section, index);
                const result = toDryRunResult(main, script, 1, failing(`Syntax error at [${at.line}:${at.column}]`, at.line, at.column));
                const [marker, ...others] = sqlxDiagnostics(actions, [result], blocks).filter((diagnostic) => !diagnostic.message.startsWith('('));
                assert.deepStrictEqual(others, []);
                assert.strictEqual(marker.line, blocks.sqlBlock.startLine - 1 + index, `line ${index + 1} of the query`);
                const source = document.lineAt(marker.line).text;
                if (!source.includes('${')) {
                    assert.strictEqual(source.trim(), text.trim(), `line ${marker.line + 1} of ${file}`);
                    assert.strictEqual(marker.column, source.length - source.trimStart().length);
                    compared++;
                }
            }
            assert.ok(compared > 0, 'at least one line was compared with the file');
        });
    }

    const result = (action: Action, scriptName: string, response: BigQueryDryRunResponse, incremental = false): DryRunResult => {
        const script = dryRunScripts(action).find((candidate) => candidate.name === scriptName && candidate.incremental === incremental)!;
        assert.ok(script, `${action.id} has a ${scriptName} script`);
        return toDryRunResult(action, script, 1, response);
    };

    test('an error in the pre-operations is marked at the first pre_operations block, and not in the query', async () => {
        const { actions, main, blocks } = await open('definitions/0200_PLAYER_TRANSFERS.sqlx');
        // The pre-operation is the first statement of the script
        const diagnostics = sqlxDiagnostics(actions, [result(main, 'query', failing('Unrecognized system variable at [1:5]', 1, 5))], blocks);
        assert.deepStrictEqual(diagnostics, [{ line: blocks.preOpsBlock.preOpsList[0].startLine - 1, column: 0, message: '(Pre-Ops): Unrecognized system variable at [1:5]' }]);
    });

    test('an error in the post-operations is marked at the first post_operations block', async () => {
        const { actions, main, blocks } = await open('definitions/tests_for_vscode_extension/0100_MULTIPLE_PRE_POST_OPS.sqlx');
        const script = dryRunScripts(main).find((candidate) => candidate.name === 'post_operations')!;
        const lastPostOperation = script.parts[script.parts.length - 1].source;
        assert.ok(lastPostOperation.startsWith('post_operations'), lastPostOperation);
        const at = positionOfSectionLine(main, script, lastPostOperation, 0);
        const diagnostics = sqlxDiagnostics(actions, [result(main, 'post_operations', failing('Syntax error', at.line, at.column))], blocks);
        assert.deepStrictEqual(diagnostics, [{ line: blocks.postOpsBlock.postOpsList[0].startLine - 1, column: 0, message: '(Post-Ops): Syntax error' }]);
    });

    test('a pre-operation that only declares a temporary function is not marked', async () => {
        const { actions, main, blocks } = await open('definitions/0200_PLAYER_TRANSFERS.sqlx');
        const message = 'CREATE TEMPORARY FUNCTION statements must be followed by an actual query.';
        assert.deepStrictEqual(sqlxDiagnostics(actions, [result(main, 'query', failing(message, 1, 1))], blocks), []);
    });

    test('for an incremental table the incremental query is the one marked', async () => {
        const { actions, main, blocks } = await open('definitions/0300_INCREMENTAL.sqlx');
        const full = dryRunScripts(main).find((candidate) => candidate.name === 'query' && !candidate.incremental)!;
        const at = positionOfSectionLine(main, full, 'query', 1);
        assert.deepStrictEqual(sqlxDiagnostics(actions, [result(main, 'query', failing('only when rebuilt', at.line, at.column))], blocks), []);
        const marked = sqlxDiagnostics(actions, [result(main, 'query', failing('when updated', at.line, at.column), true)], blocks);
        assert.deepStrictEqual(marked.map((diagnostic) => diagnostic.line), [blocks.sqlBlock.startLine]);
    });

    test('a failing assertion generated from the config is marked at the top of the file', async () => {
        const { actions, blocks } = await open('definitions/0100_GAMES_META.sqlx');
        const assertion = actions.find((action) => action.kind === 'assertion')!;
        const diagnostics = sqlxDiagnostics(actions, [result(assertion, 'query', failing('Not found: Table x', 0, 0))], blocks);
        assert.deepStrictEqual(diagnostics, [{ line: 0, column: 0, message: '(Assertion): Not found: Table x' }]);
    });

    test('an error with no place is marked at the start of the SQL block; no error, no marker', async () => {
        const { actions, main, blocks } = await open('definitions/0100_CLUBS.sqlx');
        assert.deepStrictEqual(sqlxDiagnostics(actions, [result(main, 'query', failing('Access Denied: Table p:d.t', 0, 0))], blocks), [
            { line: blocks.sqlBlock.startLine - 1, column: 0, message: 'Access Denied: Table p:d.t' },
        ]);
        assert.deepStrictEqual(sqlxDiagnostics(actions, [result(main, 'query', fine())], blocks), []);
    });

    suite('the dry run of the current file', () => {
        // What `getCurrentFileMetadata` gives for a file, without an editor
        const fileMeta = async (file: string) => {
            setCompiled(workspaceFolder, compiled);
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspaceFolder, file)));
            const fileMetadata = await getQueryMetaForCurrentFile(file, compiled, workspaceFolder);
            return { document, curFileMeta: { fileMetadata, document, pathMeta: { filename: path.basename(file), extension: 'sqlx', relativeFilePath: file } } };
        };
        const recorder = (answer: (sql: string, action: Action) => BigQueryDryRunResponse) => {
            const sent: string[] = [];
            const run: RunDryRun = async (sql, action) => {
                sent.push(sql);
                return answer(sql, action);
            };
            return { sent, run };
        };

        test('a table with pre-operations: one dry run, handed to the panel as before, and its error marked in the file', async () => {
            const { document, curFileMeta } = await fileMeta('definitions/0200_PLAYER_TRANSFERS.sqlx');
            const collection = vscode.languages.createDiagnosticCollection('dryRunOfCurrentFile');
            try {
                // "FROM TRANSFERS" is line 18 of the file and line 7 of the query, after 1 line of pre-operations
                const { sent, run } = recorder(() => failing('Syntax error: Expected ")" but got identifier "FRM" at [8:3]', 8, 3));
                const results = await dryRunAndShowDiagnostics(curFileMeta, document, collection, true, run);

                assert.strictEqual(sent.length, 1);
                assert.ok(sent[0].startsWith('SET @@query_label = "key:value";\nWITH TRANSFERS AS ('), sent[0].slice(0, 80));
                const [entry] = curFileMeta.fileMetadata.queryMeta.tableQueries;
                assert.strictEqual(entry.dryRunQuery, sent[0]);
                assert.deepStrictEqual(entry.error, { message: 'Syntax error: Expected ")" but got identifier "FRM" at [8:3]', location: { line: 8, column: 3 } });
                assert.strictEqual(results.mainQuery, results.perTableDryRunResults[0]);
                assert.strictEqual(results.mainQuery.error.hasError, true);
                assert.deepStrictEqual(results.accessDeniedTargets, []);

                const diagnostics = collection.get(document.uri) ?? [];
                assert.strictEqual(diagnostics.length, 1);
                assert.strictEqual(diagnostics[0].range.start.line, 17);
                assert.strictEqual(document.lineAt(17).text.trim(), 'FROM TRANSFERS');
                assert.strictEqual(diagnostics[0].range.start.character, 2);
            } finally {
                collection.dispose();
            }
        });

        test('a table with assertions: each action is dry-run and its result lined up with its entry', async () => {
            const { document, curFileMeta } = await fileMeta('definitions/0100_GAMES_META.sqlx');
            const collection = vscode.languages.createDiagnosticCollection('dryRunOfCurrentFile');
            try {
                const { sent, run } = recorder((_sql, action) => ({ ...fine(), statistics: { totalBytesProcessed: action.kind === 'assertion' ? 10 : 2000 } }));
                const results = await dryRunAndShowDiagnostics(curFileMeta, document, collection, true, run);
                const { tableQueries, assertionQueries } = curFileMeta.fileMetadata.queryMeta;
                assert.strictEqual(sent.length, tableQueries.length + assertionQueries.length);
                assert.strictEqual(results.perTableDryRunResults[0].statistics?.totalBytesProcessed, 2000);
                assert.deepStrictEqual(results.perAssertionDryRunResults.map((response) => response.statistics?.totalBytesProcessed), assertionQueries.map(() => 10));
                assert.strictEqual(results.mainQuery.schema?.fields[0].name, 'id');
                assert.deepStrictEqual(collection.get(document.uri) ?? [], []);
            } finally {
                collection.dispose();
            }
        });

        test('an incremental table: both variants are dry-run, each after its own pre-operations', async () => {
            const { document, curFileMeta } = await fileMeta('definitions/0300_INCREMENTAL.sqlx');
            const collection = vscode.languages.createDiagnosticCollection('dryRunOfCurrentFile');
            try {
                const { sent, run } = recorder((sql) => ({ ...fine(), statistics: { totalBytesProcessed: sql.includes('MAX(date)') ? 5 : 500 } }));
                const results = await dryRunAndShowDiagnostics(curFileMeta, document, collection, true, run);
                assert.strictEqual(sent.length, 2);
                assert.strictEqual(results.nonIncremental.statistics?.totalBytesProcessed, 500);
                assert.strictEqual(results.incremental.statistics?.totalBytesProcessed, 5);
                const [entry] = curFileMeta.fileMetadata.queryMeta.incrementalQueries;
                assert.ok(entry.dryRunIncrementalQuery?.includes('MAX(date)') && !entry.dryRunNonIncrementalQuery?.includes('MAX(date)'));
            } finally {
                collection.dispose();
            }
        });
    });
});
