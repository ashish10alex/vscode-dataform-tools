import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { compileDataform, formatBytes, getQueryMetaForCurrentFile, handleSemicolonPrePostOps } from '../../utils';
import { DataformCompiledJson } from '../../types';
import { getMetadataForSqlxFileBlocks } from '../../sqlxFileParser';
import { tableQueryOffset } from '../../constants';
import { setDiagnostics } from '../../setDiagnostics';

/*
WARN: The test would not be able to run if your project path is very long this is a known issue reported in https://github.com/microsoft/vscode-test/issues/232
NOTE: Also, we are having to remove `.vscode-test/user-data` before running `vscode-test` in the `npm run test` script in package.json
WARN: These tests currently are only tested to be running on mac os. We will need to change the script for `npm run test` in package.json for it to work in multiple platforms
*/
import { suite, test } from 'mocha';
import { findProjectRoot } from './helper';

// Get the project root once
const projectRoot = findProjectRoot(__dirname);
const testWorkspacePath = path.join(projectRoot, 'src', 'test', 'test-workspace');

suite('GetMetadataForSqlxFileBlocks', () => {
    test('Config block has multiple curley braces are in the same line and sqlx file has pre_operations', async () => {
        const uri = vscode.Uri.file(path.join(testWorkspacePath, "definitions/0200_PLAYER_TRANSFERS.sqlx"));
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

    test("Config block with assertion and has pre_operations, post_operations", async function() {
        this.timeout(9000);
        try {
            const uri = vscode.Uri.file(path.join(testWorkspacePath, "definitions/tests_for_vscode_extension/099_MULTIPLE_ERRORS.sqlx"));
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
            const uri = vscode.Uri.file(path.join(testWorkspacePath, "definitions/tests_for_vscode_extension/0100_SINGLE_LINE_CONFIG.sqlx"));
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
            const uri = vscode.Uri.file(path.join(testWorkspacePath, "definitions/tests_for_vscode_extension/0100_MULTIPLE_PRE_POST_OPS.sqlx"));
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
    test("Able to set multiple diagnostics at correct line numbers", function(done) {
        this.timeout(9000);

        const uri = vscode.Uri.file(path.join(testWorkspacePath, "definitions/tests_for_vscode_extension/099_MULTIPLE_ERRORS.sqlx"));

        (async () => {
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

                let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
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
                let allDiagnostics = vscode.languages.getDiagnostics(document.uri);

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


                done();
            } catch (error) {
                console.error('Test failed:', error);
                done(error);
            }
        })();
    });
});

suite('getQueryMetaForCurrentFile', () => {

    test("able to get model of type: table [ has assertion ]", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0100_GAMES_META.sqlx";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);

                    assert.strictEqual(sqlxBlockMetadata.tables.length, 2);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "table");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.tables[1].type, "assertion");
                    assert.strictEqual(sqlxBlockMetadata.tables[1].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "table");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.operationsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.nonIncrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");

                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.tableOrViewQuery, "");
                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(errors.join('\n'));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });


    test("able to get model of type: view", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0100_CLUBS.sqlx";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "view");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "view");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.operationsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.nonIncrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");

                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.tableOrViewQuery, "");
                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(errors.join('\n'));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: incremental", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0300_INCREMENTAL.sqlx";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, 'incremental');
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "incremental");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.tableOrViewQuery, "");

                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.nonIncrementalQuery, "");
                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.incrementalQuery, "");
                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");
                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.incrementalPreOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(errors.join('\n'));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: assertion", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/assertions/0100_CLUBS_ASSER.sqlx";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "assertion");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "assertion");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.tableOrViewQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.nonIncrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.preOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalPreOpsQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.postOpsQuery, "");

                    assert.notStrictEqual(sqlxBlockMetadata.queryMeta.assertionQuery, "");

                } else {
                    throw new Error('Compilation failed');
                }
            }
            if (errors) {
                throw new Error(errors.join('\n'));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: operations", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0500_OPERATIONS.sqlx";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "operations");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "operations");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.tableOrViewQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.nonIncrementalQuery, "");
                    assert.strictEqual(sqlxBlockMetadata.queryMeta.incrementalQuery, "");
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
                throw new Error(errors.join('\n'));
            }
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

    test("able to get model of type: js", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/010_JS_MULTIPLE.js";
            let { compiledString, errors } = await compileDataform(testWorkspacePath);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
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
                throw new Error(errors.join('\n'));
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
        assert.strictEqual(formatBytes(1024), '1.00 KB');
        assert.strictEqual(formatBytes(1048576) ,'1.00 MB');
        assert.strictEqual(formatBytes(1073741824), '1.00 GB');
        assert.strictEqual(formatBytes(1099511627776), '1.00 TB');
        assert.strictEqual(formatBytes(1125899906842624), '1.00 PB');
        assert.strictEqual(formatBytes(500), '500.00 B');
        assert.strictEqual(formatBytes(1500), '1.46 KB');
        assert.strictEqual(formatBytes(1024 * 1024 * 1.5), '1.50 MB');
    });
});

suite('handleSemicolonPrePostOps', () => {

    test(`Termination of different preOps e.g. there is new line at the end of the query
         , no semicolons on the end or if the query is empty`, () => {
        const fileMetadata = {
            tables: [],
            queryMeta: {
                preOpsQuery: "SELECT 1\n\n",
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

        assert.strictEqual(result.queryMeta.preOpsQuery, "SELECT 1;\n");
        assert.strictEqual(result.queryMeta.incrementalPreOpsQuery, "SELECT 2;");
        assert.strictEqual(result.queryMeta.postOpsQuery, "");
    });

});
