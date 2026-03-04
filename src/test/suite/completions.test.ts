import * as assert from 'assert';
globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.errorInPreOpsDenyList = false;
globalThis.compilerOptionsMap = {};

// Mock schemaAutoCompletions inside the tests since extension.ts overwrites it
const mockSchemaAutoCompletions = [
    { name: "test_column_1", metadata: { type: "STRING", description: "Test description 1", fullTableId: "project.dataset.table" } },
    { name: "test_column_2", metadata: { type: "INT64", description: "Test description 2", fullTableId: "project.dataset.table" } }
];

import path from 'path';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { findProjectRoot } from './helper';

const projectRoot = findProjectRoot(__dirname);
const workspaceFolder = path.join(projectRoot, 'src', 'test', 'test-workspace');

suite('Config Block Auto Completions', () => {

    test('Should provide column name completions inside assertion arrays', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/104_COMPLETIONS.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        // Wait for doc to open
        await new Promise(resolve => setTimeout(resolve, 500));
        globalThis.schemaAutoCompletions = mockSchemaAutoCompletions;

        // Let's test completion inside nonNull array -> nonNull: ["|"]
        // Line 10 (0-indexed 9), character 19 is between quotes
        const position = new vscode.Position(9, 19);

        
        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            uri,
            position
        );

        assert.ok(completions, 'Completions should be returned');
        assert.ok(completions.items.length > 0, 'Should have completion items');
        
        const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
        
        assert.ok(labels.includes('test_column_1'), 'Should suggest test_column_1');
        assert.ok(labels.includes('test_column_2'), 'Should suggest test_column_2');
        assert.ok(!labels.includes('nonNull'), 'Should NOT suggest config properties like nonNull');
    }).timeout(10000);

    test('Should provide column name completions inside bigquery arrays', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/104_COMPLETIONS.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        globalThis.schemaAutoCompletions = mockSchemaAutoCompletions;

        // clusterBy array -> clusterBy: [\n "|" \n]
        // Line 6 (0-indexed 5), character 13
        const position = new vscode.Position(5, 13);

        
        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            uri,
            position
        );

        assert.ok(completions, 'Completions should be returned');
        assert.ok(completions.items.length > 0, 'Should have completion items');
        
        const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
        
        if (!labels.includes('test_column_1')) {
            console.error('Labels returned in test 2:', labels);
        }

        assert.ok(labels.includes('test_column_1'), 'Should suggest test_column_1');
        assert.ok(labels.includes('test_column_2'), 'Should suggest test_column_2');
        assert.ok(!labels.includes('partitionBy'), 'Should NOT suggest config properties like partitionBy');
    }).timeout(10000);

    test('Should provide config properties when outside arrays in bigQuery block', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/104_COMPLETIONS.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        await new Promise(resolve => setTimeout(resolve, 500));
        globalThis.schemaAutoCompletions = mockSchemaAutoCompletions;

        // new line inside bigquery block
        // Line 7 (0-indexed 6) is inside clusterBy array. Line 8 is },
        // Let's try Line 4 (0-indexed 3) where partitionBy is.
        // Or Line 8 (0-indexed 7) at the end of },
        const position = new vscode.Position(7, 4);

        
        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            uri,
            position
        );

        assert.ok(completions, 'Completions should be returned');
        const labels = completions.items.map(item => typeof item.label === 'string' ? item.label : item.label.label);
        
        assert.ok(labels.includes('partitionBy'), 'Should suggest partitionBy');
        assert.ok(labels.includes('clusterBy'), 'Should suggest clusterBy');
        assert.ok(!labels.includes('test_column_1'), 'Should NOT suggest column names');
    }).timeout(10000);

});
