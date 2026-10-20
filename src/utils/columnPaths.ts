// Pure helpers for the column completions of .sqlx files, scratch queries and dbt models: the type a column is shown
// with, and which columns a dotted name such as `o.addr.` leads to. No `vscode` import.
import type { ColumnMetadata } from "../types";

/** Whether the field is a STRUCT whose fields can follow it after a dot: an ARRAY of STRUCTs needs UNNEST first */
export function isStruct(field: ColumnMetadata): boolean {
    return (field.type === "RECORD" || field.type === "STRUCT") && field.mode !== "REPEATED";
}

/** Whether the field's type has a STRUCT in it, an ARRAY of STRUCTs too: one whose signature can be long */
export function hasStruct(field: ColumnMetadata): boolean {
    return field.type === "RECORD" || field.type === "STRUCT";
}

/** The type of a field as SQL writes it, in full: `ARRAY<STRING>`, `STRUCT<city STRING, zip STRING>`. Empty when not known */
export function sqlType(field: ColumnMetadata): string {
    const type = hasStruct(field) && field.fields?.length
        ? `STRUCT<${field.fields.map((each) => `${each.name} ${sqlType(each)}`.trim()).join(", ")}>`
        : hasStruct(field) ? "STRUCT" : field.type ?? "";
    return field.mode === "REPEATED" && type ? `ARRAY<${type}>` : type;
}

/** The fields reached by following `path` through STRUCT columns of `fields`, whatever the case. Undefined when it leads nowhere */
export function structFields(fields: ColumnMetadata[], path: string[]): ColumnMetadata[] | undefined {
    let current = fields;
    for (const name of path) {
        const wanted = name.toLowerCase();
        const field = current.find((each) => each.name.toLowerCase() === wanted);
        if (!field || !isStruct(field)) {
            return undefined;
        }
        current = field.fields ?? [];
    }
    return current;
}

/**
 * The dotted name being typed at the end of `linePrefix`: `o.addr.ci` is the qualifiers `o` and `addr`, and the word
 * `ci`. Undefined without a dot, and for a name in backticks or after `}` or `)`, which is not a column path.
 */
export function dottedNameBefore(linePrefix: string): { qualifiers: string[]; word: string } | undefined {
    const match = /(?:^|[^\w.`$}\-)])((?:[A-Za-z_]\w*\.)+)(\w*)$/.exec(linePrefix);
    if (!match) {
        return undefined;
    }
    return { qualifiers: match[1].split(".").slice(0, -1), word: match[2] };
}

/** Words that follow a table name in a FROM clause and are not its alias */
const NOT_ALIASES = new Set([
    "where", "join", "inner", "left", "right", "full", "cross", "outer", "natural", "on", "using", "group", "order",
    "limit", "union", "except", "intersect", "qualify", "window", "having", "select", "for", "tablesample", "with",
    "pivot", "unpivot", "lateral", "from", "and", "or", "not", "is", "in", "like", "between", "by", "when", "then",
    "else", "end", "into", "set", "values",
]);

/** The alias given at the start of `after`, the text right after a table name: `orders o` and `orders AS o` */
export function aliasAt(after: string): string | undefined {
    const alias = /^\s+(?:as\s+)?([A-Za-z_]\w*)/i.exec(after)?.[1];
    return alias && !NOT_ALIASES.has(alias.toLowerCase()) ? alias : undefined;
}

/** A table whose columns can be offered, with the names a query can qualify them with: its aliases and its own name */
export interface ColumnTable {
    /** How the table is shown beside each column: its short name */
    table: string;
    names: string[];
    fields: ColumnMetadata[];
}

/** A column or STRUCT field to offer, and the table it is of */
export interface ColumnChoice {
    field: ColumnMetadata;
    table: string;
}

/**
 * What can follow the dotted `qualifiers`. A first qualifier that names a table (by an alias or its own name) wins,
 * as it does in BigQuery: the rest is a path through that table's STRUCT columns. Otherwise every qualifier is a path
 * through the STRUCT columns of each table. Undefined when the qualifiers lead nowhere.
 */
export function columnsAfterDots(qualifiers: string[], tables: ColumnTable[]): ColumnChoice[] | undefined {
    const first = qualifiers[0]?.toLowerCase();
    const named = tables.filter((each) => each.names.some((name) => name.toLowerCase() === first));
    const [from, path] = named.length > 0 ? [named, qualifiers.slice(1)] : [tables, qualifiers];
    const choices = from.flatMap((each) => (structFields(each.fields, path) ?? []).map((field) => ({ field, table: each.table })));
    return choices.length > 0 ? choices : undefined;
}

/** A column name offered once, with each table that has it: the first one's casing is shown */
export interface MergedColumn {
    name: string;
    choices: ColumnChoice[];
}

/** The choices with one entry for each column name, whatever its case, in the order they first come */
export function mergeColumns(choices: ColumnChoice[]): MergedColumn[] {
    const merged = new Map<string, MergedColumn>();
    for (const choice of choices) {
        const key = choice.field.name.toLowerCase();
        const column = merged.get(key);
        if (column) {
            column.choices.push(choice);
        } else {
            merged.set(key, { name: choice.field.name, choices: [choice] });
        }
    }
    return [...merged.values()];
}

/**
 * The SQL with its comments and string literals as spaces of the same length, so that offsets stay the same and a
 * keyword in a string is no keyword. Names in backticks stay.
 */
export function blankSql(sql: string): string {
    return sql.replace(/--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|`[^`\n]*`?|'(?:[^'\\\n]|\\.)*'?|"(?:[^"\\\n]|\\.)*"?/g,
        (match) => (match.startsWith('`') ? match : match.replace(/[^\n]/g, ' ')));
}

