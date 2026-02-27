import * as assert from 'assert';
globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.errorInPreOpsDenyList = false;
globalThis.compilerOptionsMap = {};
import path from 'path';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { findProjectRoot } from './helper';

const projectRoot = findProjectRoot(__dirname);
const workspaceFolder = path.join(projectRoot, 'src', 'test', 'test-workspace');

suite('Config Block Diagnostics', () => {

    test('Should catch multiple type and property errors in config block', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/100_CONFIG_BLOCK_ERRORS.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        // Wait a small amount of time for the language server / extension to process the onDidOpenTextDocument event
        await new Promise(resolve => setTimeout(resolve, 4500));
        
        const diagnostics = vscode.languages.getDiagnostics(uri);
        
        // Let's filter to make sure we're getting our config diagnostics (they are warnings)
        const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
        
        assert.ok(warnings.length > 5, 'Should have multiple config block warnings');

        // Check for specific error messages
        const diagnosticMessages = warnings.map(d => d.message);
        
        assert.ok(diagnosticMessages.some(m => m.includes('Invalid type value')), 'Missing warning for unknown_type');
        assert.ok(diagnosticMessages.some(m => m.includes('BigQuery table names can only contain') && m.includes('name')), 'Missing warning for name property');
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a number') && m.includes('database')), 'Missing warning for database property');
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a boolean') && m.includes('schema')), 'Missing warning for schema property');
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a string') && m.includes('columns')), 'Missing warning for columns property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('tags')), 'Missing warning for tags property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be a boolean') && m.includes('hasOutput')), 'Missing warning for hasOutput property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be a boolean') && m.includes('materialized')), 'Missing warning for materialized property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be one of: IGNORE, FAIL, EXTEND, SYNCHRONIZE') && m.includes('onSchemaChange')), 'Missing warning for onSchemaChange property');
        assert.ok(diagnosticMessages.some(m => m.includes('Invalid property "invalidProp"')), 'Missing warning for invalid property invalidProp');
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a string') && m.includes('assertions')), 'Missing warning for assertions property');

        // BigQuery block checks
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a number') && m.includes('partitionBy')), 'Missing warning for partitionBy property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('clusterBy')), 'Missing warning for clusterBy property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be a boolean') && m.includes('requirePartitionFilter')), 'Missing warning for requirePartitionFilter property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be a number without quotes') && m.includes('partitionExpirationDays')), 'Missing warning for partitionExpirationDays property');
        assert.ok(diagnosticMessages.some(m => m.includes('Cannot be a string') && m.includes('labels')), 'Missing warning for labels property');
        assert.ok(diagnosticMessages.some(m => m.includes('Invalid property "invalidBqProp"')), 'Missing warning for invalidBqProp property');
    }).timeout(10000);

    test('Should return no errors for a valid config block', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/101_CONFIG_BLOCK_VALID.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        // Wait a small amount of time for the language server / extension to process the onDidOpenTextDocument event
        await new Promise(resolve => setTimeout(resolve, 4500));
        
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
        
        if (warnings.length > 0) {
            console.error('Unexpected warnings:', warnings.map(w => w.message));
        }
        
        assert.strictEqual(warnings.length, 0, 'There should be no warnings dynamically added for a valid config block');
    }).timeout(10000);

    test('Should catch multiple errors in assertions block', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/103_CONFIG_ASSERTION_ERRORS.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        await new Promise(resolve => setTimeout(resolve, 4500));
        
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);

        assert.ok(warnings.length >= 5, 'Should have multiple assertion block warnings');

        const diagnosticMessages = warnings.map(d => d.message);
        
        assert.ok(diagnosticMessages.some(m => m.includes('Invalid property "uniqueKey" for config block')), 'Missing warning for uniqueKey in config block');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('uniqueKey')), 'Missing warning for uniqueKey in assertion block');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('nonNull')), 'Missing warning for nonNull property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('rowConditions')), 'Missing warning for rowConditions property');
        assert.ok(diagnosticMessages.some(m => m.includes('Must be an array') && m.includes('uniqueKeys')), 'Missing warning for uniqueKeys property');
        assert.ok(diagnosticMessages.some(m => m.includes('Invalid property "invalidProp"')), 'Missing warning for invalidProp in assertions block');
    }).timeout(10000);

    test('Should return no errors for a valid assertions config block', async () => {
        const uri = vscode.Uri.file(path.join(workspaceFolder, "invalid_configs/102_CONFIG_ASSERTION_VALID.sqlx"));
        await vscode.workspace.openTextDocument(uri);
        
        await new Promise(resolve => setTimeout(resolve, 4500));
        
        const diagnostics = vscode.languages.getDiagnostics(uri);
        const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);
        
        if (warnings.length > 0) {
            console.error('Unexpected warnings:', warnings.map(w => w.message));
        }
        
        assert.strictEqual(warnings.length, 0, 'There should be no warnings in a valid assertions config block');
    }).timeout(10000);

});
