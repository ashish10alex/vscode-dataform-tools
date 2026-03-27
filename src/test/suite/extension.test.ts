import * as assert from 'assert';
globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.errorInPreOpsDenyList = false;
globalThis.compilerOptionsMap = {};
import path from 'path';
import * as vscode from 'vscode';
import { compileDataform, formatBytes, getQueryMetaForCurrentFile, handleSemicolonPrePostOps, buildIndices } from '../../utils';
import { DataformCompiledJson } from '../../types';
import { getMetadataForSqlxFileBlocks } from '../../sqlxFileParser';
import { tableQueryOffset, incrementalTableOffset } from '../../constants';
import { setDiagnostics } from '../../setDiagnostics';
import { calculateIncrementalSkipPreOpsOffset } from '../../offsetCalculations';
import { getDocumentSymbols } from '../../documentSymbols';

/*
WARN: The test would not be able to run if your project path is very long this is a known issue reported in https://github.com/microsoft/vscode-test/issues/232
NOTE: Also, we are having to remove `.vscode-test/user-data` before running `vscode-test` in the `npm run test` script in package.json
WARN: These tests currently are only tested to be running on mac os. We will need to change the script for `npm run test` in package.json for it to work in multiple platforms
*/
import { suite, test } from 'mocha';
import { findProjectRoot } from './helper';

// Get the project root once
const projectRoot = findProjectRoot(__dirname);
const workspaceFolder = path.join(projectRoot, 'src', 'test', 'test-workspace');

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

suite("setDiagnostics", () => {
    test("Able to set multiple diagnostics at correct line numbers", async function () {
        this.timeout(9000);

        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/099_MULTIPLE_ERRORS.sqlx"));
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            assert.ok(document, 'Document should be opened');

            /**Error line number is the line number where the error is in the sql block.
             * The spaces in front of the sql block are trimmed out before sending it to BigQuery Api
             */
            const mockDryRunError = {
                hasError: true,
                message: "(fullQuery): Query error: Function not found: URRENT_DATE; Did you mean current_date? at [8:5]",
                location: {
                    line: 8,
                    column: 5
                }
            };


            let mockPreOpsDryRunError = {
                hasError: true,
                message: "(preOps): Variable declarations are allowed only at the start of a block or script at [3:2]",
                location: {
                    line: 3,
                    column: 2
                }
            };

            let mockPostOpsDryRunError = {
                hasError: true,
                message: "(postOps): Function not found: URRENT_TIMESTAMP; Did you mean current_timestamp? at [3:6]",
                location: {
                    line: 3,
                    column: 6
                }
            };

            let configBlockMeta = {
                startLine: 1,
                endLine: 6,
                exists: true,
            };

            let sqlBlockMeta = {
                startLine: 19,
                endLine: 22,
                exists: true,
            };

            let jsBlockMeta = {
                startLine: 0,
                endLine: 0,
                exists: false,
            };

            let preOpsList = [
                {
                    startLine: 8,
                    endLine: 11,
                    exists: true,
                }
            ];

            let postOpsList = [
                {
                    startLine: 13,
                    endLine: 16,
                    exists: true,
                }
            ];

            let mockSqlxBlockMetadata = {
                configBlock: configBlockMeta,
                preOpsBlock: { preOpsList: preOpsList },
                postOpsBlock: { postOpsList: postOpsList },
                sqlBlock: sqlBlockMeta,
                jsBlock: jsBlockMeta,
            };

            let errorMeta = {
                mainQueryError: mockDryRunError,
                preOpsError: mockPreOpsDryRunError,
                postOpsError: mockPostOpsDryRunError,
                nonIncrementalError: {
                    hasError: false,
                    message: "",
                    location: undefined,
                },
                incrementalError: {
                    hasError: false,
                    message: "",
                    location: undefined,
                },
                assertionError: {
                    hasError: false,
                    message: "",
                    location: undefined,
                },
            };
            setDiagnostics(document, errorMeta, diagnosticCollection, mockSqlxBlockMetadata, tableQueryOffset);
            let allDiagnostics = diagnosticCollection.get(document.uri) ?? [];

            const exppectedCountOfDiagnostics = 3;
            assert.deepEqual(allDiagnostics.length, exppectedCountOfDiagnostics, `Expected ${exppectedCountOfDiagnostics} diagnostic, got ${allDiagnostics.length}`);

            let fullQueryDiagnosticRange = allDiagnostics[0].range;
            const expectedLineNumber = 21;
            assert.deepEqual(fullQueryDiagnosticRange.start.line, expectedLineNumber, `Expected diagnostic on line ${expectedLineNumber}, got ${fullQueryDiagnosticRange.start.line}`);

            let preOpsDiagnosticRange = allDiagnostics[1].range;
            const expectedPreOpsLineNumber = 7;
            assert.deepEqual(preOpsDiagnosticRange.start.line, expectedPreOpsLineNumber, `Expected diagnostic on line ${expectedPreOpsLineNumber}, got ${preOpsDiagnosticRange.start.line}`);

            let postOpsDiagnosticRange = allDiagnostics[2].range;
            const expectedPostOpsLineNumber = 12;
            assert.deepEqual(postOpsDiagnosticRange.start.line, expectedPostOpsLineNumber, `Expected diagnostic on line ${expectedPostOpsLineNumber}, got ${postOpsDiagnosticRange.start.line}`);

        } finally {
            diagnosticCollection.dispose();
        }
    });
});

