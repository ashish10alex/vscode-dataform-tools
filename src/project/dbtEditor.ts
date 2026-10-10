import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { Editor, EditorDocument } from '../backend';
import { logger } from '../logger';
import { Action, Target, actionsInFile, buildsTable, isMadeUpTarget, slashPath, targetId } from '../shared/compiledGraph';
import { dbtDryRunResults } from './dbtBigQuery';
import { formatTimestamp } from '../utils';
import { rawTableIdAt, tableHoverMarkdown } from '../hoverProvider';
import type { ColumnSource, SearchedModel } from '../searchTableColumns';
import { TableColumn, columnHoverText, columnsOf } from './dbtHoverText';
import { heldTable, heldTableOfId } from './dbtSchemas';
import { tableHoverText } from './tableHoverText';
import { fileBackendHints, onDidChangeProjects, projects } from './index';
import type { ProjectState } from './registry';
import { extensionConfiguration } from './settings';

/*
 * The editor features of a dbt Project (Step 7 of the build plan). No language is claimed for `.sql`: each provider
 * is registered for the files under a dbt Project's root by path, so it answers whatever language id another
 * extension gave them, and no other folder's `.sql` is touched. The answers come from the dbt Backend's `editor`
 * part; nothing here starts dbt or waits for it.
 *
 * VS Code adds every extension's providers together, so beside another dbt extension the features stand down unless
 * the `dbtEditorFeatures` setting says otherwise.
 */

/** The dbt extensions that offer the same features: dbt Labs' own, and Power User for dbt */
export const OTHER_DBT_EXTENSIONS = ['dbtLabsInc.dbt', 'innoverio.vscode-dbt-power-user'];

export type DbtEditorFeatures = 'auto' | 'on' | 'off';

/** Whether the features are on, and why not when they are not */
export function dbtEditorFeaturesOn(setting: unknown, installed: (id: string) => boolean): { on: true } | { on: false; because: string } {
    if (setting === 'off') {
        return { on: false, because: 'the setting "vscode-dataform-tools.dbtEditorFeatures" is "off"' };
    }
    const other = setting === 'on' ? undefined : OTHER_DBT_EXTENSIONS.find(installed);
    return other
        ? { on: false, because: `the extension ${other} is installed and offers the same. Set "vscode-dataform-tools.dbtEditorFeatures" to "on" to have both` }
        : { on: true };
}

/** A document of a dbt Project, as its Backend's `editor` part takes it */
interface DbtDocument {
    project: ProjectState;
    editor: Editor;
    file: string;
    text: string;
}

function dbtDocument(document: vscode.TextDocument): DbtDocument | undefined {
    if (document.uri.scheme !== 'file') {
        return undefined;
    }
    // A folder that is both a Dataform and a dbt Project: the file is asked about only as its own Backend's
    const found = projects.forFile(document.uri.fsPath, fileBackendHints(document.uri.fsPath));
    const project = found.kind === 'project' ? (found.project as ProjectState) : undefined;
    const editor = project?.dbtBackend?.editor;
    if (!project || !editor) {
        return undefined;
    }
    return { project, editor, file: slashPath(path.relative(project.root, document.uri.fsPath)), text: document.getText() };
}

const at = (dbt: DbtDocument, document: vscode.TextDocument, position: vscode.Position): EditorDocument => ({ file: dbt.file, text: dbt.text, offset: document.offsetAt(position) });

/** The text of a file as it is in an editor, saved or not, else as it is on disk */
async function textOf(file: string): Promise<string | undefined> {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === 'file' && document.uri.fsPath === file);
    return open ? open.getText() : fs.promises.readFile(file, 'utf8').catch(() => undefined);
}

class DbtDefinitionProvider implements vscode.DefinitionProvider {
    async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.LocationLink[] | undefined> {
        const dbt = dbtDocument(document);
        const found = dbt?.editor.definitionAt(at(dbt, document, position));
        if (!dbt || !found) {
            return undefined;
        }
        const target = path.join(dbt.project.root, found.place.fileName);
        const text = found.place.lineIn ? await textOf(target) : undefined;
        if (found.place.lineIn && text === undefined) {
            return undefined;
        }
        // The entry's line when it is still in the file, else the top of the file that had it at the last compile
        const line = (text !== undefined && found.place.lineIn?.(text)) || 0;
        return [{
            originSelectionRange: new vscode.Range(document.positionAt(found.start), document.positionAt(found.end)),
            targetUri: vscode.Uri.file(target),
            targetRange: new vscode.Range(line, 0, line, 0),
        }];
    }
}

