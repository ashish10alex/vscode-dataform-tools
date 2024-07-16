
import * as vscode from 'vscode';
import {DryRunError} from './types';

export function setDiagnostics(document: vscode.TextDocument, dryRunError: DryRunError, compiledSqlFilePath: string, diagnosticCollection: vscode.DiagnosticCollection, configLineOffset: number){

        let errLineNumber = dryRunError.location?.line;
        let errColumnNumber = dryRunError.location?.column;
        if (errLineNumber === undefined || errColumnNumber === undefined) {
            vscode.window.showErrorMessage(`Error in setting diagnostics. Error location is undefined.`);
            return;
        }
        errLineNumber = errLineNumber + (configLineOffset + 1);

        const diagnostics: vscode.Diagnostic[] = [];
        const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
        const severity = vscode.DiagnosticSeverity.Error;
        const diagnostic = new vscode.Diagnostic(range, dryRunError.message, severity);

        if (diagnostics.length === 0) { //NOTE: Did this because we are only showing first error ?
            diagnostics.push(diagnostic);
            if (document !== undefined) {
                diagnosticCollection.set(document.uri, diagnostics);
            }
        }

        let showCompiledQueryInVerticalSplitOnSave = vscode.workspace.getConfiguration('vscode-dataform-tools').get('showCompiledQueryInVerticalSplitOnSave');
        if (showCompiledQueryInVerticalSplitOnSave && dryRunError.hasError === true) {
            let compiledQueryDiagnostics: vscode.Diagnostic[] = [];
            let errLineNumberForCompiledQuery = errLineNumber - (configLineOffset + 1);
            let range = new vscode.Range(new vscode.Position(errLineNumberForCompiledQuery, errColumnNumber), new vscode.Position(errLineNumberForCompiledQuery, errColumnNumber + 5));
            const testDiagnostic = new vscode.Diagnostic(range, dryRunError.message, severity);
            compiledQueryDiagnostics.push(testDiagnostic);
            let visibleEditors = vscode.window.visibleTextEditors;
            visibleEditors.forEach((editor) => {
                let documentUri = editor.document.uri;
                if (documentUri.toString() === "file://" + compiledSqlFilePath) {
                    diagnosticCollection.set(documentUri, compiledQueryDiagnostics);
                }
            });
        }
}
