import * as assert from 'assert';
globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.errorInPreOpsDenyList = false;
globalThis.compilerOptionsMap = {};
import path from 'path';
import * as vscode from 'vscode';
import { compileDataform, formatBytes, formatDryRunCostSummary, getQueryMetaForCurrentFile, handleSemicolonPrePostOps, getDataformTags } from '../../utils';
import { setCompiled } from '../../project';
import { DataformCompiledJson } from '../../types';
import { getMetadataForSqlxFileBlocks } from '../../sqlxFileParser';
import { resolveDataformOptions } from '../../project/dataformOptions';
import { getDocumentSymbols } from '../../documentSymbols';
import { getQueryStringForPreview } from '../../previewQueryResults';

/*
WARN: The test would not be able to run if your project path is very long this is a known issue reported in https://github.com/microsoft/vscode-test/issues/232
NOTE: Also, we are having to remove `.vscode-test/user-data` before running `vscode-test` in the `npm run test` script in package.json
WARN: These tests currently are only tested to be running on mac os. We will need to change the script for `npm run test` in package.json for it to work in multiple platforms
*/
import { suite, suiteSetup, test } from 'mocha';
import { findProjectRoot } from './helper';

// Get the project root once
const projectRoot = findProjectRoot(__dirname);
const workspaceFolder = path.join(projectRoot, 'src', 'test', 'test-workspace');

// Compiling the test workspace takes ~1s, so every test that needs the compiled json shares one compile
let compiledTestWorkspace: Promise<DataformCompiledJson> | undefined;
function compileTestWorkspace(): Promise<DataformCompiledJson> {
    compiledTestWorkspace ??= compileDataform(workspaceFolder, resolveDataformOptions(workspaceFolder)).then(({ compiledString, errors }) => {
        if (errors) {
            throw new Error(JSON.stringify(errors, null, 2));
        }
        if (!compiledString) {
            throw new Error('Compilation failed');
        }
        const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
        setCompiled(workspaceFolder, dataformCompiledJson);
        return dataformCompiledJson;
    });
    return compiledTestWorkspace;
}

suite('GetMetadataForSqlxFileBlocks', () => {
    test('Config block has multiple curley braces are in the same line and sqlx file has pre_operations', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/0200_PLAYER_TRANSFERS.sqlx"));
        //console.log('[TEST] URI:', uri.toString());

        await vscode.workspace.openTextDocument(uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);
        //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);

        //config block
        assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
        assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 6);

        // Pre ops block
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 1);
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 8);
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 10);

        // sql block
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 12);
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 32);
    });

    test("Config block with assertion and has pre_operations, post_operations", async function () {
        this.timeout(9000);
        try {
            const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/099_MULTIPLE_ERRORS.sqlx"));
            //console.log('[TEST] URI:', uri.toString());
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 6);

            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 19);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 22);

            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 1);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 1);

            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 8);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 11);

            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine, 13);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].endLine, 16);

        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test('Single line config with pre_operations post_operations blocks', async () => {
        try {
            const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/0100_SINGLE_LINE_CONFIG.sqlx"));
            //console.log('[TEST] URI:', uri.toString());
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 1);

            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 11);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 12);

            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 1);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 1);

            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 3);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 5);

            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine, 7);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].endLine, 9);
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test('Multiple pre/post operation blocks are present', async () => {
        try {
            const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/0100_MULTIPLE_PRE_POST_OPS.sqlx"));
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            //config block
            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 3);

            // Pre ops block
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 2);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 6);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 8);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[1].startLine, 10);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[1].endLine, 12);

            // Post ops block
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 2);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine, 15);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].endLine, 17);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[1].startLine, 19);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[1].endLine, 21);


            // sql block
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 24);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 24);


        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });
});

