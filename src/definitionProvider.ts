import * as vscode from 'vscode';
import { getPostionOfSourceDeclaration, getWorkspaceFolder, runCompilation } from './utils';
import { Assertion, DataformCompiledJson, Operation, Table } from './types';
import path from 'path';

function getSearchTermLocationFromStruct(searchTerm: string, struct: Operation[] | Assertion[] | Table[], workspaceFolder: string): vscode.Location | undefined {
    let location: vscode.Location | undefined;
    for (let i = 0; i < struct.length; i++) {
        let targetName = struct[i].target.name;
        if (searchTerm === targetName) {
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
        if (!workspaceFolder){return;}
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

        let location: vscode.Location | undefined;

        if (declarations) {
            for (let i = 0; i < declarations.length; i++) {
                let declarationName = declarations[i].target.name;
                if (searchTerm === declarationName) {
                    let fullSourcePath = path.join(workspaceFolder, declarations[i].fileName);
                    sourcesJsUri = vscode.Uri.file(fullSourcePath);

                    const definitionPosition = await getPostionOfSourceDeclaration(sourcesJsUri, searchTerm);
                    if(!definitionPosition){
                        return;
                    }
                    return new vscode.Location(sourcesJsUri, definitionPosition);
                }

            }
        }
        if (tablePrefix) {
            searchTerm = tablePrefix + "_" + searchTerm;
        }

        if (tables) {
            location = getSearchTermLocationFromStruct(searchTerm, tables, workspaceFolder);
        }
        if (location){return location;}

        if (operations) {
            location =  getSearchTermLocationFromStruct(searchTerm, operations, workspaceFolder);
        }
        if (location){return location;}

        if (assertions) {
            return getSearchTermLocationFromStruct(searchTerm, assertions, workspaceFolder);
        }
    }
}

