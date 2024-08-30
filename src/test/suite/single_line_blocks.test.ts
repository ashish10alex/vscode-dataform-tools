import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { getMetadataForSqlxFileBlocks } from "../../sqlxFileParser";


suite('GetMetadataForSqlxFileBlocks', async () => {
    test('Single line config / pre / post operation blocks', async () => {
        try {
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');

            const workspaceUri = vscode.Uri.file(workspacePath);
            vscode.workspace.updateWorkspaceFolders(0, null, { uri: workspaceUri });

            let uri = path.join(workspacePath, 'definitions/010_SINGLE_LINE.sqlx');
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
