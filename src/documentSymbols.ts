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

    // Dataform ref() patterns
    const regexToIdentifyRefsInSqlxFile = /\${ref\(\s*(['"])([^'"]+)\1\s*(?:,\s*\1([^'"]+)\1\s*)?(?:,\s*\1([^'"]+)\1\s*)?\)}/gs;
    const refMatches = text.matchAll(regexToIdentifyRefsInSqlxFile);
    const myFoundSymbols = [];

    for (const match of refMatches) {
        const line = document.positionAt(match.index || 0).line;
        const matchIndex = match.index || 0;

        if (isMatchInComment(text, matchIndex, blockComments)) {
            continue;
        }

        myFoundSymbols.push({ name: match[0], line: line, type: "ref", index: matchIndex });
    }

    // BigQuery table reference pattern (project.dataset.table)
    const bqTableRegex = /[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
    const bqMatches = text.matchAll(bqTableRegex);

    for (const match of bqMatches) {
        const matchIndex = match.index || 0;
        const line = document.positionAt(matchIndex).line;

        // Skip if inside a block comment or line comment
        if (isMatchInComment(text, matchIndex, blockComments)) {
            continue;
        }

        // Skip if inside a Dataform template expression ${...}
        if (isInsideTemplate(text, matchIndex)) {
            continue;
        }

        myFoundSymbols.push({ name: match[0], line: line, type: "bq_table", index: matchIndex });
    }

    for (const item of myFoundSymbols) {
        let matchEnd;
        let matchStart;

        if (item.type === "ref") {
            const REF_OFFSET = 7; // num character to reach to reference after ${ref("
            matchStart = document.positionAt(item.index + REF_OFFSET);
            matchEnd = document.positionAt(item.index + item.name.length);
        } else {
            matchStart = document.positionAt(item.index);
            matchEnd = document.positionAt(item.index + item.name.length);
        }

        const range = new vscode.Range(matchStart, matchEnd);
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

function isMatchInComment(text: string, matchIndex: number, blockComments: { start: number; end: number }[]): boolean {
    // Check if match is inside a block comment
    const inBlockComment = blockComments.some(
        comment => matchIndex >= comment.start && matchIndex < comment.end
    );
    if (inBlockComment) {
        return true;
    }

    // Check if match is inside a line comment
    const lineStart = text.lastIndexOf('\n', matchIndex - 1) + 1;
    const textBeforeMatch = text.substring(lineStart, matchIndex);
    if (textBeforeMatch.includes('--') || textBeforeMatch.includes('//')) {
        return true;
    }

    return false;
}

function isInsideTemplate(text: string, matchIndex: number): boolean {
    const textBeforeMatch = text.substring(0, matchIndex);
    const lastOpen = textBeforeMatch.lastIndexOf('${');
    const lastClose = textBeforeMatch.lastIndexOf('}');
    
    // If there's an open ${ after the last closing }, we're inside a template
    return lastOpen > lastClose;
}