
import * as vscode from 'vscode';
import {ErrorMeta, SqlxBlockMetadata} from './types';
import {errorDenylist} from './constants';
import { logger } from './logger';

export function setDiagnostics(document: vscode.TextDocument, errorMeta: ErrorMeta, diagnosticCollection: vscode.DiagnosticCollection, sqlxBlockMetadata: SqlxBlockMetadata, offSet:number){

        const diagnostics: vscode.Diagnostic[] = [];
        const severity = vscode.DiagnosticSeverity.Error;
        errorInPreOpsDenyList = false;

        let errLineNumber;
        let errColumnNumber = 0;

        const mainQueryHasError = errorMeta.mainQueryError.hasError;
        if (mainQueryHasError){
            let errLineNumber = errorMeta.mainQueryError.location?.line;
            let errColumnNumber = errorMeta.mainQueryError.location?.column;
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
            if(errLineNumber === 0 && sqlQueryStartLineNumber === 0){
                errLineNumber = 0;
            } else {
                errLineNumber = (sqlQueryStartLineNumber + (errLineNumber - offSet)) - preOpsOffset;
            }

            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            const regularBlockDiagnostic = new vscode.Diagnostic(range, `(Main Query): ${errorMeta.mainQueryError.message}`, severity);
            diagnostics.push(regularBlockDiagnostic);
        }

        if(errorMeta?.preOpsError?.hasError){
            errLineNumber = sqlxBlockMetadata.preOpsBlock.preOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));

            errorDenylist.some((errorMessage: string) => {
                errorInPreOpsDenyList = (errorMeta?.preOpsError?.message.includes(errorMessage) || false); 
            });
            logger.debug(`errorInPreOpsDenyList: ${errorInPreOpsDenyList}`);

            if(!errorInPreOpsDenyList){
                const preOpsDiagnostic = new vscode.Diagnostic(range, `(Pre-Ops): ${errorMeta.preOpsError.message}`, severity);
                diagnostics.push(preOpsDiagnostic);
            }
        }
        if(errorMeta?.postOpsError?.hasError){
            errLineNumber = sqlxBlockMetadata.postOpsBlock.postOpsList[0].startLine - 1;
            const range = new vscode.Range(new vscode.Position(errLineNumber, errColumnNumber), new vscode.Position(errLineNumber, errColumnNumber + 5));
            const postOpsDiagnostic = new vscode.Diagnostic(range, `(Post-Ops): ${errorMeta.postOpsError.message}`, severity);
            diagnostics.push(postOpsDiagnostic);
        }

        if (errorMeta?.assertionError?.hasError){
            const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
            const assertionDiagnostic = new vscode.Diagnostic(range, `(Assertion): ${errorMeta.assertionError.message}`, severity);
            diagnostics.push(assertionDiagnostic);
        }

        if (document !== undefined) {
            diagnosticCollection.set(document.uri, diagnostics);
        }
}
