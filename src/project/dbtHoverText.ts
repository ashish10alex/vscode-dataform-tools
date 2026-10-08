import { Action, isMadeUpTarget } from '../shared/compiledGraph';
import type { ColumnMetadata } from '../types';
import { applyColumnDescriptions, flattenSchemaRows } from '../utils/schemaTree';
import type { HeldTable } from './dbtSchemas';

/*
 * What a hover in a file of a dbt Project says (piece 7.6 of the build plan), as Markdown. The dbt side is from the
 * Compiled Graph: the Kind, the file, and the descriptions written in the Project's YAML. The BigQuery side is the
 * held table (see dbtSchemas.ts). No `vscode` import: the provider wraps the text.
 */

/** The most rows of a schema a hover lists, as for a Dataform table */
const MAX_ROWS = 150;

/**
 * Text from a description or a name, on one line and safe inside a Markdown table cell. A description stays
 * Markdown, as dbt's docs take it.
 */
const plain = (text: string) => text.replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

const bigQueryUrl = ({ database, schema, name }: Action['target']) =>
    `https://console.cloud.google.com/bigquery?project=${database}&ws=!1m5!1m4!4m3!1s${database}!2s${schema}!3s${name}`;

/** The columns of the table with the descriptions the Project's YAML gives them, which win over BigQuery's: they are what the next build writes */
function describedFields(action: Action, table: HeldTable | undefined): ColumnMetadata[] {
    if (table?.state === 'found') {
        return action.columns?.length ? applyColumnDescriptions(table.fields, action.columns) : table.fields;
    }
    // No table to read: what the YAML documents, which has no types
    return (action.columns ?? []).filter((column) => column.path.length === 1).map((column) => ({ name: column.path[0], type: '', description: column.description }));
}

function schemaTable(fields: ColumnMetadata[]): string {
    if (fields.length === 0) {
        return '';
    }
    const { rows, omitted } = flattenSchemaRows(fields, { maxRows: MAX_ROWS });
    const lines = ['| Column | Type | Description |', '|---|---|---|'];
    for (const row of rows) {
        const name = row.depth === 0 ? plain(row.name) : `${'   '.repeat(row.depth - 1)}└─ ${plain(row.name)}`;
        lines.push(`| ${name} | ${plain(row.type)} | ${plain(row.description)} |`);
    }
    if (omitted > 0) {
        lines.push('', `_… ${omitted} more field${omitted === 1 ? '' : 's'} not shown_`);
    }
    return lines.join('\n');
}

/**
 * The hover of a `ref()` or `source()`: the table's BigQuery name, the Action's Kind and file, its description, what
 * BigQuery knows of the table, and its columns. `table` is undefined for an Action that builds none.
 */
export function tableHoverText(action: Action, table: HeldTable | undefined, formatTime: (time: Date) => string = (time) => time.toISOString()): string {
    const { database, schema, name } = action.target;
    const parts: string[] = [];
    parts.push(isMadeUpTarget(action.target) || !table ? `#### ${plain(name)}` : `#### [${database}.${schema}.${name}](${bigQueryUrl(action.target)})`);
    parts.push(`**Kind:** ${action.kind}${action.fileName ? ` · \`${action.fileName}\`` : ''}`);
    const description = (action.description || (table?.state === 'found' ? table.description : '') || '').trim();
    if (description) {
        parts.push(`**Description:** ${plain(description)}`);
    }
    if (!table) {
        parts.push(action.kind === 'ephemeral' ? '_An ephemeral model: it is inlined where it is read, and has no table._' : '_It has no table of its own._');
    } else if (table.state === 'missing') {
        parts.push('_Not built yet: BigQuery has no table of this name._');
    } else if (table.state === 'unknown') {
        parts.push(`_BigQuery could not be asked about the table: ${plain(table.error)}_`);
    } else {
        const facts = [
            table.partition ? `**Partition:** \`${table.partition}\`` : '',
            table.rows !== undefined ? `**Rows:** ${table.rows.toLocaleString('en-US')}` : '',
            table.lastModified !== undefined ? `**Last modified:** ${formatTime(new Date(table.lastModified))}` : '',
        ].filter(Boolean);
        if (facts.length > 0) {
            parts.push(facts.join(' · '));
        }
    }
    const columns = schemaTable(describedFields(action, table));
    if (columns) {
        parts.push('----', columns);
    }
    return parts.join('\n\n');
}

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
