
import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
//import { getMetadataForSqlxFileBlocks } from "../../sqlxFileParser";
//import { tableQueryOffset } from '../../constants';
//import { setDiagnostics } from '../../setDiagnostics';
import { compileDataform, getQueryMetaForCurrentFile, runCompilation } from '../../utils';
import { DataformCompiledJson } from '../../types';
import { getMetadataForSqlxFileBlocks } from '../../sqlxFileParser';


suite('GetMetadataForSqlxFileBlocks', () => {
    test('Config block has multiple curley braces are in the same line and sqlx file has pre_operations', async function() {
        this.timeout(9000);

        const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
        const uri = vscode.Uri.file(path.join(workspacePath, "definitions/0200_PLAYER_TRANSFERS.sqlx"));
        //console.log('[TEST] URI:', uri.toString());

        await vscode.workspace.openTextDocument(uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);
        //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);

        /**config block */
        assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
        assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 6);

        /** Pre ops block */
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 1);
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 8);
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 10);

        /** sql block */
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 12);
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 32);
    });

    test("Config block with assertion and has pre_operations, post_operations", async function() {
        this.timeout(9000);
        try {
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            const uri = vscode.Uri.file(path.join(workspacePath, "definitions/099_MULTIPLE_ERRORS.sqlx"));
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
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            const uri = vscode.Uri.file(path.join(workspacePath, "definitions/0100_SINGLE_LINE_CONFIG.sqlx"));
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
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            const uri = vscode.Uri.file(path.join(workspacePath, "definitions/0100_MULTIPLE_PRE_POST_OPS.sqlx"));
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            /**config block */
            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 3);

            /** Pre ops block */
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 2);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 6);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 8);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[1].startLine, 10);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[1].endLine, 12);

            /** Post ops block */
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 2);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine, 15);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].endLine, 17);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[1].startLine, 19);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[1].endLine, 21);


            /** sql block */
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 24);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 24);


        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });
});

//
//suite('setDiagnostics', () => {
//    test('Table: error set on the correct line when pre/post operations are present', function(done) {
//        this.timeout(9000);
//
//        const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
//        const uri = vscode.Uri.file(path.join(workspacePath, 'definitions/0100_TEST.sqlx'));
//
//        (async () => {
//            try {
//                const document = await vscode.workspace.openTextDocument(uri);
//                assert.ok(document, 'Document should be opened');
//
//                let offSet = tableQueryOffset;
//
//                /**Error line number is the line number where the error is in the sql block.
//                 * The spaces in front of the sql block are trimmed out before sending it to BigQuery Api
//                 */
//                let mockDryRunError = {
//                    hasError: true,
//                    message: "Unfortunate error",
//                    location: {
//                        line: 2,
//                        column: 1
//                    }
//                };
//
//                let mockPreOpsDryRunError = {
//                    hasError: false,
//                    message: "",
//                    location: {
//                        line: 0,
//                        column: 0
//                    }
//                };
//
//                let mockPostOpsDryRunError = {
//                    hasError: false,
//                    message: "",
//                    location: {
//                        line: 0,
//                        column: 0
//                    }
//                };
//
//                let configBlockMeta = {
//                    startLine: 1,
//                    endLine: 5,
//                    exists: true,
//                };
//
//                let sqlBlockMeta = {
//                    startLine: 20,
//                    endLine: 22,
//                    exists: true,
//                };
//
//                let jsBlockMeta = {
//                    startLine: 0,
//                    endLine: 0,
//                    exists: false,
//                };
//
//                let mockSqlxBlockMetadata = {
//                    configBlock: configBlockMeta,
//                    preOpsBlock: { preOpsList: [] },
//                    postOpsBlock: { postOpsList: [] },
//                    sqlBlock: sqlBlockMeta,
//                    jsBlock: jsBlockMeta,
//                };
//
//                let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
//                setDiagnostics(document, mockDryRunError, mockPreOpsDryRunError, mockPostOpsDryRunError, diagnosticCollection, mockSqlxBlockMetadata, offSet);
//                let allDiagnostics = vscode.languages.getDiagnostics(document.uri);
//                assert.deepEqual(allDiagnostics.length, 1);
//                let diagnosticRange = allDiagnostics[0].range;
//                assert.deepEqual(diagnosticRange.start.line, 20);
//
//
//                done();
//            } catch (error) {
//                console.error('Test failed:', error);
//                done(error);
//            }
//        })();
//    });
//});

suite('getQueryMetaForCurrentFile', () => {
    test("able to get model of type: view", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0100_CLUBS.sqlx";
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            let { compiledString, errors, possibleResolutions } = await compileDataform(workspacePath, false);
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
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            let { compiledString, errors, possibleResolutions } = await compileDataform(workspacePath, false);
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
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            let { compiledString, errors, possibleResolutions } = await compileDataform(workspacePath, false);
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

    test("able to get model of type: operation", async function() {
        this.timeout(9000);
        try {
            const relativeFilePath = "definitions/0500_OPERATIONS.sqlx";
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            let { compiledString, errors, possibleResolutions } = await compileDataform(workspacePath, false);
            if (compiledString) {
                const dataformCompiledJson: DataformCompiledJson = JSON.parse(compiledString);
                if (dataformCompiledJson) {
                    let sqlxBlockMetadata = await getQueryMetaForCurrentFile(relativeFilePath, dataformCompiledJson);
                    //console.log('[TEST] sqlxBlockMetadata:', sqlxBlockMetadata);
                    assert.strictEqual(sqlxBlockMetadata.tables.length, 1);
                    assert.strictEqual(sqlxBlockMetadata.tables[0].type, "operation");
                    assert.strictEqual(sqlxBlockMetadata.tables[0].fileName, relativeFilePath);

                    assert.strictEqual(sqlxBlockMetadata.queryMeta.type, "operation");
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




});
