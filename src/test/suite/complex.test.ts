import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import {getMetadataForSqlxFileBlocks} from "../../sqlxFileParser";


suite('SqlxFileBlockMetaParsing', async() => {
	test('MultiplePrePostOpsBlocks', async () => {
		try{
		const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');

		const workspaceUri = vscode.Uri.file(workspacePath);
		vscode.workspace.updateWorkspaceFolders(0, null, { uri: workspaceUri });

		let uri = path.join(workspacePath, 'definitions/010_INCREMENTAL.sqlx');
		let doc = await vscode.workspace.openTextDocument(uri);
		assert.ok(doc);
		let sqlxBlockMetadata = getMetadataForSqlxFileBlocks("format", doc);

		assert.strictEqual(sqlxBlockMetadata.configBlock.startLine, 1);
		assert.strictEqual(sqlxBlockMetadata.configBlock.endLine, 10);

		assert.strictEqual(sqlxBlockMetadata.sqlBlock.startLine, 49);
		assert.strictEqual(sqlxBlockMetadata.sqlBlock.endLine, 64);

		assert.strictEqual(sqlxBlockMetadata.postOpsBlock.postOpsList.length, 2);
		assert.strictEqual(sqlxBlockMetadata.preOpsBlock.preOpsList.length, 2);

		} catch (error:any) {
            console.error('Test failed:', error);
            vscode.window.showErrorMessage(`Test failed: ${error.message}`);
            throw error;
        }
	});
});