/** Whether a table name is what the SQL before it asks for: right after FROM or JOIN, or after a comma in a FROM list */
/**
 * The digits, as trigger characters of a completion provider. VS Code opens no list as you type a word that is a
 * number, such as the `0400` of a table `0400_orders`, so a digit asks the provider, which offers the tables there only
 */
export const DIGITS = '0123456789'.split('');

/** Whether a completion was asked for by typing a digit */
export function isDigitTrigger(context: { triggerCharacter?: string }): boolean {
    return !!context.triggerCharacter && DIGITS.includes(context.triggerCharacter);
}

export function inFromList(sqlBefore: string): boolean {
    const before = blankSql(sqlBefore);
    if (/\b(?:from|join)\s+$/i.test(before)) {
        return true;
    }
    if (!/,\s*$/.test(before)) {
        return false;
    }
    // The clause the comma is in: a closed `( ... )`, such as a sub-query, is not it, nor anything before an open one
    let flat = before;
    for (let last = ''; last !== flat;) {
        last = flat;
        flat = flat.replace(/\([^()]*\)/g, (group) => ' '.repeat(group.length));
    }
    const clause = flat.slice(flat.lastIndexOf('(') + 1);
    const keyword = [...clause.matchAll(/\b(from|join|where|select|on|using|with|group\s+by|order\s+by|having|qualify|window|limit)\b/gi)].pop();
    return !!keyword && /^(from|join)$/i.test(keyword[1]);
}

/** The names the WITH clauses of the SQL give their CTEs, each once */
export function cteNames(sql: string): string[] {
    const names: string[] = [];
    for (const match of blankSql(sql).matchAll(/(?:\bwith(?:\s+recursive)?|,)\s*(`[^`\n]+`|[A-Za-z_]\w*)\s+as\s*\(/gi)) {
        const name = match[1].replace(/`/g, '');
        if (!names.includes(name)) {
            names.push(name);
        }
    }
    return names;
}

/** Where the statement at `offset` begins and ends: the text between the semicolons around it */
export function statementAt(sql: string, offset: number): [number, number] {
    const text = blankSql(sql);
    const end = text.indexOf(';', offset);
    return [text.lastIndexOf(';', offset - 1) + 1, end === -1 ? sql.length : end];
}

/**
 * How `typed` matches `label`, any case, or undefined: rank 0 when it begins the label, 1 when it begins a part of
 * it after a `.`, `_` or `-`, 2 when each of its words begins a part, in order. So `030` and `0300_DAILY` both find
 * `sales_report.0300_ORDER_DATA_DAILY`, as a prefix alone never would.
 */
export function partMatch(label: string, typed: string): { rank: number } | undefined {
    const text = label.toLowerCase();
    const wanted = typed.toLowerCase();
    const starts = [0, ...[...text.matchAll(/[._-]+/g)].map((match) => match.index + match[0].length)];
    const at = starts.find((start) => text.startsWith(wanted, start));
    if (at !== undefined) {
        return { rank: at > 0 ? 1 : 0 };
    }
    const words = wanted.split(/[._-]+/).filter(Boolean);
    if (words.length < 2) {
        return undefined;
    }
    let next = 0;
    for (const word of words) {
        while (next < starts.length && !text.startsWith(word, starts[next])) {
            next++;
        }
        if (next === starts.length) {
            return undefined;
        }
        next++;
    }
    return { rank: 2 };
}