/** The columns of the tables of `actions`, from the held schemas: asked of BigQuery at the first need */
export async function columnsOfTables(root: string, actions: Action[]): Promise<TableColumn[]> {
    const tables = await Promise.all(actions.map(async (action) => columnsOf(action, await heldTable(root, action))));
    return tables.flat();
}

/** The columns the file's own queries give, from the dry runs of the Project's latest compile. None before a save has dry-run them */
function ownColumns(dbt: DbtDocument): TableColumn[] {
    const graph = dbt.project.dbtBackend?.lastResult?.graph;
    const results = dbtDryRunResults(dbt.project.root, dbt.project.compileNumber);
    return (graph ? actionsInFile(graph, dbt.file) : []).flatMap((action) => {
        const fields = results.find((result) => result.action === action.id && result.schema)?.schema?.fields;
        return fields ? columnsOf(action, { state: 'found', fields }) : [];
    });
}

class DbtHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const dbt = dbtDocument(document);
        const graph = dbt?.project.dbtBackend?.lastResult?.graph;
        if (!dbt || !graph) {
            return undefined;
        }
        const range = (found: { start: number; end: number }) => new vscode.Range(document.positionAt(found.start), document.positionAt(found.end));
        const table = dbt.editor.tableAt(at(dbt, document, position));
        if (table) {
            const action = graph.actions[table.id];
            return new vscode.Hover(tableHoverMarkdown(tableHoverText(action, await heldTable(dbt.project.root, action), formatTimestamp)), range(table));
        }
        // A plain `project.dataset.table` id: no Action, so only what BigQuery knows of it
        const target = rawTableIdAt(document, position);
        if (target) {
            return new vscode.Hover(tableHoverMarkdown(tableHoverText({ target }, await heldTableOfId(dbt.project.root, target), formatTimestamp)));
        }
        const column = dbt.editor.columnAt(at(dbt, document, position));
        if (!column) {
            return undefined;
        }
        const text = columnHoverText(column.word, await columnsOfTables(dbt.project.root, column.tables.map((id) => graph.actions[id])))
            // No table the file reads has it: a column the file's own query gives, as its last dry run said
            || (column.qualified ? '' : columnHoverText(column.word, ownColumns(dbt)));
        return text ? new vscode.Hover(new vscode.MarkdownString(text), range(column)) : undefined;
    }
}

/**
 * What "Search columns" searches in a file of a dbt Project: the table under the cursor, or one of those the file
 * builds and reads. Undefined for a document that is of no dbt Project, or of one not parsed yet.
 */
export function dbtColumnSource(document: vscode.TextDocument, position: vscode.Position): ColumnSource | undefined {
    const dbt = dbtDocument(document);
    const graph = dbt?.project.dbtBackend?.lastResult?.graph;
    if (!dbt || !graph) {
        return undefined;
    }
    const root = dbt.project.root;
    const ofAction = (action: Action): SearchedModel => ({ target: action.target, columns: action.columns });
    // The Action that builds the table when the Project has one, for the descriptions its YAML gives the columns
    const ofTarget = (target: Target): SearchedModel => {
        const action = graph.actions[targetId(target)];
        return action && buildsTable(action) ? ofAction(action) : { target };
    };
    return {
        ofTarget,
        underCursor: async () => {
            const table = dbt.editor.tableAt(at(dbt, document, position));
            const raw = table ? undefined : rawTableIdAt(document, position);
            return table ? ofAction(graph.actions[table.id]) : raw && ofTarget(raw);
        },
        ofFile: async () => {
            const actions = actionsInFile(graph, dbt.file);
            const built = actions.find(buildsTable);
            return {
                thisFile: built && ofAction(built),
                referenced: actions.flatMap((action) => action.dependencyTargets).filter((target) => !isMadeUpTarget(target)).map(ofTarget),
            };
        },
        fields: async ({ target }) => {
            const action = graph.actions[targetId(target)];
            const table = await (action && buildsTable(action) ? heldTable(root, action)! : heldTableOfId(root, target));
            if (table.state === 'found') {
                return table.fields;
            }
            throw new Error(table.state === 'missing' ? 'BigQuery has no table of this name' : table.error);
        },
    };
}

