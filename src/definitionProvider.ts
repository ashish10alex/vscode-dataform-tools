import * as vscode from 'vscode';

export class SimpleDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ){
        const word = document.getText(document.getWordRangeAtPosition(position));
        const files = await vscode.workspace.findFiles('definitions/**/*');
        let found = false;
        let sourcesJsUri: vscode.Uri = document.uri;

        for (let fileUri of files){
            let fileName = fileUri.path.split('/').pop()?.split('.')[0];
            if (fileName === word){
                found = true;
                sourcesJsUri = fileUri;
                break;
            }
            if (fileName === 'sources'){
                sourcesJsUri = fileUri;
            }
        }

        if (found){
            const definitionPosition = new vscode.Position(0, 0);
            const location = new vscode.Location(sourcesJsUri, definitionPosition);
            return location;
        }
        else{
            const definitionPosition = new vscode.Position(0, 0);
            const location = new vscode.Location(sourcesJsUri, definitionPosition);
            return location;
        }
        /*
        const firstLine = document.lineAt(0);
        const definitionPosition = new vscode.Position(0, firstLine.text.indexOf(word));
        const location = new vscode.Location(document.uri, definitionPosition);
        return location;
        */
    }
}