suite("getDocumentSymbols", () => {
    type SymbolTree = { name: string; detail: string; children: SymbolTree[] };
    const toTree = (symbols: vscode.DocumentSymbol[]): SymbolTree[] =>
        symbols.map(symbol => ({ name: symbol.name, detail: symbol.detail, children: toTree(symbol.children) }));
    const ref = (name: string): SymbolTree => ({ name, detail: "ref", children: [] });
    const cte = (name: string, children: SymbolTree[] = []): SymbolTree => ({ name, detail: "cte", children });

    test("able to get document symbols", async function () {
        this.timeout(9000);
        const hasDatasetTableSingleLine = `\${ref("football_data", "GAMES")}`;
        const hasDataasetTableMultiline = `\${ref("football_data",\n     "GAME_EVENTS")}`;
        const hasProjectDatasetTable =         '${ref(\n' + '        "drawingfire-b72a8",\n' + '        "football_data",\n' + '        "GAME_EVENTS"\n' + '   )}';
        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/088_DOCUMENT_SYMBOLS.sqlx"));
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = getDocumentSymbols(document);

        assert.deepStrictEqual(toTree(symbols), [
            cte("PLAYERS", [ref(`\${ref("PLAYERS")}`)]),
            cte("PLAYER_VALUATIONS", [ref(`\${ref("PLAYER_VALUATIONS")}`)]),
            cte("GAMES", [ref(hasDatasetTableSingleLine)]),
            cte("GAME_EVENTS", [ref(hasDataasetTableMultiline)]),
            cte("MORE_GAME_EVENTS", [ref(hasProjectDatasetTable)]),
            { name: "raw-project.raw-dataset.raw-table", detail: "bq_table", children: [] },
        ]);
    });

    test("nests references under CTEs across WITH clauses", async function () {
        this.timeout(9000);
        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/089_CTE_SYMBOLS.sqlx"));
        const document = await vscode.workspace.openTextDocument(uri);
        const symbols = getDocumentSymbols(document);

        assert.deepStrictEqual(toTree(symbols), [
            cte("pre_cte", [ref(`\${ref("PLAYERS")}`)]),
            cte("quoted cte", [ref(`\${ref("GAMES")}`)]),
            cte("outer_cte"),
            cte("inner_cte", [{ name: "raw-project.raw-dataset.raw-table", detail: "bq_table", children: [] }]),
            cte("inc_cte"),
            ref(`\${ref("GAME_EVENTS")}`),
        ]);

        const quoted = symbols[1];
        assert.strictEqual(quoted.kind, vscode.SymbolKind.Struct);
        assert.strictEqual(document.getText(quoted.selectionRange), "quoted cte");
        assert.ok(document.getText(quoted.range).startsWith("`quoted cte` AS ("));
        assert.ok(document.getText(quoted.range).endsWith(")"));
    });
});