/**
 * Completions (piece 7.7): inside the quotes of a `ref()` or `source()`, the names it can take; in the SQL of the
 * file, column names: after an alias and a dot the columns of that table, elsewhere those of every table the file
 * reads, each with its table.
 */
class DbtCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
        const dbt = dbtDocument(document);
        const graph = dbt?.project.dbtBackend?.lastResult?.graph;
        if (!dbt || !graph) {
            return undefined;
        }
        const names = dbt.editor.namesAt(at(dbt, document, position));
        if (names) {
            const range = new vscode.Range(document.positionAt(names.start), position);
            return names.names.map(({ name, detail, id }) => {
                const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Reference);
                item.range = range;
                item.detail = detail;
                const action = id === undefined ? undefined : graph.actions[id];
                if (action?.description) {
                    item.documentation = new vscode.MarkdownString(action.description);
                }
                return item;
            });
        }
        const column = dbt.editor.columnAt(at(dbt, document, position), true);
        if (!column || column.tables.length === 0) {
            return undefined;
        }
        const range = new vscode.Range(document.positionAt(column.start), position);
        const columns = await columnsOfTables(dbt.project.root, column.tables.map((id) => graph.actions[id]));
        return columns.map((each) => {
            // The table is said beside the name, so that one name in two tables is two entries that can be told apart
            const item = new vscode.CompletionItem({ label: each.name, description: each.action.target.name }, vscode.CompletionItemKind.Field);
            item.range = range;
            item.detail = [each.type, `${each.action.target.name} (${each.action.kind})`].filter(Boolean).join(' \u00B7 ');
            item.insertText = each.name;
            item.filterText = each.name;
            if (each.description) {
                item.documentation = new vscode.MarkdownString(each.description);
            }
            return item;
        });
    }
}

/** The files of a dbt Project that the features reach, by path and with no language */
export function dbtSelector(root: string, extensions: string): vscode.DocumentSelector {
    return { scheme: 'file', pattern: new vscode.RelativePattern(vscode.Uri.file(root), `**/*.${extensions}`) };
}

let registered: vscode.Disposable[] = [];
let said = '';

function register() {
    registered.forEach((each) => each.dispose());
    registered = [];
    const says: string[] = [];
    for (const project of projects.projects) {
        if (!project.dbtBackend?.editor) {
            continue;
        }
        const setting = extensionConfiguration(vscode.Uri.file(project.root)).get<string>('dbtEditorFeatures');
        const features = dbtEditorFeaturesOn(setting, (id) => vscode.extensions.getExtension(id) !== undefined);
        if (!features.on) {
            says.push(`dbt: go to definition, hover and completions are off in ${project.root}, because ${features.because}.`);
            continue;
        }
        says.push(`dbt: go to definition, hover and completions are on in ${project.root}.`);
        // Go to definition also from a ref() or source() written in a YAML file
        registered.push(vscode.languages.registerDefinitionProvider(dbtSelector(project.root, '{sql,yml,yaml}'), new DbtDefinitionProvider()));
        registered.push(vscode.languages.registerHoverProvider(dbtSelector(project.root, 'sql'), new DbtHoverProvider()));
        // Asked for at a quote, which starts an argument, and at a dot, which follows an alias
        registered.push(vscode.languages.registerCompletionItemProvider(dbtSelector(project.root, 'sql'), new DbtCompletionProvider(), "'", '"', '.'));
    }
    // Said once for each state, not on every look
    if (says.join('\n') !== said) {
        said = says.join('\n');
        says.forEach((each) => logger.info(each));
    }
}

export function initDbtEditor(context: vscode.ExtensionContext) {
    register();
    context.subscriptions.push(
        { dispose: () => registered.forEach((each) => each.dispose()) },
        onDidChangeProjects(register),
        vscode.extensions.onDidChange(register),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.dbtEditorFeatures')) {
                register();
            }
        }),
    );
}
