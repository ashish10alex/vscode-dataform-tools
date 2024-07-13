import * as vscode from 'vscode';
import { CACHED_COMPILED_DATAFORM_JSON, getWorkspaceFolder, runCompilation } from './utils';
import { DataformCompiledJson } from './types';
import path from 'path';

export class DataformRefDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ) {
        const word = document.getText(document.getWordRangeAtPosition(position));
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

        if (declarations) {
            for (let i = 0; i < declarations.length; i++) {
                let declarationName = declarations[i].target.name;
                if (word === declarationName) {
                    let fullSourcePath = path.join(workspaceFolder, declarations[i].fileName);
                    sourcesJsUri = vscode.Uri.file(fullSourcePath);

                    let sourcesDocument = await vscode.workspace.openTextDocument(sourcesJsUri);

                    let line = null;
                    let character = null;

                    for (let lineNum = 0; lineNum < sourcesDocument.lineCount; lineNum++) {
                        const lineText = sourcesDocument.lineAt(lineNum).text;
                        const wordIndex = lineText.indexOf(word);

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

        const fileUris = await vscode.workspace.findFiles('definitions/**/*');
        for (let fileUri of fileUris) {

            let fileNameWtExtension = fileUri.path.split('/').pop();
            let fileName = fileNameWtExtension?.split('.')[0];

            if (fileName === word) {
                const definitionPosition = new vscode.Position(0, 0);
                const location = new vscode.Location(fileUri, definitionPosition);
                return location;
            }
        }
    }
}

