import { Token, tokenizeSql } from '../cteScanner';
import { ColumnChange, ColumnLink } from '../shared/columnLineage/types';

// Pure rules for the column impact warning: which columns changed against prod, where to anchor each warning
// in the SQLX file, and what it says.

export interface SchemaField {
    name: string;
    type: string;
}

export interface ColumnImpact {
    /** Column name as prod spells it */
    column: string;
    change: ColumnChange;
}

/** Legacy and standard SQL names for the same type */
const TYPE_ALIASES: Record<string, string> = {
    INTEGER: 'INT64',
    FLOAT: 'FLOAT64',
    BOOLEAN: 'BOOL',
    RECORD: 'STRUCT',
};

function normaliseType(type: string): string {
    const upper = (type ?? '').toUpperCase();
    return TYPE_ALIASES[upper] ?? upper;
}

/**
 * Top-level columns that prod has but the dry run no longer produces, and those whose type changed. Names
 * compare case-insensitively, as in BigQuery. Nested fields and mode changes are left out.
 */
export function diffSchemas(devFields: SchemaField[], prodFields: SchemaField[]): ColumnImpact[] {
    const dev = new Map(devFields.map((field) => [field.name.toLowerCase(), field]));
    const impacts: ColumnImpact[] = [];
    for (const prod of prodFields) {
        const match = dev.get(prod.name.toLowerCase());
        if (!match) {
            impacts.push({ column: prod.name, change: { kind: 'dropped' } });
        } else if (normaliseType(match.type) !== normaliseType(prod.type)) {
            impacts.push({ column: prod.name, change: { kind: 'typeChanged', from: normaliseType(prod.type), to: normaliseType(match.type) } });
        }
    }
    return impacts;
}

export interface TextRange {
    start: number;
    end: number;
}

function wordIs(text: string, token: Token, word: string): boolean {
    return token.kind === 'word' && token.end - token.start === word.length && text.slice(token.start, token.end).toUpperCase() === word;
}

/** The SELECT keyword of the query's final, top-level SELECT: the first one outside parentheses (CTE bodies are inside them) */
function topLevelSelectIndex(text: string, tokens: Token[]): number {
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === 'open') {
            depth++;
        } else if (token.kind === 'close') {
            depth = Math.max(0, depth - 1);
        } else if (depth === 0 && wordIs(text, token, 'SELECT')) {
            return i;
        }
    }
    return -1;
}

export function findTopLevelSelect(text: string): TextRange | undefined {
    const tokens = tokenizeSql(text);
    const index = topLevelSelectIndex(text, tokens);
    return index === -1 ? undefined : { start: tokens[index].start, end: tokens[index].end };
}

/**
 * The output name of each item in the top-level SELECT list: the identifier after its last AS, or else its last
 * identifier (so `t.col` gives `col`). `*` items have no name.
 */
export function selectOutputNames(text: string): { name: string; range: TextRange }[] {
    const tokens = tokenizeSql(text);
    const selectIndex = topLevelSelectIndex(text, tokens);
    if (selectIndex === -1) {
        return [];
    }
    // Items of the SELECT list, keeping only their tokens outside parentheses: `CAST(x AS STRING) AS y` has one top-level AS
    const items: Token[][] = [[]];
    let depth = 0;
    for (let i = selectIndex + 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === 'open') {
            depth++;
            continue;
        }
        if (token.kind === 'close') {
            depth--;
            if (depth < 0) {
                break;
            }
            continue;
        }
        if (depth > 0) {
            continue;
        }
        if (wordIs(text, token, 'FROM')) {
            break;
        }
        if (token.kind === 'comma') {
            items.push([]);
            continue;
        }
        items[items.length - 1].push(token);
    }

    const names: { name: string; range: TextRange }[] = [];
    for (const item of items) {
        const lastAs = item.map((token, i) => (wordIs(text, token, 'AS') ? i : -1)).filter((i) => i !== -1).pop();
        const candidate = lastAs !== undefined ? item[lastAs + 1] : item[item.length - 1];
        if (!candidate || (candidate.kind !== 'word' && candidate.kind !== 'quoted')) {
            continue;
        }
        if (['DISTINCT', 'ALL'].some((word) => wordIs(text, candidate, word))) {
            continue;
        }
        names.push({ name: text.slice(candidate.innerStart, candidate.innerEnd), range: { start: candidate.start, end: candidate.end } });
    }
    return names;
}

export function findSelectAlias(text: string, column: string): TextRange | undefined {
    return selectOutputNames(text).find((item) => item.name.toLowerCase() === column.toLowerCase())?.range;
}

/** `dataset.table`, leaving out the project */
function shortName(table: string): string {
    return table.split('.').slice(1).join('.') || table;
}

/**
 * The warning text, or undefined when nothing reads the column. Readers that copy the column come first; the
 * rest use it in an expression, a filter or a join, which Dataplex doesn't tell apart.
 */
export function impactMessage(impact: ColumnImpact, links: ColumnLink[], focusTable: string, maxNamed = 3): string | undefined {
    const readers = links
        .filter((link) => link.column)
        .sort((a, b) => Number(b.dependencyType === 'EXACT_COPY') - Number(a.dependencyType === 'EXACT_COPY')
            || `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
    const mayRead = links.filter((link) => !link.column).map((link) => shortName(link.table)).sort();
    if (readers.length === 0 && mayRead.length === 0) {
        return undefined;
    }

    const { column, change } = impact;
    const parts = [change.kind === 'dropped'
        ? `${column} exists in prod but this query no longer produces it.`
        : `${column} changes type from ${change.from} to ${change.to}.`];
    if (readers.length > 0) {
        const named = readers.slice(0, maxNamed).map((link) =>
            `${shortName(link.table)}.${link.column} (${link.dependencyType === 'EXACT_COPY' ? 'copy' : 'derived or filtered'})`);
        const more = readers.length > maxNamed ? ` and ${readers.length - maxNamed} more` : '';
        const count = `${readers.length} column${readers.length === 1 ? '' : 's'}`;
        parts.push(`${change.kind === 'dropped' ? 'Still read' : 'Read'} by ${count}: ${named.join(', ')}${more}.`);
    }
    if (mayRead.length > 0) {
        parts.push(`May also read it (no column detail): ${mayRead.join(', ')}.`);
    }
    parts.push(`Dataplex lineage for ${shortName(focusTable)}, last 30 days.`);
    return parts.join(' ');
}
