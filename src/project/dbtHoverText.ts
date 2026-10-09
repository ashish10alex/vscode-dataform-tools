import type { Action } from '../shared/compiledGraph';
import type { HeldTable } from './heldTable';
import { describedFields, plain } from './tableHoverText';

/*
 * What a hover on a column name says in a file of a dbt Project (piece 7.6 of the build plan), as Markdown. The hover
 * of a table is the same for both Backends: see tableHoverText.ts. No `vscode` import: the provider wraps the text.
 */

/** A column of a table an Action builds, as a hover or a completion shows it */
export interface TableColumn {
    action: Action;
    name: string;
    /** Empty when only the Project's YAML knows the column */
    type: string;
    description: string;
}

/** The top-level columns of an Action's table, with the YAML's descriptions */
export function columnsOf(action: Action, table: HeldTable | undefined): TableColumn[] {
    return describedFields(action, table).map((field) => ({
        action,
        name: field.name,
        type: field.mode && field.mode !== 'NULLABLE' ? `${field.type} ${field.mode}`.trim() : field.type,
        description: (field.description ?? '').trim(),
    }));
}

/** The hover of a column name: each table that has a column of the name, with its type and description. Empty when none has */
export function columnHoverText(word: string, columns: TableColumn[]): string {
    const wanted = word.toLowerCase();
    return columns
        .filter((column) => column.name.toLowerCase() === wanted)
        .map((column) => {
            const heading = `**${plain(column.name)}**${column.type ? ` \`${column.type}\`` : ''} · ${plain(column.action.target.name)} (${column.action.kind})`;
            return column.description ? `${heading}\n\n${plain(column.description)}` : heading;
        })
        .join('\n\n----\n\n');
}
