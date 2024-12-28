
import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { getMetadataForSqlxFileBlocks } from "../../sqlxFileParser";
import { tableQueryOffset } from '../../constants';
import { setDiagnostics } from '../../setDiagnostics';


suite('GetMetadataForSqlxFileBlocks', () => {
    test('When multiple curley braces are in the same line in config/pre ops blocks', async function() {
        this.timeout(9000);

        const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
        const uri = vscode.Uri.file(path.join(workspacePath, 'definitions/010_MULTI_CURL_BLOCK.sqlx'));
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
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 9);
        assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 12);

        /** sql block */
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 15);
        assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 19);
    });


    test('Unnested config block and sql block', async function() {
        this.timeout(9000);
        try {
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            const uri = vscode.Uri.file(path.join(workspacePath, 'definitions/0100_TEST.sqlx'));
            console.log('[TEST] URI:', uri.toString());
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 6);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 9);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 45);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 0);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 0);

        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

     test('Single line config / pre / post operation blocks', async () => {
        try {

            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
            const uri = vscode.Uri.file(path.join(workspacePath, 'definitions/010_SINGLE_LINE.sqlx'));
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

            /**config block */
            assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
            assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 1);

            /** Pre ops block */
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 1);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine, 3);
            assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine, 3);

            /** Post ops block */
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 1);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine, 5);
            assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList[0].endLine, 5);

            /** sql block */
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 7);
            assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 7);
        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });

});

suite('setDiagnostics', () => {
    test('Table: error set on the correct line when pre/post operations are present', function(done) {
        this.timeout(9000);

        const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
        const uri = vscode.Uri.file(path.join(workspacePath, 'definitions/0100_TEST.sqlx'));

        (async () => {
            try {
                const document = await vscode.workspace.openTextDocument(uri);
                assert.ok(document, 'Document should be opened');

                let offSet = tableQueryOffset;

                /**Error line number is the line number where the error is in the sql block.
                 * The spaces in front of the sql block are trimmed out before sending it to BigQuery Api
                 */
                let mockDryRunError =   {
                    hasError: true,
                    message: "Unfortunate error",
                    location: {
                        line: 2,
                        column: 1
                    }
                };

                let mockPreOpsDryRunError =   {
                    hasError: false,
                    message: "",
                    location: {
                        line: 0,
                        column: 0
                    }
                };

                let mockPostOpsDryRunError =   {
                    hasError: false,
                    message: "",
                    location: {
                        line: 0,
                        column: 0
                    }
                };

                let configBlockMeta = {
                    startLine: 1,
                    endLine: 5,
                    exists: true,
                };

                let sqlBlockMeta = {
                    startLine: 20,
                    endLine: 22,
                    exists: true,
                };

                let jsBlockMeta = {
                    startLine: 0,
                    endLine: 0,
                    exists: false,
                };

                let mockSqlxBlockMetadata =  {
                    configBlock: configBlockMeta,
                    preOpsBlock: {preOpsList: []},
                    postOpsBlock: {postOpsList: []},
                    sqlBlock: sqlBlockMeta,
                    jsBlock: jsBlockMeta,
                };

                let diagnosticCollection = vscode.languages.createDiagnosticCollection('myDiagnostics');
                setDiagnostics(document, mockDryRunError, mockPreOpsDryRunError, mockPostOpsDryRunError, diagnosticCollection, mockSqlxBlockMetadata, offSet);
                let allDiagnostics = vscode.languages.getDiagnostics(document.uri);
                assert.deepEqual(allDiagnostics.length, 1);
                let diagnosticRange = allDiagnostics[0].range;
                assert.deepEqual(diagnosticRange.start.line, 20);


                done();
            } catch (error) {
                console.error('Test failed:', error);
                done(error);
            }
        })();
    });
});