suite("setDiagnostics incremental", () => {
    test("Places main query diagnostic at correct line for incremental model with pre_operations", async function () {
        this.timeout(9000);

        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/0300_INCREMENTAL.sqlx"));
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('incrementalDiagnostics');

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            assert.ok(document, 'Document should be opened');

            // Simulated BigQuery error at compiled query line 11.
            // The combined dry-run query is: withPreOps(incrementalPreOpsQuery, incrementalQuery)
            // The incrementalPreOpsQuery for this model has 9 lines (including leading/trailing
            // empty lines from Dataform's compiled output). With incrementalTableOffset=1 preamble:
            //   Lines 1-9:  compiled pre-ops (DECLARE ... with surrounding whitespace)
            //   Line 10:    blank separator line (trailing \n in pre-ops + \n from withPreOps)
            //   Line 11:    ELECT   <- main SQL line 1, editor line 14 (0-indexed: 13)
            const mockDryRunError = {
                hasError: true,
                message: "(incrementalQuery): Syntax error: Unexpected identifier \"ELECT\" at [11:1]",
                location: { line: 11, column: 1 }
            };

            // 0300_INCREMENTAL.sqlx block positions (1-indexed from parser):
            //   config:    lines 1-3
            //   pre_ops:   lines 5-11
            //   sql block: starts at line 14
            let mockSqlxBlockMetadata = {
                configBlock: { startLine: 1, endLine: 3, exists: true },
                preOpsBlock: { preOpsList: [{ startLine: 5, endLine: 11, exists: true }] },
                postOpsBlock: { postOpsList: [] },
                sqlBlock: { startLine: 14, endLine: 18, exists: true },
                jsBlock: { startLine: 0, endLine: 0, exists: false },
            };

            let errorMeta = {
                mainQueryError: mockDryRunError,
                preOpsError: { hasError: false, message: "", location: undefined },
                postOpsError: { hasError: false, message: "", location: undefined },
                nonIncrementalError: { hasError: false, message: "", location: undefined },
                incrementalError: { hasError: false, message: "", location: undefined },
                assertionError: { hasError: false, message: "", location: undefined },
            };

            // compiledPreOpsLineCount=9: the incremental pre_operations string has 9 lines
            // (including leading/trailing empty lines from Dataform's compiled output).
            // preOpsOffset = 9 + 2 = 11 (not 7 as the raw editor block count would suggest).
            // Expected: errLineNumber = (14 + (11 - 1)) - 11 = 13 (0-indexed) = editor line 14 = ELECT
            const compiledPreOpsLineCount = 9;
            setDiagnostics(document, errorMeta, diagnosticCollection, mockSqlxBlockMetadata, incrementalTableOffset, compiledPreOpsLineCount);

            let allDiagnostics = diagnosticCollection.get(document.uri) ?? [];
            assert.deepEqual(allDiagnostics.length, 1, `Expected 1 diagnostic, got ${allDiagnostics.length}`);

            const expectedLineNumber = 13; // 0-indexed: editor line 14 = SELECT
            assert.deepEqual(allDiagnostics[0].range.start.line, expectedLineNumber,
                `Expected diagnostic on line ${expectedLineNumber}, got ${allDiagnostics[0].range.start.line}`);

        } finally {
            diagnosticCollection.dispose();
        }
    });
});

