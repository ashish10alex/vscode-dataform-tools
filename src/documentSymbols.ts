import * as vscode from 'vscode';

export class SqlxDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {

        const symbols: vscode.DocumentSymbol[] = [];

        const text = document.getText();

        const regex = /\${ref\(\s*(['"])([^'"]+)\1\s*(?:,\s*\1([^'"]+)\1\s*)?(?:,\s*\1([^'"]+)\1\s*)?\)}/gs;
        const matches = text.matchAll(regex);
        const myFoundSymbols = [];
        for (const match of matches) {
            const line = document.positionAt(match.index || 0).line;
            myFoundSymbols.push({ name: match[0], line: line, type: "ref" });
        }

        for (const item of myFoundSymbols) {

            const range = new vscode.Range(
                new vscode.Position(item.line, 0),
                new vscode.Position(item.line, 100)
            );

            const selectionRange = range;

            let kind = vscode.SymbolKind.Variable;
            const symbol = new vscode.DocumentSymbol(
                item.name,
                item.type,
                kind,
                range,
                selectionRange
            );

            symbols.push(symbol);
        }

        return symbols;
    }
}