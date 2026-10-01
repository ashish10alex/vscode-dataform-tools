// Finds CTE definitions in SQLX text without a SQL parser.
// Comments, strings, backtick identifiers and `${...}` templates are skipped; SQL inside
// JS template literals within `${...}` (e.g. `${when(incremental(), `WITH ...`)}`) is scanned too.

export interface CteDefinition {
    name: string;
    /** Start of the name token (including a leading backtick if quoted). */
    start: number;
    /** End of the closing parenthesis of the CTE body. */
    end: number;
    /** Name without backticks. */
    nameStart: number;
    nameEnd: number;
    /** Start of the WITH keyword this CTE belongs to. */
    scopeStart: number;
    /** End of the query the WITH clause belongs to: the enclosing `)`, a `;`, or the end of the segment. */
    scopeEnd: number;
}

type TokenKind = 'word' | 'quoted' | 'open' | 'close' | 'comma' | 'other';

interface Token {
    kind: TokenKind;
    start: number;
    end: number;
    innerStart: number;
    innerEnd: number;
}

const WORD_CHAR = /[A-Za-z0-9_]/;
const WHITESPACE = /\s/;

export function findCtes(text: string): CteDefinition[] {
    const segments: Token[][] = [];
    scanSql(text, 0, false, segments);
    const ctes: CteDefinition[] = [];
    for (const tokens of segments) {
        ctes.push(...findCtesInTokens(text, tokens));
    }
    return ctes.sort((a, b) => a.start - b.start);
}

/**
 * Resolves the definition of `name` for a reference at `offset`.
 * Prefers the innermost WITH scope containing the offset, then the closest definition above it.
 */
export function findCteDefinition(text: string, name: string, offset: number): CteDefinition | undefined {
    const candidates = findCtes(text).filter(cte => cte.name.toLowerCase() === name.toLowerCase());
    if (candidates.length === 0) {
        return undefined;
    }

    const enclosing = candidates
        .filter(cte => offset >= cte.scopeStart && offset <= cte.scopeEnd)
        .sort((a, b) => b.scopeStart - a.scopeStart);
    if (enclosing.length > 0) {
        return enclosing[0];
    }

    const above = candidates.filter(cte => cte.nameStart <= offset);
    if (above.length > 0) {
        return above[above.length - 1];
    }
    return candidates[0];
}

/** Scans SQL starting at `pos`. When `embedded`, a bare backtick ends the segment. Returns the position after the segment. */
function scanSql(text: string, pos: number, embedded: boolean, segments: Token[][]): number {
    const tokens: Token[] = [];
    segments.push(tokens);
    const n = text.length;
    const push = (kind: TokenKind, start: number, end: number, innerStart = start, innerEnd = end) =>
        tokens.push({ kind, start, end, innerStart, innerEnd });

    while (pos < n) {
        const ch = text[pos];
        const next = text[pos + 1];

        if (embedded && ch === '`') {
            return pos + 1;
        }
        if (embedded && ch === '\\' && next === '`') {
            const close = text.indexOf('\\`', pos + 2);
            const innerEnd = close === -1 ? n : close;
            const end = close === -1 ? n : close + 2;
            push('quoted', pos, end, pos + 2, innerEnd);
            pos = end;
            continue;
        }
        if (WHITESPACE.test(ch)) {
            pos++;
            continue;
        }
        if ((ch === '-' && next === '-') || ch === '#' || (ch === '/' && next === '/')) {
            pos = skipUntil(text, pos, '\n', embedded, false);
            continue;
        }
        if (ch === '/' && next === '*') {
            pos = skipUntil(text, pos + 2, '*/', embedded, true);
            continue;
        }
        if (ch === '$' && next === '{') {
            const end = scanJs(text, pos + 2, segments);
            push('other', pos, end);
            pos = end;
            continue;
        }
        if (ch === "'" || ch === '"') {
            const end = skipSqlString(text, pos, embedded);
            push('other', pos, end);
            pos = end;
            continue;
        }
        if (ch === '`') {
            const close = text.indexOf('`', pos + 1);
            const innerEnd = close === -1 ? n : close;
            const end = close === -1 ? n : close + 1;
            push('quoted', pos, end, pos + 1, innerEnd);
            pos = end;
            continue;
        }
        if (WORD_CHAR.test(ch)) {
            let end = pos + 1;
            while (end < n && WORD_CHAR.test(text[end])) {
                end++;
            }
            push('word', pos, end);
            pos = end;
            continue;
        }
        push(ch === '(' ? 'open' : ch === ')' ? 'close' : ch === ',' ? 'comma' : 'other', pos, pos + 1);
        pos++;
    }
    return n;
}