suite("setDiagnostics with skipPreOpsInDryRun", () => {
    test("Places main query diagnostic at correct line for table model when pre_ops are skipped in dry run", async function () {
        this.timeout(9000);

        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/0200_PLAYER_TRANSFERS.sqlx"));
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('skipPreOpsDiagnostics');

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            assert.ok(document, 'Document should be opened');

            // Simulated BigQuery error: "FRM" instead of "FROM" inside a CTE.
            // When skipPreOpsInDryRun=true the query sent to BigQuery is just tq.query
            // (no pre_ops). tq.query has tableQueryOffset=2 preamble blank lines, so
            // BQ line 7 corresponds to the SQL content line that contains the typo.
            //
            // 0200_PLAYER_TRANSFERS.sqlx block positions (1-indexed from parser):
            //   config:    lines 1-6
            //   pre_ops:   lines 8-10  (startLine=8, endLine=10)
            //   sql block: starts at line 12
            //
            // Expected: errLineNumber = (12 + (7 - 2)) - 0 = 17 (0-indexed)
            //           = editor line 18 = the line with the SQL typo
            const mockDryRunError = {
                hasError: true,
                message: "Syntax error: Expected \")\" but got identifier \"FRM\" at [7:3]",
                location: { line: 7, column: 3 }
            };

            let mockSqlxBlockMetadata = {
                configBlock: { startLine: 1, endLine: 6, exists: true },
                preOpsBlock: { preOpsList: [{ startLine: 8, endLine: 10, exists: true }] },
                postOpsBlock: { postOpsList: [] },
                sqlBlock: { startLine: 12, endLine: 32, exists: true },
                jsBlock: { startLine: 0, endLine: 0, exists: false },
            };

            let errorMeta = {
                mainQueryError: mockDryRunError,
                preOpsError: { hasError: false, message: "", location: undefined },
                postOpsError: { hasError: false, message: "", location: undefined },
                nonIncrementalError: { hasError: false, message: "", location: undefined },
                incrementalError: { hasError: false, message: "", location: undefined },
                assertionError: { hasError: false, message: "", location: undefined },
                testError: { hasError: false, message: "", location: undefined },
                expectedOutputError: { hasError: false, message: "", location: undefined },
            };

            // preOpsSkippedInDryRun=true: pre_ops not included in the BQ query,
            // so preOpsOffset must be 0 regardless of the pre_ops block size.
            setDiagnostics(document, errorMeta, diagnosticCollection, mockSqlxBlockMetadata, tableQueryOffset, undefined, true);

            let allDiagnostics = diagnosticCollection.get(document.uri) ?? [];
            assert.deepEqual(allDiagnostics.length, 1, `Expected 1 diagnostic, got ${allDiagnostics.length}`);

            const expectedLineNumber = 17; // 0-indexed: editor line 18 = SQL typo line
            assert.deepEqual(allDiagnostics[0].range.start.line, expectedLineNumber,
                `Expected diagnostic on line ${expectedLineNumber}, got ${allDiagnostics[0].range.start.line}`);

        } finally {
            diagnosticCollection.dispose();
        }
    });

    test("calculateIncrementalSkipPreOpsOffset returns N_inc_preamble - 1", () => {
        // 3 blank preamble lines → compiledPreOpsLineCount = 2 → preOpsOffset = 4
        assert.strictEqual(calculateIncrementalSkipPreOpsOffset("\n\n\nSELECT *"), 2);
        // 1 blank preamble line → compiledPreOpsLineCount = 0 → preOpsOffset = 2
        assert.strictEqual(calculateIncrementalSkipPreOpsOffset("\nSELECT *"), 0);
        // 0 blank preamble lines → compiledPreOpsLineCount = -1 → preOpsOffset = 1
        assert.strictEqual(calculateIncrementalSkipPreOpsOffset("SELECT *"), -1);
        // undefined input → undefined (no pre_ops block to check against)
        assert.strictEqual(calculateIncrementalSkipPreOpsOffset(undefined), undefined);
    });

    test("Places main query diagnostic at correct line for incremental model when pre_ops are skipped in dry run", async function () {
        this.timeout(9000);

        const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/0300_INCREMENTAL.sqlx"));
        const diagnosticCollection = vscode.languages.createDiagnosticCollection('incrementalSkipPreOpsDiagnostics');

        try {
            const document = await vscode.workspace.openTextDocument(uri);
            assert.ok(document, 'Document should be opened');

            // Simulates an incremental model where iq.incrementalQuery has 3 blank
            // preamble lines (N_inc_preamble=3) and the BQ error is at [25:3].
            // calculateIncrementalSkipPreOpsOffset returns N_inc_preamble - 1 = 2.
            // preOpsOffset = 2 + 2 = 4.
            // sqlBlock.startLine = 17 (mock, matching the FACT_ALLOCATION_PLAN_ALL_SNAP scenario).
            // Expected: (17 + (25 - 1)) - 4 = 37 (0-indexed) = editor line 38.
            const mockDryRunError = {
                hasError: true,
                message: "Unrecognized name: DEF_SPEC_CODE_ALLO at [25:3]",
                location: { line: 25, column: 3 }
            };

            let mockSqlxBlockMetadata = {
                configBlock: { startLine: 1, endLine: 14, exists: true },
                preOpsBlock: { preOpsList: [{ startLine: 50, endLine: 62, exists: true }] },
                postOpsBlock: { postOpsList: [] },
                sqlBlock: { startLine: 17, endLine: 46, exists: true },
                jsBlock: { startLine: 0, endLine: 0, exists: false },
            };

            let errorMeta = {
                mainQueryError: mockDryRunError,
                preOpsError: { hasError: false, message: "", location: undefined },
                postOpsError: { hasError: false, message: "", location: undefined },
                nonIncrementalError: { hasError: false, message: "", location: undefined },
                incrementalError: { hasError: false, message: "", location: undefined },
                assertionError: { hasError: false, message: "", location: undefined },
                testError: { hasError: false, message: "", location: undefined },
                expectedOutputError: { hasError: false, message: "", location: undefined },
            };

            // compiledPreOpsLineCount = calculateIncrementalSkipPreOpsOffset("\n\n\nSELECT *") = 2
            // preOpsOffset = 2 + 2 = 4
            const compiledPreOpsLineCount = calculateIncrementalSkipPreOpsOffset("\n\n\nSELECT *");
            setDiagnostics(document, errorMeta, diagnosticCollection, mockSqlxBlockMetadata, incrementalTableOffset, compiledPreOpsLineCount);

            let allDiagnostics = diagnosticCollection.get(document.uri) ?? [];
            assert.deepEqual(allDiagnostics.length, 1, `Expected 1 diagnostic, got ${allDiagnostics.length}`);

            const expectedLineNumber = 37; // 0-indexed: editor line 38 = DEF_SPEC_CODE_ALLO
            assert.deepEqual(allDiagnostics[0].range.start.line, expectedLineNumber,
                `Expected diagnostic on line ${expectedLineNumber}, got ${allDiagnostics[0].range.start.line}`);

        } finally {
            diagnosticCollection.dispose();
        }
    });
});

