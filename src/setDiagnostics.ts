
import * as vscode from 'vscode';
import {DryRunError, SqlxBlockMetadata} from './types';

export function setDiagnostics(document: vscode.TextDocument, dryRunError: DryRunError, preOpsError:DryRunError, postOpsError:DryRunError, diagnosticCollection: vscode.DiagnosticCollection, sqlxBlockMetadata: SqlxBlockMetadata, offSet:number){

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
            //TODO: This will not work if pre_operation block is placed after main sql query. unlikely that is coding pattern used ?
            let preOpsOffset = 0;
            if (sqlxBlockMetadata.preOpsBlock.preOpsList.length > 0){
                preOpsOffset = (sqlxBlockMetadata.preOpsBlock.preOpsList[0].endLine - sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine) + 1;
            }
            errLineNumber = (sqlQueryStartLineNumber + (errLineNumber - offSet)) - preOpsOffset;

            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            dryRunError.message = "(fullQuery): " + dryRunError.message;
            const regularBlockDiagnostic = new vscode.Diagnostic(range, dryRunError.message, severity);
            diagnostics.push(regularBlockDiagnostic);
        }

        if(preOpsError.hasError){
            errLineNumber = sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            preOpsError.message = "(preOps): " + preOpsError.message;
            const preOpsDiagnostic = new vscode.Diagnostic(range, preOpsError.message, severity);
            diagnostics.push(preOpsDiagnostic);
        }
        if(postOpsError.hasError){
            errLineNumber = sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            postOpsError.message = "(postOps): " + postOpsError.message;
            const postOpsDiagnostic = new vscode.Diagnostic(range, postOpsError.message, severity);
            diagnostics.push(postOpsDiagnostic);
        }

        if (document !== undefined) {
            diagnosticCollection.set(document.uri, diagnostics);
        }
}
