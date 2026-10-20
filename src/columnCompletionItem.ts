import * as vscode from 'vscode';
import { MergedColumn, hasStruct, partMatch, sqlType } from './utils/columnPaths';

const oneLine = (text: string | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const unique = (texts: string[]) => [...new Set(texts.filter(Boolean))];

/**
 * The completion of a column name, the same in .sqlx files, scratch queries and dbt models, once however many tables
 * have it: the name with its type right after it, and its description to the right, so that it is seen without the
 * details. The details say the description in full and the tables that have the column; a STRUCT's full type is said
 * above, as the list cuts a long one.
 */
export function columnCompletionItem(column: MergedColumn, range?: vscode.Range): vscode.CompletionItem {
    const types = unique(column.choices.map((choice) => sqlType(choice.field)));
    const description = column.choices.map((choice) => oneLine(choice.field.description)).find(Boolean);
    const item = new vscode.CompletionItem({ label: column.name, detail: types.length ? ` ${types.join(' | ')}` : undefined, description }, vscode.CompletionItemKind.Field);
    item.insertText = column.name;
    item.filterText = column.name;
    item.sortText = `0${column.name}`;
    if (range) {
        item.range = range;
    }
    item.documentation = columnDetails(column);
    return item;
}

/**
 * What the details of a column say: a STRUCT's full type, the description shown in the list, and the tables that
 * have the column. A table whose description differs is said with its own.
 */
export function columnDetails(column: MergedColumn): string {
    const structs = unique(column.choices.filter((choice) => hasStruct(choice.field)).map((choice) => sqlType(choice.field)));
    const tablesOf = new Map<string, string[]>();
    for (const choice of column.choices) {
        const description = (choice.field.description ?? '').trim();
        const tables = tablesOf.get(description) ?? [];
        if (!tables.includes(choice.table)) {
            tables.push(choice.table);
        }
        tablesOf.set(description, tables);
    }
    const shown = [...tablesOf.keys()].find(Boolean);
    const tables = [...tablesOf].map(([description, names]) => (description === (shown ?? '') ? names.join(', ') : `${names.join(', ')}: ${description || 'no description'}`));
    return [...structs, shown, tables.join('\n')].filter(Boolean).join('\n\n');
}

/** A table, view or CTE that can follow FROM or JOIN, as `dataset.name` with its kind right after it */
export interface TableChoice {
    label: string;
    /** Other names that find it, such as its full name */
    alsoMatches?: string[];
    kind: string;
    description?: string;
    insertText: string;
}

/**
 * The completions of the table names that match `typed` by any part of their name (see `partMatch`), best first. The
 * editor filters by the text of `range` itself, so each says that text is its own, and the list asks again at each key.
 */
export function tableCompletionItems(tables: TableChoice[], typed: string, range: vscode.Range, rangeText: string): vscode.CompletionList {
    const matched = tables
        .map((table, index) => ({ table, index, rank: Math.min(...[table.label, ...(table.alsoMatches ?? [])].map((name) => partMatch(name, typed)?.rank ?? Infinity)) }))
        .filter((each) => each.rank !== Infinity)
        .sort((a, b) => a.rank - b.rank || a.index - b.index);
    const items = matched.map(({ table }, order) => {
        const item = new vscode.CompletionItem({ label: table.label, detail: ` ${table.kind}` }, vscode.CompletionItemKind.Struct);
        item.insertText = table.insertText;
        item.filterText = rangeText;
        item.sortText = String(order).padStart(5, '0');
        item.range = range;
        if (table.description?.trim()) {
            item.documentation = table.description.trim();
        }
        return item;
    });
    return new vscode.CompletionList(items, true);
}
