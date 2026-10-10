import { ColumnDescription, Target, isMadeUpTarget } from '../shared/compiledGraph';
import type { ColumnMetadata } from '../types';
import { applyColumnDescriptions, flattenSchemaRows } from '../utils/schemaTree';
import type { HeldTable } from './heldTable';

/*
 * What the hover of a table says, as Markdown: the same for a Dataform and a dbt Project. The Project's side is what
 * its code says of the table: the Kind, and the descriptions written in the config block or the YAML. The BigQuery
 * side is the table as BigQuery has it (see heldTable.ts). No `vscode` import: the provider wraps the text.
 */

/** The command of the "Search columns" link. The hover's Markdown must be trusted to run it */
export const SEARCH_COLUMNS_COMMAND = 'vscode-dataform-tools.searchTableColumns';

/** The most rows of a schema a hover lists */
const MAX_ROWS = 150;

/** One level of nesting. Non-breaking spaces, which the Markdown table keeps */
const INDENT = '   ';

/**
 * Text from a description or a name, on one line and safe inside a Markdown table cell. A description stays
 * Markdown, as dbt's docs take it.
 */
export const plain = (text: string) => text.replace(/\s*\r?\n\s*/g, ' ').replace(/\|/g, '\\|').trim();

/** A table as the Project's code describes it. An Action is one */
export interface HoveredTable {
    target: Target;
    /** Absent for a table the Project has no Action for: a plain `project.dataset.table` id */
    kind?: string;
    description?: string;
    columns?: ColumnDescription[];
    /** The partition the code asks for: said while there is no table to read the real one from */
    partition?: string;
}

const bigQueryUrl = ({ database, schema, name }: Target) =>
    `https://console.cloud.google.com/bigquery?project=${database}&ws=!1m5!1m4!4m3!1s${database}!2s${schema}!3s${name}`;

/** The columns of the table with the descriptions the Project's code gives them, which win over BigQuery's: they are what the next build writes */
export function describedFields(hovered: HoveredTable, table: HeldTable | undefined): ColumnMetadata[] {
    if (table?.state === 'found') {
        return hovered.columns?.length ? applyColumnDescriptions(table.fields, hovered.columns) : table.fields;
    }
    // No table to read: what the code documents, which has no types
    return (hovered.columns ?? []).filter((column) => column.path.length === 1).map((column) => ({ name: column.path[0], type: '', description: column.description }));
}

function schemaTable(fields: ColumnMetadata[]): string {
    if (fields.length === 0) {
        return '';
    }
    const { rows, omitted } = flattenSchemaRows(fields, { maxRows: MAX_ROWS });
    const lines = ['| Column | Type | Description |', '|:---|:---|:---|'];
    for (const row of rows) {
        const name = row.depth === 0 ? plain(row.name) : `${INDENT.repeat(row.depth - 1)}└─ ${plain(row.name)}`;
        lines.push(`| ${name} | ${plain(row.type)} | ${plain(row.description)} |`);
    }
    if (omitted > 0) {
        lines.push('', `_… ${omitted} more field${omitted === 1 ? '' : 's'} not shown, use Search columns_`);
    }
    return lines.join('\n');
}

/** Why there is no table to describe, when there is none */
function withoutTable(hovered: HoveredTable, table: HeldTable | undefined): string {
    if (!table) {
        return hovered.kind === 'ephemeral' ? '_An ephemeral model: it is inlined where it is read, and has no table._' : '_It has no table of its own._';
    }
    if (table.state === 'missing') {
        return hovered.kind ? '_Not built yet: BigQuery has no table of this name._' : '_BigQuery has no table of this name._';
    }
    return table.state === 'unknown' ? `_BigQuery could not be asked about the table: ${plain(table.error)}_` : '';
}

const joined = (facts: string[]) => facts.filter(Boolean).join(' · ');

/**
 * The hover of a table: its BigQuery name, a link to search its columns, its Kind and location, its description, its
 * partition, row count and last change, and its columns. `table` is undefined for an Action that builds none.
 */
export function tableHoverText(hovered: HoveredTable, table: HeldTable | undefined, formatTime: (time: Date) => string = (time) => time.toISOString()): string {
    const { database, schema, name } = hovered.target;
    const found = table?.state === 'found' ? table : undefined;
    const parts: string[] = [];
    parts.push(isMadeUpTarget(hovered.target) || !table ? `#### ${plain(name)}` : `#### [${database}.${schema}.${name}](${bigQueryUrl(hovered.target)})`);
    // The hover itself cannot be searched. Directly under the title: below a long schema it is easy to miss
    if (found?.fields.length) {
        parts.push(`[$(search) Search columns](command:${SEARCH_COLUMNS_COMMAND}?${encodeURIComponent(JSON.stringify([hovered.target]))})`);
    }
    parts.push(joined([hovered.kind ? `**Kind:** ${hovered.kind}` : '', found?.location ? `**Location:** ${found.location}` : '']));
    const description = (hovered.description || found?.description || '').trim();
    if (description) {
        parts.push(`**Description:** ${plain(description)}`);
    }
    parts.push(withoutTable(hovered, table));
    // The partition the table has. What the code asks for only while there is no table: the two differ until the next build
    const partition = found ? found.partition : table && hovered.partition;
    parts.push(joined([
        partition ? `**Partition:** \`${plain(partition)}\`` : '',
        found?.rows !== undefined ? `**Rows:** ${found.rows.toLocaleString('en-US')}` : '',
        found?.lastModified !== undefined ? `**Last modified:** ${formatTime(new Date(found.lastModified))}` : '',
    ]));
    const columns = schemaTable(describedFields(hovered, table));
    if (columns) {
        parts.push('----', columns);
    }
    return parts.filter(Boolean).join('\n\n');
}
