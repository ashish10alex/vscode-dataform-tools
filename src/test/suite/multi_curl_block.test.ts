import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { getMetadataForSqlxFileBlocks } from "../../sqlxFileParser";


suite('GetMetadataForSqlxFileBlocks', async () => {
    test('When multiple curley braces are in the same line in config/pre ops blocks', async () => {
        try {
            const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');

            const workspaceUri = vscode.Uri.file(workspacePath);
            vscode.workspace.updateWorkspaceFolders(0, null, { uri: workspaceUri });

            let uri = path.join(workspacePath, 'definitions/010_MULTI_CURL_BLOCK.sqlx');
            let doc = await vscode.workspace.openTextDocument(uri);
            assert.ok(doc);
            let sqlxBlockMetadata = getMetadataForSqlxFileBlocks(doc);

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


        } catch (error: any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
    });
});