suite('getQueryMetaForCurrentFile', () => {
    let dataformCompiledJson: DataformCompiledJson;

    suiteSetup(async function () {
        this.timeout(20000);
        dataformCompiledJson = await compileTestWorkspace();
    });

    test("able to get model of type: table [ has assertion ]", async () => {
        const relativeFilePath = "definitions/0100_GAMES_META.sqlx";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);

        assert.strictEqual(sqlxBlockMetadata.tables.length, 2);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, "table");
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.tables[1].type, "assertion");
        assert.strictEqual(sqlxBlockMetadata.tables[1].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "table");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.operationsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");

        assert.notStrictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
        assert.ok(sqlxBlockMetadata.queryMeta.tableQueries[0]?.query);
    });

    test("able to parse .js file with notebook blocks", async () => {
        const relativeFilePath = "definitions/notebooks/notebook.js";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 2);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, "notebook");
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, "definitions/notebooks/test_one.ipynb");
        assert.strictEqual(sqlxBlockMetadata.tables[1].type, "notebook");
        assert.strictEqual(sqlxBlockMetadata.tables[1].fileName, "definitions/notebooks/test_two.ipynb");
    });

    test("able to get model of type: view", async () => {
        const relativeFilePath = "definitions/0100_CLUBS.sqlx";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, "view");
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "view");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.operationsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");

        assert.ok(sqlxBlockMetadata.queryMeta.tableQueries[0]?.query);
    });

    test("able to get model of type: incremental", async () => {
        const relativeFilePath = "definitions/0300_INCREMENTAL.sqlx";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, 'incremental');
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "incremental");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.tableQueries.length, 0);

        assert.ok(sqlxBlockMetadata.queryMeta.incrementalQueries[0]?.nonIncrementalQuery);
        assert.ok(sqlxBlockMetadata.queryMeta.incrementalQueries[0]?.incrementalQuery);
        assert.notStrictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");
        assert.notStrictEqual(sqlxBlockMetadata.queryMeta.incrementalPreOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
    });

    test("able to get model of type: assertion", async () => {
        const relativeFilePath = "definitions/assertions/0100_CLUBS_ASSER.sqlx";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, "assertion");
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "assertion");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.tableQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalPreOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");

        assert.notStrictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
    });

    test("able to get model of type: operations", async () => {
        const relativeFilePath = "definitions/0500_OPERATIONS.sqlx";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
        assert.strictEqual(sqlxBlockMetadata.tables[0].type, "operations");
        assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "operations");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.tableQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQueries.length, 0);
        assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalPreOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
        assert.strictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");

        assert.notStrictEqual(sqlxBlockMetadata.queryMeta.operationsQuery, "");
    });

    test("able to get model of type: js", async () => {
        const relativeFilePath = "definitions/010_JS_MULTIPLE.js";
        const sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
        assert.strictEqual(sqlxBlockMetadata.tables.length, 4);

        assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "js");

        sqlxBlockMetadata.tables.forEach(table => {
            assert.strictEqual(table.fileName, relativeFilePath);
        });

        const expectedTypes = ["view", "view", "assertion", "operations"];

        const expectedTargets = [
            {
                schema: "dataform",
                name: "test_js_table_1",
                database: "drawingfire-b72a8"
            },
            {
                schema: "dataform",
                name: "test_js_table_2",
                database: "drawingfire-b72a8"
            },
            {
                schema: "dataform_assertions",
                name: "test_js_assert",
                database: "drawingfire-b72a8"
            },
            {
                schema: "dataform",
                name: "test_js_ops",
                database: "drawingfire-b72a8"
            }
        ];

        expectedTypes.forEach((type, i) => assert.strictEqual(sqlxBlockMetadata.tables[i].type, type));

        sqlxBlockMetadata.tables.forEach((table, i) => {
            assert.ok(table.target, `Table ${i} should have a target`);
            assert.strictEqual(table.target.schema, expectedTargets[i].schema, `Table ${i} expected schema: ${expectedTargets[i].schema}, got: ${table.target.schema}`);
            assert.strictEqual(table.target.name, expectedTargets[i].name, `Table ${i} expected name: ${expectedTargets[i].name}, got: ${table.target.name}`);
            assert.strictEqual(table.target.database, expectedTargets[i].database, `Table ${i} expected database: ${expectedTargets[i].database}, got: ${table.target.database}`);
        });
    });
});

suite('format bytes from dry run in human readable format', () => {
    test('format bytes from dry run in human readable format', () => {
        assert.strictEqual(formatBytes(0), '0 B');
        assert.strictEqual(formatBytes(1), '1.00 B');
        assert.strictEqual(formatBytes(1024), '1.00 KiB');
        assert.strictEqual(formatBytes(1048576), '1.00 MiB');
        assert.strictEqual(formatBytes(1073741824), '1.00 GiB');
        assert.strictEqual(formatBytes(1099511627776), '1.00 TiB');
        assert.strictEqual(formatBytes(1125899906842624), '1.00 PiB');
        assert.strictEqual(formatBytes(500), '500.00 B');
        assert.strictEqual(formatBytes(1500), '1.46 KiB');
        assert.strictEqual(formatBytes(1024 * 1024 * 1.5), '1.50 MiB');
    });
});

