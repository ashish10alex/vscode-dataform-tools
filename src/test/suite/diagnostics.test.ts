import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { tableQueryOffset } from "../../constants";
import { setDiagnostics } from '../../setDiagnostics';

suite('setDiagnostics', () => {
    test('Table: error set on the correct line when pre/post operations are present', function(done) {
        this.timeout(10000);

        const workspacePath = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'test-workspace');
        const uri = path.join(workspacePath, 'definitions/0100_TEST.sqlx');

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