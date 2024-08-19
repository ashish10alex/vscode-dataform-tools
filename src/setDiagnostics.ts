
import * as vscode from 'vscode';
import {DryRunError, SqlxBlockMetadata} from './types';

export function setDiagnostics(document: vscode.TextDocument, dryRunError: DryRunError, preOpsError:DryRunError, postOpsError:DryRunError, compiledSqlFilePath: string, diagnosticCollection: vscode.DiagnosticCollection, sqlxBlockMetadata: SqlxBlockMetadata, offSet:number){

        const diagnostics: vscode.Diagnostic[] = [];
        const severity = vscode.DiagnosticSeverity.Error;

        let errLineNumber;
        let errColumnNumber = 0;

        if (dryRunError.hasError){
            let errLineNumber = dryRunError.location?.line;
            let errColumnNumber = dryRunError.location?.column;
            if (errLineNumber === undefined || errColumnNumber === undefined) {
                vscode.window.showErrorMessage(`Error in setting diagnostics. Error location is undefined.`);
                return;
            }
            let sqlQueryStartLineNumber = sqlxBlockMetadata.sqlBlock.startLine;
            errLineNumber = (sqlQueryStartLineNumber + (errLineNumber - offSet));

            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            const regularBlockDiagnostic = new vscode.Diagnostic(range, dryRunError.message, severity);
            diagnostics.push(regularBlockDiagnostic);
        }

        if(preOpsError.hasError){
            errLineNumber = sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            const preOpsDiagnostic = new vscode.Diagnostic(range, preOpsError.message, severity);
            diagnostics.push(preOpsDiagnostic);
        }
        if(postOpsError.hasError){
            errLineNumber = sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            const postOpsDiagnostic = new vscode.Diagnostic(range, postOpsError.message, severity);
            diagnostics.push(postOpsDiagnostic);
        }

        if (document !== undefined) {
            diagnosticCollection.set(document.uri, diagnostics);
        }
}