suite('formatDryRunCostSummary', () => {
    const oneGiB = 1024 ** 3;
    const buildResult = (statistics: any, hasError = false): any => ({
        statistics,
        error: { hasError, message: hasError ? 'boom' : '' }
    });

    test('formats a precise estimate', () => {
        const result = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'PRECISE'
        });
        assert.strictEqual(formatDryRunCostSummary(result, '', '$'), '1.00 GiB $0.006');
    });

    test('prefixes bound estimates and prepends the label', () => {
        const upperBound = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'UPPER_BOUND'
        });
        assert.strictEqual(formatDryRunCostSummary(upperBound, 'Incremental', '$'), 'Incremental: Up to 1.00 GiB $0.006');

        const lowerBound = buildResult({
            totalBytesProcessed: oneGiB,
            cost: { currency: 'USD', value: 0.00625 },
            totalBytesProcessedAccuracy: 'LOWER_BOUND'
        });
        assert.strictEqual(formatDryRunCostSummary(lowerBound, '', '$'), 'At least 1.00 GiB $0.006');
    });

    test('replaces the 0 bytes UNKNOWN reports with a warning', () => {
        // BigQuery reports totalBytesProcessed "0" whenever accuracy is UNKNOWN
        const result = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SELECT',
            totalBytesProcessedAccuracy: 'UNKNOWN',
            bytesEstimateUnknown: true
        });
        assert.strictEqual(formatDryRunCostSummary(result, '', '$'), '\u26a0 Bytes unknown');
        assert.strictEqual(formatDryRunCostSummary(result, 'Incremental', '$'), 'Incremental: \u26a0 Bytes unknown');
    });

    test('warns for scripts whose bytes could not be computed', () => {
        const unknownScript = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SCRIPT',
            totalBytesProcessedAccuracy: 'UNKNOWN',
            bytesEstimateUnknown: true
        });
        assert.strictEqual(formatDryRunCostSummary(unknownScript, '', '$'), '\u26a0 Bytes unknown');

        // A script with a non-precise but known accuracy keeps the existing note
        const lowerBoundScript = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 },
            statementType: 'SCRIPT',
            totalBytesProcessedAccuracy: 'LOWER_BOUND'
        });
        assert.strictEqual(
            formatDryRunCostSummary(lowerBoundScript, '', '$'),
            'NOTE: Could not compute bytes processed estimate for script.'
        );
    });

    test('returns an empty string when there is nothing to show', () => {
        assert.strictEqual(formatDryRunCostSummary(undefined, '', '$'), '');
        assert.strictEqual(formatDryRunCostSummary(buildResult({ totalBytesProcessed: 0 }), '', '$'), '');
        const erroredResult = buildResult({
            totalBytesProcessed: 0,
            cost: { currency: 'USD', value: 0 }
        }, true);
        assert.strictEqual(formatDryRunCostSummary(erroredResult, '', '$'), '');
    });
});

suite('handleSemicolonPrePostOps', () => {

    test(`Termination of different preOps e.g.
        1. nonIncrementalPreOpsQuery has new lines at the end, they should be removed and semicolon added on the same line as where the comment ends
        2. incrementalPreOpsQuery has already a semicolon at the end, so no change is needed
        3. If the query is empty, no change is needed`, () => {
        const fileMetadata = {
            tables: [],
            queryMeta: {
                // simulating scenario when there is a comment before incrementalPreOpsQuery and there is no non-incrementalPreOpsQuery
                preOpsQuery: `
                DECLARE MY_VAR INT64;
                SET MY_VAR = 1;
                -- delete the previous day's data



                `,
                incrementalPreOpsQuery: "SELECT 2;",
                postOpsQuery: "",
                type: "",
                tableOrViewQuery: "",
                nonIncrementalQuery: "",
                incrementalQuery: "",
                assertionQuery: "",
                operationsQuery: "",
                error: "",
            }
        };

        const result = handleSemicolonPrePostOps(fileMetadata as any);

        assert.strictEqual(result.queryMeta.preOpsQuery, `
                DECLARE MY_VAR INT64;
                SET MY_VAR = 1;
                -- delete the previous day's data;
`);
        assert.strictEqual(result.queryMeta.incrementalPreOpsQuery, "SELECT 2;");
        assert.strictEqual(result.queryMeta.postOpsQuery, "");
    });

});

