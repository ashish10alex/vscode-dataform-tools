import * as vscode from 'vscode';

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

        const fileUris = await vscode.workspace.findFiles('definitions/**/*');

        let foundInDefinitionsDir = false;

        let definitionUri: vscode.Uri = document.uri;
        let sourcesJsUri: vscode.Uri = document.uri;

        for (let fileUri of fileUris) {

            let fileNameWtExtension = fileUri.path.split('/').pop();
            let fileName = fileNameWtExtension?.split('.')[0];

            if (fileName === word) {
                foundInDefinitionsDir = true;
                definitionUri = fileUri;
                break;
            }
            if (fileNameWtExtension === 'sources.js') {
                sourcesJsUri = fileUri;
            }
        }

        if (foundInDefinitionsDir) {
            const definitionPosition = new vscode.Position(0, 0);
            const location = new vscode.Location(definitionUri, definitionPosition);
            return location;
        }
        else {

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

