import * as vscode from 'vscode';

export class SqlxDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        return getDocumentSymbols(document);
    }
}

function getAllBlockComments(text: string): { start: number; end: number }[] {
    // block comments start with /* and end with */
    const blockComments = [];
    const blockCommentRegex = /\/\*[\s\S]*?\*\//g;
    let blockMatch;
    while ((blockMatch = blockCommentRegex.exec(text)) !== null) {
        blockComments.push({
            start: blockMatch.index,
            end: blockMatch.index + blockMatch[0].length
        });
    }
    return blockComments;
}

export function getDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const symbols: vscode.DocumentSymbol[] = [];
    const text = document.getText();

    const blockComments = getAllBlockComments(text);

    const regex = /\${ref\(\s*(['"])([^'"]+)\1\s*(?:,\s*\1([^'"]+)\1\s*)?(?:,\s*\1([^'"]+)\1\s*)?\)}/gs;
    const matches = text.matchAll(regex);
    const myFoundSymbols = [];
    for (const match of matches) {
        const line = document.positionAt(match.index || 0).line;
        const matchIndex = match.index || 0;


        // Check if match is inside a block comment
        const inBlockComment = blockComments.some(
            comment => matchIndex >= comment.start && matchIndex < comment.end
        );
        if (inBlockComment) {
            continue;
        }

        const lineStart = text.lastIndexOf('\n', matchIndex - 1) + 1;
        const textBeforeMatch = text.substring(lineStart, matchIndex);
        if (textBeforeMatch.includes('--')) {
            continue;
        }
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