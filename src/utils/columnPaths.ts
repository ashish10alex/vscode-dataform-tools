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
