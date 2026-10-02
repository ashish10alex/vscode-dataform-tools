import * as vscode from 'vscode';
import { getCurrentFileMetadata } from '../utils';
import { tableActions } from '../shared/columnLineage/tableActions';
import { GraphAction, graphNeighbours, guessColumnLinks, indexGraph, targetFqn } from '../shared/columnLineage/graphLinks';
import { ColumnLink, LineageDirection, TraceFocus, TraceSource } from '../shared/columnLineage/types';
import { SchemaCache } from './schemaCache';

/**
 * Sample lineage for the open project: real dependents and dependencies from the compiled graph, with column
 * links guessed from each table's BigQuery schema. For trying the panel where Dataplex has no lineage.
 */
export class GraphSampleSource implements TraceSource {
    readonly kind = 'graph' as const;

    constructor(private readonly schemas: SchemaCache, private readonly index: Map<string, GraphAction>) {}

    resolveFile = (table: string): string | undefined => this.index.get(table)?.fileName;

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const own = await this.schemas.schema(table);
        const type = own?.find((field) => field.name.toLowerCase() === column.toLowerCase())?.type ?? '';
        const neighbours = await Promise.all(graphNeighbours(this.index, table, direction).map(async (action) => ({
            action,
            columns: await this.schemas.schema(action.fqn),
        })));
        return guessColumnLinks({ name: column, type }, neighbours, direction);
    }

    clearCache() {
        this.schemas.clear();
    }
}

export interface EditorFocus {
    focus: TraceFocus;
    schemas: SchemaCache;
    /** Actions keyed by their dev targets */
    index: Map<string, GraphAction>;
}

/** The identifier under the cursor, which may be a column name */
export function wordAtCursor(editor: vscode.TextEditor): string | undefined {
    const range = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_][A-Za-z0-9_]*/);
    return range ? editor.document.getText(range) : undefined;
}

/**
 * The column under the cursor in the active `.sqlx` file, or one picked from the table's columns when the
 * cursor is not on one. Undefined when there is nothing to trace or the user cancels.
 */
export async function focusFromEditor(): Promise<EditorFocus | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.uri.fsPath.endsWith('.sqlx')) {
        vscode.window.showInformationMessage('Open a .sqlx file and put the cursor on a column to trace it.');
        return undefined;
    }
    if (!CACHED_COMPILED_DATAFORM_JSON) {
        vscode.window.showInformationMessage('Compile the project first, so the trace can use its dependency graph.');
        return undefined;
    }
    const curFileMeta = await getCurrentFileMetadata(false);
    const target = tableActions(curFileMeta?.fileMetadata?.tables)[0]?.target;
    if (!target) {
        vscode.window.showInformationMessage('This file defines no table to trace.');
        return undefined;
    }

    const index = indexGraph(CACHED_COMPILED_DATAFORM_JSON);
    const table = targetFqn(target);
    const schemas = new SchemaCache();

    const word = wordAtCursor(editor);
    const columns = await schemas.schema(table);
    if (!columns?.length) {
        if (!word) {
            vscode.window.showInformationMessage(`Couldn't read the schema of ${table}. Put the cursor on a column name to trace it.`);
            return undefined;
        }
        return { focus: { table, column: word }, schemas, index };
    }

    let column = columns.find((field) => field.name.toLowerCase() === word?.toLowerCase())?.name;
    if (!column) {
        const picked = await vscode.window.showQuickPick(
            columns.map((field) => ({ label: field.name, description: field.type })),
            { placeHolder: `Pick a column of ${table.split('.').pop()} to trace${word ? ` ("${word}" isn't one of its columns)` : ''}` },
        );
        column = picked?.label;
    }
    return column ? { focus: { table, column }, schemas, index } : undefined;
}
