import * as vscode from 'vscode';
import { logger } from '../logger';
import { getCurrentFileMetadata, getWorkspaceFolder } from '../utils';
import { getProdCompilerOptions, getProdTargets } from '../defer/prodTargets';
import { lookupProdTarget, prodKey } from '../defer/deferRules';
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

/**
 * The project's actions keyed by Prod Target, which is where Dataplex has lineage. Falls back to the dev
 * targets when there are no Prod Options or the prod compile fails.
 */
async function indexByProdTarget(devIndex: Map<string, GraphAction>): Promise<{ index: Map<string, GraphAction>; toProd: (dev: string) => string }> {
    const graph = CACHED_COMPILED_DATAFORM_JSON;
    const workspaceFolder = await getWorkspaceFolder();
    const prodOptions = workspaceFolder ? getProdCompilerOptions(workspaceFolder) : undefined;
    if (!graph || !workspaceFolder || prodOptions === undefined) {
        return { index: devIndex, toProd: (dev) => dev };
    }
    try {
        const actions = [...(graph.tables ?? []), ...(graph.operations ?? []), ...(graph.declarations ?? [])];
        const prodTargets = await getProdTargets(workspaceFolder, prodOptions, actions.map((action) => prodKey(action)));
        const devToProd = new Map<string, string>();
        for (const action of actions) {
            const prod = lookupProdTarget(prodTargets, action);
            devToProd.set(targetFqn(action.target), prod ? targetFqn(prod) : targetFqn(action.target));
        }
        const index = new Map<string, GraphAction>();
        devIndex.forEach((action, dev) => {
            const fqn = devToProd.get(dev) ?? dev;
            index.set(fqn, { ...action, fqn, dependsOn: action.dependsOn.map((dependency) => devToProd.get(dependency) ?? dependency) });
        });
        return { index, toProd: (dev) => devToProd.get(dev) ?? dev };
    } catch (error: any) {
        logger.error(`Column trace: could not resolve Prod Targets, using dev targets: ${error?.message ?? error}`);
        return { index: devIndex, toProd: (dev) => dev };
    }
}

export interface EditorFocus {
    focus: TraceFocus;
    schemas: SchemaCache;
    /** Actions keyed by the targets the focus table is named in: Prod Targets for Dataplex, dev targets otherwise */
    index: Map<string, GraphAction>;
}

/**
 * The column under the cursor in the active `.sqlx` file, or one picked from the table's columns when the
 * cursor is not on one. With `prod`, the trace starts from the action's Prod Target, where Dataplex has
 * lineage. Undefined when there is nothing to trace or the user cancels.
 */
export async function focusFromEditor(prod: boolean): Promise<EditorFocus | undefined> {
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

    const devIndex = indexGraph(CACHED_COMPILED_DATAFORM_JSON);
    const { index, toProd } = prod ? await indexByProdTarget(devIndex) : { index: devIndex, toProd: (dev: string) => dev };
    const table = toProd(targetFqn(target));
    const schemas = new SchemaCache();

    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active, /[A-Za-z_][A-Za-z0-9_]*/);
    const word = wordRange ? editor.document.getText(wordRange) : undefined;
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