/** Skips past `terminator` (consumed when `consume`). In embedded SQL, stops before a bare backtick. */
function skipUntil(text: string, pos: number, terminator: string, embedded: boolean, consume: boolean): number {
    const n = text.length;
    while (pos < n) {
        if (text.startsWith(terminator, pos)) {
            return consume ? pos + terminator.length : pos;
        }
        if (embedded) {
            if (text[pos] === '\\' && text[pos + 1] === '`') {
                pos += 2;
                continue;
            }
            if (text[pos] === '`') {
                return pos;
            }
        }
        pos++;
    }
    return n;
}

function skipSqlString(text: string, pos: number, embedded: boolean): number {
    const quote = text[pos];
    const triple = quote.repeat(3);
    const closing = text.startsWith(triple, pos) ? triple : quote;
    const n = text.length;
    pos += closing.length;
    while (pos < n) {
        if (text[pos] === '\\') {
            pos += 2;
            continue;
        }
        if (embedded && text[pos] === '`') {
            return pos;
        }
        if (text.startsWith(closing, pos)) {
            return pos + closing.length;
        }
        pos++;
    }
    return n;
}

/** Scans JavaScript inside `${...}` starting after `${`. Returns the position after the matching `}`. */
function scanJs(text: string, pos: number, segments: Token[][]): number {
    const n = text.length;
    let depth = 1;
    while (pos < n) {
        const ch = text[pos];
        const next = text[pos + 1];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return pos + 1;
            }
        } else if (ch === "'" || ch === '"') {
            pos++;
            while (pos < n && text[pos] !== ch && text[pos] !== '\n') {
                pos += text[pos] === '\\' ? 2 : 1;
            }
        } else if (ch === '`') {
            pos = scanSql(text, pos + 1, true, segments);
            continue;
        } else if (ch === '/' && next === '/') {
            pos = skipUntil(text, pos, '\n', false, false);
            continue;
        } else if (ch === '/' && next === '*') {
            pos = skipUntil(text, pos + 2, '*/', false, true);
            continue;
        }
        pos++;
    }
    return n;
}

function findCtesInTokens(text: string, tokens: Token[]): CteDefinition[] {
    const matching = new Map<number, number>();
    const stack: number[] = [];
    tokens.forEach((token, index) => {
        if (token.kind === 'open') {
            stack.push(index);
        } else if (token.kind === 'close' && stack.length > 0) {
            matching.set(stack.pop()!, index);
        }
    });

    const segmentEnd = tokens.length > 0 ? tokens[tokens.length - 1].end : 0;
    const isWord = (token: Token | undefined, word: string) =>
        token?.kind === 'word' && text.slice(token.start, token.end).toUpperCase() === word;

    const ctes: CteDefinition[] = [];
    for (let i = 0; i < tokens.length; i++) {
        if (!isWord(tokens[i], 'WITH')) {
            continue;
        }
        let j = isWord(tokens[i + 1], 'RECURSIVE') ? i + 2 : i + 1;
        const clause: CteDefinition[] = [];

        while (j < tokens.length) {
            const nameToken = tokens[j];
            const isIdentifier = nameToken.kind === 'quoted'
                || (nameToken.kind === 'word' && /^[A-Za-z_]/.test(text[nameToken.start]));
            if (!isIdentifier) {
                break;
            }

            let k = j + 1;
            if (tokens[k]?.kind === 'open') {
                // optional column list: name (col1, col2) AS (...)
                const columnsClose = matching.get(k);
                if (columnsClose === undefined) {
                    break;
                }
                k = columnsClose + 1;
            }
            if (!isWord(tokens[k], 'AS') || tokens[k + 1]?.kind !== 'open') {
                break;
            }

            const closeIndex = matching.get(k + 1);
            clause.push({
                name: text.slice(nameToken.innerStart, nameToken.innerEnd),
                start: nameToken.start,
                end: closeIndex === undefined ? segmentEnd : tokens[closeIndex].end,
                nameStart: nameToken.innerStart,
                nameEnd: nameToken.innerEnd,
                scopeStart: tokens[i].start,
                scopeEnd: 0,
            });

            if (closeIndex === undefined || tokens[closeIndex + 1]?.kind !== 'comma') {
                break;
            }
            j = closeIndex + 2;
        }

        const scopeEnd = findScopeEnd(text, tokens, i, segmentEnd);
        clause.forEach(cte => (cte.scopeEnd = scopeEnd));
        ctes.push(...clause);
    }
    return ctes;
}

function findScopeEnd(text: string, tokens: Token[], withIndex: number, segmentEnd: number): number {
    let depth = 0;
    for (let i = withIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === 'open') {
            depth++;
        } else if (token.kind === 'close') {
            if (depth === 0) {
                return token.start;
            }
            depth--;
        } else if (depth === 0 && text[token.start] === ';' && token.kind === 'other') {
            return token.start;
        }
    }
    return segmentEnd;
}
