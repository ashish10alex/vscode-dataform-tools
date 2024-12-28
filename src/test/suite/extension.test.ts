
import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { getMetadataForSqlxFileBlocks } from "../../sqlxFileParser";


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
});
