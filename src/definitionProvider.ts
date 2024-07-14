import * as vscode from 'vscode';
import { CACHED_COMPILED_DATAFORM_JSON, getWorkspaceFolder, runCompilation } from './utils';
import { Assertion, DataformCompiledJson, Operation, Table } from './types';
import path from 'path';

function getSearchTermLocationFromStruct(searchTerm: string, struct: Operation[] | Assertion[] | Table[], workspaceFolder: string): vscode.Location | undefined {
    let location: vscode.Location | undefined;
    for (let i = 0; i < struct.length; i++) {
        let tableName = struct[i].target.name;
        if (searchTerm === tableName) {
            let fullSourcePath = path.join(workspaceFolder, struct[i].fileName);
            let sourcesJsUri = vscode.Uri.file(fullSourcePath);
            const definitionPosition = new vscode.Position(0, 0);
            location = new vscode.Location(sourcesJsUri, definitionPosition);
            return location;
        }
    }
    return location;
}

export class DataformRefDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ) {
        let searchTerm = document.getText(document.getWordRangeAtPosition(position));
        const line = document.lineAt(position.line).text;

        // early return
        if (line.indexOf("${ref(") === -1) {
            return undefined;
        }

        let sourcesJsUri: vscode.Uri = document.uri;

        let workspaceFolder = getWorkspaceFolder();
        let dataformCompiledJson: DataformCompiledJson | undefined;
        if (!CACHED_COMPILED_DATAFORM_JSON) {
            vscode.window.showWarningMessage('Compile the Dataform project once for faster go to definition');
            dataformCompiledJson = await runCompilation(workspaceFolder);
        } else {
            dataformCompiledJson = CACHED_COMPILED_DATAFORM_JSON;
        }

        let declarations = dataformCompiledJson?.declarations;
        let tables = dataformCompiledJson?.tables;
        let operations = dataformCompiledJson?.operations;
        let assertions = dataformCompiledJson?.assertions;
        let tablePrefix = dataformCompiledJson?.projectConfig?.tablePrefix;

        if (declarations) {
            for (let i = 0; i < declarations.length; i++) {
                let declarationName = declarations[i].target.name;
                if (searchTerm === declarationName) {
                    let fullSourcePath = path.join(workspaceFolder, declarations[i].fileName);
                    sourcesJsUri = vscode.Uri.file(fullSourcePath);

                    let sourcesDocument = await vscode.workspace.openTextDocument(sourcesJsUri);

                    let line = null;
                    let character = null;

                    for (let lineNum = 0; lineNum < sourcesDocument.lineCount; lineNum++) {
                        const lineText = sourcesDocument.lineAt(lineNum).text;
                        const wordIndex = lineText.indexOf(searchTerm);

                        if (wordIndex !== -1) {
                            line = lineNum;
                            character = wordIndex;
                        }
                    }
                    if (line === null || character === null) {
                        return undefined;
                    }
                    const definitionPosition = new vscode.Position(line, character);
                    const location = new vscode.Location(sourcesJsUri, definitionPosition);
                    return location;

                }

            }
        }
        if (tablePrefix) {
            searchTerm = tablePrefix + "_" + searchTerm;
        }

        if (tables) {
            return getSearchTermLocationFromStruct(searchTerm, tables, workspaceFolder);
        }

        if (operations) {
            return getSearchTermLocationFromStruct(searchTerm, operations, workspaceFolder);
        }

        if (assertions) {
            return getSearchTermLocationFromStruct(searchTerm, assertions, workspaceFolder);
        }
    }
}