suite("getDocumentSymbols", () => {
    test("able to get document symbols", async function () {
        this.timeout(9000);
        const hasDatasetTableSingleLine = `\${ref("football_data", "GAMES")}`;
        const hasDataasetTableMultiline = `\${ref("football_data",\n     "GAME_EVENTS")}`;
        const hasProjectDatasetTable =         '${ref(\n' + '        "drawingfire-b72a8",\n' + '        "football_data",\n' + '        "GAME_EVENTS"\n' + '   )}';
        const expectedSymbolNames = [
            `\${ref("PLAYERS")}`, 
            `\${ref("PLAYER_VALUATIONS")}`, 
            hasDatasetTableSingleLine, 
            hasDataasetTableMultiline, 
            hasProjectDatasetTable,
            "raw-project.raw-dataset.raw-table"
        ];
        const expectedSymbolTypes = ["ref", "ref", "ref", "ref", "ref", "bq_table"];
        const expectedSymbolCount = 6;
        try {
            const uri = vscode.Uri.file(path.join(workspaceFolder, "definitions/tests_for_vscode_extension/088_DOCUMENT_SYMBOLS.sqlx"));
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = getDocumentSymbols(document);
            symbols.forEach((symbol, index) => {
                assert.strictEqual(symbol.name, expectedSymbolNames[index], `Expected symbol name at index ${index}: ${expectedSymbolNames[index]}, got: ${symbol.name}`);
                assert.strictEqual(symbol.detail, expectedSymbolTypes[index], `Expected symbol detail (type) at index ${index}: ${expectedSymbolTypes[index]}, got: ${symbol.detail}`);
            });
            assert.strictEqual(symbols.length, expectedSymbolCount, `Expected ${expectedSymbolCount} symbols, got: ${symbols.length}`);
        } catch (error: any) {
            throw error;
        }
    });
});

