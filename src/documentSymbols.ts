import * as vscode from 'vscode';
import { findCtes } from './cteScanner';

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

// Dataform ref() patterns: ${ref("name")}, ${ref("schema", "name")} and ${ref("database", "schema", "name")}
const regexToIdentifyRefsInSqlxFile = /\${ref\(\s*(['"])([^'"]+)\1\s*(?:,\s*\1([^'"]+)\1\s*)?(?:,\s*\1([^'"]+)\1\s*)?\)}/gs;

/** `${ref(...)}` expressions outside comments, with their offset, length and quoted arguments */
export function findRefs(text: string): { index: number; length: number; args: string[] }[] {
    const blockComments = getAllBlockComments(text);
    const refs: { index: number; length: number; args: string[] }[] = [];
    for (const match of text.matchAll(regexToIdentifyRefsInSqlxFile)) {
        const index = match.index || 0;
        if (!isMatchInComment(text, index, blockComments)) {
            refs.push({ index, length: match[0].length, args: [match[2], match[3], match[4]].filter((arg): arg is string => !!arg) });
        }
    }
    return refs;
}

export function getDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const symbols: { symbol: vscode.DocumentSymbol; offset: number }[] = [];
    const text = document.getText();

    const blockComments = getAllBlockComments(text);
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
        symbols.push({ symbol, offset: item.index });
    }

    return nestSymbolsUnderCtes(document, text, symbols);
}

function nestSymbolsUnderCtes(
    document: vscode.TextDocument,
    text: string,
    referenceSymbols: { symbol: vscode.DocumentSymbol; offset: number }[]
): vscode.DocumentSymbol[] {
    const ctes = findCtes(text).map(cte => ({
        cte,
        symbol: new vscode.DocumentSymbol(
            cte.name,
            "cte",
            vscode.SymbolKind.Struct,
            new vscode.Range(document.positionAt(cte.start), document.positionAt(cte.end)),
            new vscode.Range(document.positionAt(cte.nameStart), document.positionAt(cte.nameEnd))
        ),
    }));

    const topLevel: { symbol: vscode.DocumentSymbol; offset: number }[] =
        ctes.map(({ cte, symbol }) => ({ symbol, offset: cte.start }));

    for (const reference of [...referenceSymbols].sort((a, b) => a.offset - b.offset)) {
        const container = ctes
            .filter(({ cte }) => reference.offset >= cte.start && reference.offset < cte.end)
            .sort((a, b) => (a.cte.end - a.cte.start) - (b.cte.end - b.cte.start))[0];
        if (container) {
            container.symbol.children.push(reference.symbol);
        } else {
            topLevel.push(reference);
        }
    }

    return topLevel.sort((a, b) => a.offset - b.offset).map(({ symbol }) => symbol);
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