suite("getQueryStringForPreview skipPreOps", () => {
    const PRE_OPS = "DELETE FROM `proj.ds.tbl` WHERE date = '2024-01-01';";
    const INC_PRE_OPS = "DELETE FROM `proj.ds.tbl` WHERE date BETWEEN start AND end;";
    const SELECT = "SELECT date, COUNT(*) AS events FROM `proj.ds.src` GROUP BY date";

    const buildFileMetadata = (type: string) => ({
        tables: [],
        queryMeta: {
            type,
            preOpsQuery: PRE_OPS,
            incrementalPreOpsQuery: INC_PRE_OPS,
            postOpsQuery: "",
            assertionQuery: "",
            assertionQueries: [],
            tableQueries: [{ targetName: "t", query: SELECT, preOpsQuery: PRE_OPS }],
            incrementalQueries: [{
                targetName: "t",
                incrementalQuery: SELECT,
                nonIncrementalQuery: SELECT,
                preOpsQuery: PRE_OPS,
                incrementalPreOpsQuery: INC_PRE_OPS,
            }],
            operationQueries: [],
            operationsQuery: SELECT,
            testQuery: "",
            expectedOutputQuery: "",
            testQueries: [],
            error: "",
        }
    });

    test("table: includes pre-ops when skipPreOps is false", () => {
        const query = getQueryStringForPreview(buildFileMetadata("table") as any, false, false);
        assert.ok(query.includes(PRE_OPS), "expected pre-ops to be included");
        assert.ok(query.includes(SELECT), "expected select to be included");
    });

    test("table: excludes pre-ops when skipPreOps is true", () => {
        const query = getQueryStringForPreview(buildFileMetadata("table") as any, false, true);
        assert.ok(!query.includes(PRE_OPS), "expected pre-ops to be excluded");
        assert.strictEqual(query, SELECT);
    });

    test("view: excludes pre-ops when skipPreOps is true", () => {
        const query = getQueryStringForPreview(buildFileMetadata("view") as any, false, true);
        assert.strictEqual(query, SELECT);
    });

    test("operations: excludes pre-ops when skipPreOps is true", () => {
        const withPreOps = getQueryStringForPreview(buildFileMetadata("operations") as any, false, false);
        assert.ok(withPreOps.includes(PRE_OPS));
        const skipped = getQueryStringForPreview(buildFileMetadata("operations") as any, false, true);
        assert.strictEqual(skipped, SELECT);
    });

    test("incremental (isIncremental=true): excludes incremental pre-ops when skipPreOps is true", () => {
        const withPreOps = getQueryStringForPreview(buildFileMetadata("incremental") as any, true, false);
        assert.ok(withPreOps.includes(INC_PRE_OPS));
        const skipped = getQueryStringForPreview(buildFileMetadata("incremental") as any, true, true);
        assert.ok(!skipped.includes(INC_PRE_OPS), "expected incremental pre-ops to be excluded");
        assert.strictEqual(skipped, SELECT);
    });

    test("incremental (isIncremental=false): excludes pre-ops when skipPreOps is true", () => {
        const withPreOps = getQueryStringForPreview(buildFileMetadata("incremental") as any, false, false);
        assert.ok(withPreOps.includes(PRE_OPS));
        const skipped = getQueryStringForPreview(buildFileMetadata("incremental") as any, false, true);
        assert.strictEqual(skipped, SELECT);
    });

});

suite('getDataformTags', () => {

    test("tags are collected from tables, assertions, operations and notebooks", async function () {
        this.timeout(20000);
        const dataformTags = await getDataformTags(await compileTestWorkspace());

        // FOOTY is on multiple tables, so this also asserts that tags are de-duplicated
        assert.deepStrictEqual(dataformTags, ["FOOTY", "OPS_TAG", "new_tag", "tag2"]);
    });

    test("no tags are returned when the compiled json has no actions", async function () {
        let dataformTags = await getDataformTags({} as DataformCompiledJson);
        assert.deepStrictEqual(dataformTags, []);
    });

});