suite('getQueryMetaForCurrentFile', () => {

    test("able to get model of type: table [ has assertion ]", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0100_GAMES_META.sqlx";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);

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
                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to parse .js file with notebook blocks", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/notebooks/notebook.js";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    // console.log('[DEBUG] sqlxBlockMetadata:', JSON.stringify(sqlxBlockMetadata, null, 2));
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 2);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "notebook");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, "definitions/notebooks/test_one.ipynb");
                    assert.strictEqual(sqlxBlockMetadata.tables[1].type, "notebook");
                    assert.strictEqual(sqlxBlockMetadata.tables[1].fileName, "definitions/notebooks/test_two.ipynb");
                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });



    test("able to get model of type: view", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0100_CLUBS.sqlx";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
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
                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: incremental", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0300_INCREMENTAL.sqlx";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
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

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: assertion", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/assertions/0100_CLUBS_ASSER.sqlx";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
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

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: operations", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0500_OPERATIONS.sqlx";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
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

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: js", async function () {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/010_JS_MULTIPLE.js";
            let { compiledString, errors } = await compileDataform(workspaceFolder);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    buildIndices(dataformCompiledJson);
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson, workspaceFolder);
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

                    sqlxBlockMetadata.tables.forEach(table => {
                        assert.strictEqual(table.fileName, relativeFilePath);
                    });

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(JSON.stringify(errors, null, 2));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
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
        assert.strictEqual(result.queryMeta.incrementalPreOpsQuery, result.queryMeta.incrementalPreOpsQuery);
        assert.strictEqual(result.queryMeta.postOpsQuery, result.queryMeta.postOpsQuery);
    });

});
