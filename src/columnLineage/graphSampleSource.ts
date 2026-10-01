import * as vscode from 'vscode';
import { logger } from '../logger';
import { fetchTableMetadata } from '../hoverProvider';
import { getCurrentFileMetadata } from '../utils';
import { GraphAction, SchemaColumn, graphNeighbours, guessColumnLinks, indexGraph } from '../shared/columnLineage/graphLinks';
import { ColumnLink, LineageDirection, TraceFocus, TraceSource } from '../shared/columnLineage/types';

/**
 * Sample lineage for the open project: real dependents and dependencies from the compiled graph, with column
 * links guessed from each table's BigQuery schema. Stands in for Dataplex until it has column lineage for
 * Dataform-built tables.
 */
export class GraphSampleSource implements TraceSource {
    readonly kind = 'graph' as const;
    private readonly schemas = new Map<string, Promise<SchemaColumn[] | undefined>>();

    constructor(private readonly index: Map<string, GraphAction>) {}

    resolveFile = (table: string): string | undefined => this.index.get(table)?.fileName;

    schema(table: string): Promise<SchemaColumn[] | undefined> {
        let pending = this.schemas.get(table);
        if (!pending) {
            const [projectId, datasetId, tableId] = table.split('.');
            pending = fetchTableMetadata(projectId, datasetId, tableId)
                .then((metadata: any) => (metadata?.schema?.fields ?? []).map((field: any) => ({ name: String(field.name), type: String(field.type) })))
                .catch((error: any) => {
                    logger.debug(`Column trace: no schema for ${table}: ${error?.message ?? error}`);
                    return undefined;
                });
            this.schemas.set(table, pending);
        }
        return pending;
    }

    async links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const own = await this.schema(table);
        const type = own?.find((field) => field.name.toLowerCase() === column.toLowerCase())?.type ?? '';
        const neighbours = await Promise.all(graphNeighbours(this.index, table, direction).map(async (action) => ({
            action,
            columns: await this.schema(action.fqn),
        })));
        return guessColumnLinks({ name: column, type }, neighbours, direction);
    }

    clearCache() {
        this.schemas.clear();
    }
}

/**
 * The column under the cursor in the active `.sqlx` file, or one picked from the table's columns when the
 * cursor is not on one. Undefined when there is nothing to trace or the user cancels.
 */
export async function focusFromEditor(): Promise<{ focus: TraceFocus; source: GraphSampleSource } | undefined> {
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
    const target = curFileMeta?.fileMetadata?.tables?.[0]?.target;
    if (!target) {
        vscode.window.showInformationMessage('This file defines no table to trace.');
        return undefined;
    }
    const table = `${target.database}.${target.schema}.${target.name}`;
    const source = new GraphSampleSource(indexGraph(CACHED_COMPILED_DATAFORM_JSON));

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_][A-Za-z0-9_]*/);
    const word = wordRange ? editor.document.getText(wordRange) : undefined;
    const columns = await source.schema(table);
    if (!columns?.length) {
        if (!word) {
            vscode.window.showInformationMessage(`Couldn't read the schema of ${table}. Put the cursor on a column name to trace it.`);
            return undefined;
        }
        return { focus: { table, column: word }, source };
    }

    let column = columns.find((field) => field.name.toLowerCase() === word?.toLowerCase())?.name;
    if (!column) {
        const picked = await vscode.window.showQuickPick(
            columns.map((field) => ({ label: field.name, description: field.type })),
            { placeHolder: `Pick a column of ${target.name} to trace${word ? ` ("${word}" isn't one of its columns)` : ''}` },
        );
        column = picked?.label;
    }
    return column ? { focus: { table, column }, source } : undefined;
}
