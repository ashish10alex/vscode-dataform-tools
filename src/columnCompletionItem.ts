import * as vscode from 'vscode';
import { ColumnChoice, hasStruct, sqlType } from './utils/columnPaths';

/**
 * The completion of a column, the same in .sqlx files, scratch queries and dbt models: the name with its type right
 * after it, and its table to the right, so that one name in two tables is two entries that can be told apart. The
 * details say the description as it is written; a STRUCT's full type is said above it, as the list cuts a long one.
 */
export function columnCompletionItem({ field, table }: ColumnChoice, range?: vscode.Range): vscode.CompletionItem {
    const type = sqlType(field);
    const item = new vscode.CompletionItem({ label: field.name, detail: type ? ` ${type}` : undefined, description: table }, vscode.CompletionItemKind.Field);
    item.insertText = field.name;
    item.filterText = field.name;
    item.sortText = `0${field.name}`;
    if (range) {
        item.range = range;
    }
    const documentation = [hasStruct(field) ? type : '', field.description?.trim()].filter(Boolean).join('\n\n');
    if (documentation) {
        item.documentation = documentation;
    }
    return item;
}
