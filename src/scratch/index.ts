import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { getBigQueryClientFor, getJobSettings } from '../bigqueryClient';
import { queryDryRun } from '../bigqueryDryRun';
import type { JobPlace } from '../bigquery/jobPlace';
import { currencySymbolMapping } from '../constants';
import { logger } from '../logger';
import { dataformPreviewQuery, runQueryInPanel } from '../previewQueryResults';
import { previewQuery } from '../bigquery/preview';
import { countDeferred } from '../defer';
import { compiledJson, fileBackendHints, projects, ProjectState } from '../project';
import { extensionConfiguration } from '../project/settings';
import { tableOfError, tableOfMetadata } from '../project/heldTable';
import { tableHoverText } from '../project/tableHoverText';
import { fetchTableMetadata, tableHoverMarkdown } from '../hoverProvider';
import { formatTimestamp } from '../utils';
import { Action, CompiledGraph, Target, actionsInFile, buildsTable, kindHasTable, previewSection, slashPath, targetId } from '../shared/compiledGraph';
import { formatBytes } from '../shared/panelBigQueryView';
import type { BigQueryDryRunResponse, ColumnMetadata } from '../types';
import { columnCompletionItem } from '../columnCompletionItem';
import { ColumnTable, columnsAfterDots, dottedNameBefore } from '../utils/columnPaths';
import type { CustomViewProvider } from '../views/register-query-results-panel';
import {
    columnNamesText, compiledQueryNote, hasStatement, isScratchPath, runConfirmation, scanLevel, scratchFileName, scratchHeaderText, scratchJobPlace, SCRATCH_FOLDER, tableNameText, tableNamePrefix,
    tableQueryText,
    tableAliasesIn, tableNamesAt, tableNamesIn,
    type TableName,
} from './scratchQuery';

/*
 * Scratch queries in the editor: the command that makes one, running one, its dry run on save in the status bar and
 * as diagnostics, and completion of table and column names. See ./scratchQuery.ts for what a scratch query is.
 */

const SCRATCH_SELECTOR: vscode.DocumentSelector = { scheme: 'file', pattern: `**/${SCRATCH_FOLDER}/*.sql` };
const DEFAULT_WARN_GIB = 10;
const DEFAULT_CONFIRM_GIB = 50;

/** Whether the document is a scratch query. The features for the files of a Project leave these alone. */
export function isScratchDocument(document: vscode.TextDocument | undefined): boolean {
    return !!document && document.uri.scheme === 'file' && isScratchPath(document.uri.fsPath);
}

function projectOf(filePath: string): ProjectState | undefined {
    const found = projects.forFile(filePath, fileBackendHints(filePath));
    return found.kind === 'project' ? (found.project as ProjectState) : undefined;
}

function graphOf(project: ProjectState | undefined): CompiledGraph | undefined {
    return project?.dataformBackend?.graph ?? project?.dbtBackend?.lastResult?.graph;
}

/** Where the jobs of the scratch query at `filePath` run: see `scratchJobPlace` */
function placeOf(filePath: string): JobPlace {
    const project = projectOf(filePath);
    const databases = Object.values(graphOf(project)?.actions ?? {}).filter((action) => kindHasTable(action.kind)).map((action) => action.target.database);
    return scratchJobPlace(project?.backend ?? 'dataform', databases, getJobSettings());
}

const thresholds = () => ({
    warnGiB: extensionConfiguration().get<number>('scratchQueryWarnScanGiB') ?? DEFAULT_WARN_GIB,
    confirmGiB: extensionConfiguration().get<number>('scratchQueryConfirmScanGiB') ?? DEFAULT_CONFIRM_GIB,
});

function costText(dryRun: BigQueryDryRunResponse): string | undefined {
    const cost = dryRun.statistics?.cost;
    if (!cost) {
        return undefined;
    }
    const symbol = currencySymbolMapping[cost.currency as keyof typeof currencySymbolMapping] ?? `${cost.currency} `;
    return `${symbol}${cost.value.toFixed(cost.value > 0 && cost.value < 0.01 ? 3 : 2)}`;
}

// ---- New scratch query

/** The Project a new scratch query goes to: that of the file in the editor, else the active one, else the one picked */
async function projectForNew(): Promise<ProjectState | undefined> {
    const active = vscode.window.activeTextEditor?.document;
    const ofFile = active?.uri.scheme === 'file' ? projectOf(active.uri.fsPath) : undefined;
    const project = ofFile ?? projects.active ?? (projects.projects.length === 1 ? projects.projects[0] : undefined);
    if (project || projects.projects.length === 0) {
        return project;
    }
    const picked = await vscode.window.showQuickPick(
        projects.projects.map((each) => ({ label: path.basename(each.root), description: `${each.backend} · ${each.root}`, project: each })),
        { placeHolder: 'The project to keep the scratch query in' },
    );
    return picked?.project;
}

/**
 * Makes a scratch query in the Project at `root` and opens it: the header, a note in it when there is one, then
 * `body`. The cursor goes where the body starts.
 */
async function openNewScratchQuery(root: string, body = '', note?: string, viewColumn?: vscode.ViewColumn) {
    const folder = path.join(root, ...SCRATCH_FOLDER.split('/'));
    await fs.promises.mkdir(folder, { recursive: true });
    // The folder ignores what is in it, so that the Project's own .gitignore is left alone
    const gitignore = path.join(folder, '.gitignore');
    if (!fs.existsSync(gitignore)) {
        await fs.promises.writeFile(gitignore, '*\n');
    }
    const file = path.join(folder, scratchFileName(new Date(), await fs.promises.readdir(folder)));
    const header = scratchHeaderText(process.platform === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter', note);
    await fs.promises.writeFile(file, header + body);
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { viewColumn, preview: false });
    const start = editor.document.positionAt(header.length);
    editor.selection = new vscode.Selection(start, start);
}

async function newScratchQuery() {
    const project = await projectForNew();
    if (!project) {
        if (projects.projects.length === 0) {
            vscode.window.showWarningMessage('A scratch query is kept in a Dataform or dbt project, and this window has none.');
        }
        return;
    }
    // From a file that builds a table, the query can start from it
    const ofFile = tablesOfActiveFile();
    if ('tables' in ofFile && ofFile.project.root === project.root) {
        const action = await pickTable(ofFile);
        if (action) {
            await makeScratchQueryOf(project.root, project, action.target, action, vscode.ViewColumn.Beside);
        }
        return;
    }
    await openNewScratchQuery(project.root);
}

/** The file in the editor and the actions it builds a table with, from its Project's last compile */
interface FileTables {
    project: ProjectState;
    fileName: string;
    tables: Action[];
}

/** The tables the file in the editor builds, else why it has none to query */
function tablesOfActiveFile(): FileTables | { reason: string } {
    const document = vscode.window.activeTextEditor?.document;
    const project = document?.uri.scheme === 'file' && !isScratchDocument(document) ? projectOf(document.uri.fsPath) : undefined;
    if (!document || !project) {
        return { reason: 'Open a file of a Dataform or dbt project to query the table it builds.' };
    }
    const graph = graphOf(project);
    if (!graph) {
        return { reason: `The project at ${project.root} has not compiled yet: there is no table to query.` };
    }
    const fileName = path.basename(document.uri.fsPath);
    const tables = actionsInFile(graph, slashPath(path.relative(project.root, document.uri.fsPath))).filter(buildsTable);
    return tables.length ? { project, fileName, tables } : { reason: `${fileName} builds no table to query.` };
}

/** One of the file's tables: the only one, else the one picked. Undefined when the pick is cancelled */
async function pickTable({ fileName, tables }: FileTables): Promise<Action | undefined> {
    if (tables.length === 1) {
        return tables[0];
    }
    const picked = await vscode.window.showQuickPick(
        tables.map((action) => ({ label: action.target.name, description: `${action.target.database}.${action.target.schema}`, detail: action.kind, action })),
        { placeHolder: `The table of ${fileName} to query`, matchOnDescription: true },
    );
    return picked?.action;
}

/** What a scratch query made from a table starts with */
type ScratchStart = 'compiled' | 'select';

/**
 * Asks whether a scratch query made from the table starts with the compiled SQL of the action that builds it, or
 * with a SELECT of its columns. Only the SELECT is there to start with when the last compile has no query of the
 * action to preview: a seed, a declaration, a dbt Project that was only parsed. Undefined when the user cancels.
 */
async function askScratchStart(target: Target, action: Action | undefined): Promise<ScratchStart | undefined> {
    if (!action?.sqlPresent || previewSection(action) === undefined) {
        return 'select';
    }
    const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { start: ScratchStart }>(
        [
            // First, so that it is what Enter chooses
            { label: '$(list-flat) SELECT its columns', detail: 'The columns of the table it built, one to a line. Needs that table to exist.', start: 'select' },
            { label: '$(code) Compiled SQL', detail: `The query of ${target.name} as it runs.`, start: 'compiled' },
        ],
        { title: `New scratch query from ${target.name}`, placeHolder: 'Start it with' },
    );
    return picked?.start;
}

/**
 * The compiled SQL of the action as a preview runs it, and the note that says what it is. A Dataform action's reads
 * the Deferred Actions from prod, as the panel's preview does; a dbt model's was compiled deferred already.
 */
async function compiledSqlOf(project: ProjectState, action: Action): Promise<{ sql: string; note: string } | undefined> {
    const section = previewSection(action);
    const name = `${action.target.database}.${action.target.schema}.${action.target.name}`;
    if (!section) {
        return undefined;
    }
    if (project.backend === 'dbt') {
        const sql = previewQuery(action, section)?.sql;
        return sql ? { sql, note: compiledQueryNote(name, 0) } : undefined;
    }
    const graph = graphOf(project);
    const compiled = compiledJson(project.root);
    const preview = graph && compiled ? await dataformPreviewQuery(graph, compiled, project.root, action, section) : undefined;
    return preview && { sql: preview.query, note: compiledQueryNote(name, countDeferred(preview.deferral)) };
}

/**
 * Makes a scratch query of the Project at `root` from the table, starting as the user chooses: with the compiled SQL
 * of `action`, or selecting the table's columns as BigQuery has them now, else `*` with a note of why.
 */
async function makeScratchQueryOf(root: string, project: ProjectState | undefined, target: Target, action: Action | undefined, viewColumn: vscode.ViewColumn) {
    const start = await askScratchStart(target, action);
    if (!start) {
        return;
    }
    if (start === 'compiled') {
        const compiled = project && action ? await compiledSqlOf(project, action) : undefined;
        if (!compiled) {
            vscode.window.showWarningMessage(`There is no compiled query of ${target.name} to start from.`);
            return;
        }
        await openNewScratchQuery(root, compiled.sql.replace(/\n*$/, '\n'), compiled.note, viewColumn);
        return;
    }
    const name = `${target.database}.${target.schema}.${target.name}`;
    let columns: string[] = [];
    let note: string | undefined;
    try {
        const metadata = await fetchTableMetadata(target.database, target.schema, target.name);
        columns = (metadata?.schema?.fields ?? []).map((field: { name: string }) => field.name);
    } catch (error: any) {
        note = `Could not read the columns of ${name}: ${error?.message ?? error}`;
    }
    await openNewScratchQuery(root, tableQueryText(name, columns), note, viewColumn);
}

/**
 * Makes a scratch query from a table, which starts with its compiled SQL or a SELECT of its columns. The compiled
 * query panel calls it for the Target of its file's action, and the query opens beside the panel; from the palette it
 * is the table of the file in the editor, and opens beside that file.
 */
async function queryTableInScratch(given?: Target, givenRoot?: string) {
    if (given?.database && given.schema && given.name && givenRoot) {
        const project = projects.projects.find((each) => each.root === givenRoot) as ProjectState | undefined;
        await makeScratchQueryOf(givenRoot, project, given, graphOf(project)?.actions[targetId(given)], vscode.ViewColumn.One);
        return;
    }
    const ofFile = tablesOfActiveFile();
    if (!('tables' in ofFile)) {
        vscode.window.showWarningMessage(ofFile.reason);
        return;
    }
    const action = await pickTable(ofFile);
    if (action) {
        await makeScratchQueryOf(ofFile.project.root, ofFile.project, action.target, action, vscode.ViewColumn.Beside);
    }
}

// ---- Run

/**
 * Runs the scratch query in the editor, in the results view: the selection, or the whole file when nothing is
 * selected. What is about to run is dry-run first, to ask before it changes data or scans a lot.
 */
export async function runScratchQuery(editor: vscode.TextEditor, queryResultsViewProvider: CustomViewProvider) {
    const document = editor.document;
    const query = (editor.selection.isEmpty ? document.getText() : document.getText(editor.selection)).trim();
    if (!hasStatement(query)) {
        vscode.window.showWarningMessage('No query to run');
        return;
    }
    const place = placeOf(document.uri.fsPath);
    const dryRun = await queryDryRun(query, false, place);
    // A query the dry run rejects is run all the same: the results view then shows BigQuery's error
    if (!dryRun.error?.hasError) {
        const question = runConfirmation(
            { statementType: dryRun.statistics?.statementType, bytes: dryRun.statistics?.totalBytesProcessed ?? 0, cost: costText(dryRun) },
            thresholds().confirmGiB,
        );
        if (question && await vscode.window.showWarningMessage(question, { modal: true }, 'Run') !== 'Run') {
            return;
        }
    }
    await runQueryInPanel({ query, type: 'table', place }, queryResultsViewProvider);
}

// ---- Dry run on save: status bar and diagnostics

let statusBarItem: vscode.StatusBarItem;
let diagnostics: vscode.DiagnosticCollection;
/** The last dry run of each scratch query, by the file's path. `undefined` while one is running for the first time */
const dryRuns = new Map<string, BigQueryDryRunResponse | undefined>();
/** Counts the dry runs asked for of each file, so that the answer to an earlier one is dropped */
const dryRunAsked = new Map<string, number>();

function showStatus() {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || !isScratchDocument(document)) {
        statusBarItem.hide();
        return;
    }
    const key = document.uri.fsPath;
    const dryRun = dryRuns.get(key);
    statusBarItem.backgroundColor = undefined;
    if (!dryRuns.has(key)) {
        statusBarItem.text = '$(database) Scratch query';
        statusBarItem.tooltip = 'The scratch query is dry-run when it is saved: what it would scan and cost shows here.';
    } else if (!dryRun) {
        statusBarItem.text = '$(sync~spin) Dry run';
        statusBarItem.tooltip = 'Asking BigQuery what the scratch query would scan.';
    } else if (dryRun.error?.hasError) {
        const at = dryRun.error.location?.line ? ` (line ${dryRun.error.location.line}, column ${dryRun.error.location.column})` : '';
        statusBarItem.text = '$(error) SQL error';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        statusBarItem.tooltip = `${dryRun.error.message}${at}`;
    } else {
        const { warnGiB, confirmGiB } = thresholds();
        const bytes = dryRun.statistics?.totalBytesProcessed ?? 0;
        const level = scanLevel(bytes, warnGiB, confirmGiB);
        const unknown = dryRun.statistics?.bytesEstimateUnknown;
        const cost = costText(dryRun);
        statusBarItem.text = unknown
            ? '$(warning) Bytes unknown'
            : `${level === 'plain' ? '$(database)' : '$(warning)'} ${formatBytes(bytes)}${cost ? ` · ${cost}` : ''}`;
        if (level !== 'plain') {
            statusBarItem.backgroundColor = new vscode.ThemeColor(level === 'confirm' ? 'statusBarItem.errorBackground' : 'statusBarItem.warningBackground');
        }
        const lines = [
            unknown ? 'BigQuery could not tell what this query scans before running it.' : `This query will scan ${formatBytes(bytes)}${cost ? `, about ${cost}` : ''}.`,
            dryRun.statistics?.statementType ? `Statement: ${dryRun.statistics.statementType.replace(/_/g, ' ')}` : '',
            dryRun.location ? `Location: ${dryRun.location}` : '',
            level === 'confirm' ? `Above ${confirmGiB} GiB: you are asked before it runs.` : level === 'warn' ? `At or above ${warnGiB} GiB.` : '',
        ];
        statusBarItem.tooltip = lines.filter(Boolean).join('\n');
    }
    statusBarItem.show();
}

function showDiagnostics(document: vscode.TextDocument, dryRun: BigQueryDryRunResponse) {
    if (!dryRun.error?.hasError) {
        diagnostics.delete(document.uri);
        return;
    }
    // BigQuery counts lines and columns from 1, and gives none for an error that is not at a place in the text
    const line = Math.min(Math.max((dryRun.error.location?.line ?? 1) - 1, 0), Math.max(document.lineCount - 1, 0));
    const column = Math.max((dryRun.error.location?.column ?? 1) - 1, 0);
    const start = new vscode.Position(line, Math.min(column, document.lineAt(line).text.length));
    const range = document.getWordRangeAtPosition(start) ?? new vscode.Range(start, document.lineAt(line).range.end);
    const diagnostic = new vscode.Diagnostic(range, dryRun.error.message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'BigQuery dry run';
    diagnostics.set(document.uri, [diagnostic]);
}

async function dryRunScratch(document: vscode.TextDocument) {
    const key = document.uri.fsPath;
    const asked = (dryRunAsked.get(key) ?? 0) + 1;
    dryRunAsked.set(key, asked);
    const query = document.getText();
    // A file of comments alone has nothing to dry-run, and is no error
    if (!hasStatement(query)) {
        dryRuns.delete(key);
        diagnostics.delete(document.uri);
        showStatus();
        return;
    }
    if (!dryRuns.get(key)) {
        dryRuns.set(key, undefined);
        showStatus();
    }
    let dryRun: BigQueryDryRunResponse;
    try {
        dryRun = await queryDryRun(query, false, placeOf(key));
    } catch (error: any) {
        dryRun = { error: { hasError: true, message: error?.message ?? String(error) } };
    }
    if (dryRunAsked.get(key) !== asked) {
        return;
    }
    dryRuns.set(key, dryRun);
    showDiagnostics(document, dryRun);
    showStatus();
}

// ---- Completion: the Project's tables, and the columns of the tables the query names

interface Column {
    /** As BigQuery gave it, with its mode and its fields when it is a STRUCT */
    field: ColumnMetadata;
    table: TableName;
}

/** The columns of the tables each scratch query names, by the file's path and then by the table's name */
const columnsOfFile = new Map<string, Map<string, Promise<Column[]>>>();

async function fetchColumns(table: TableName, place: JobPlace): Promise<Column[]> {
    try {
        const client = await getBigQueryClientFor(place);
        if (!client) {
            return [];
        }
        const dataset = table.projectId ? client.dataset(table.datasetId, { projectId: table.projectId }) : client.dataset(table.datasetId);
        const [metadata] = await dataset.table(table.tableId).getMetadata();
        return (metadata?.schema?.fields ?? []).map((field: ColumnMetadata) => ({ field, table }));
    } catch (error: any) {
        // A CTE or an alias with a dot, a table that is not there, or one that cannot be read: it has no columns to offer
        logger.debug(`Scratch query: no columns for ${tableNameText(table)}: ${error?.message ?? error}`);
        return [];
    }
}

/**
 * Asks BigQuery for the columns of the tables the scratch query names. `again` asks for all of them afresh, as a
 * save does; otherwise only for the tables named since the last time.
 */
function readColumns(document: vscode.TextDocument, again: boolean) {
    const key = document.uri.fsPath;
    const before = again ? undefined : columnsOfFile.get(key);
    const now = new Map<string, Promise<Column[]>>();
    const place = placeOf(key);
    for (const table of tableNamesIn(document.getText())) {
        const name = tableNameText(table).toLowerCase();
        now.set(name, before?.get(name) ?? fetchColumns(table, place));
    }
    columnsOfFile.set(key, now);
    return now;
}

class ScratchCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line).text;
        const prefix = tableNamePrefix(line.slice(0, position.character));
        const start = position.translate(0, -prefix.text.length);
        const items: vscode.CompletionItem[] = [];
        const graph = graphOf(projectOf(document.uri.fsPath));

        // After a dot: the columns of the table an alias names, or the fields of a STRUCT column. A dataset or a
        // project of a table name is not one of them
        const dotted = prefix.text.startsWith('`') ? undefined : dottedNameBefore(line.slice(0, position.character));
        if (dotted) {
            const tables = await columnTables(document);
            const first = dotted.qualifiers[0].toLowerCase();
            const namesTable = tables.some((table) => table.names.some((name) => name.toLowerCase() === first));
            if (namesTable || !namesDatasetOrProject(first, document.getText(), graph)) {
                const choices = columnsAfterDots(dotted.qualifiers, tables);
                if (choices) {
                    const range = new vscode.Range(position.translate(0, -dotted.word.length), position);
                    return choices.map((choice) => columnCompletionItem(choice, range));
                }
            }
        }

        // A closing backtick the editor wrote after the cursor is replaced with the name, which has its own
        const closed = prefix.text.startsWith('`') && line[position.character] === '`';
        const tableRange = new vscode.Range(start, closed ? position.translate(0, 1) : position);
        for (const action of Object.values(graph?.actions ?? {})) {
            if (!kindHasTable(action.kind) || !action.target.database) {
                continue;
            }
            const name = `${action.target.database}.${action.target.schema}.${action.target.name}`;
            const item = new vscode.CompletionItem({ label: action.target.name, description: `${action.target.database}.${action.target.schema}` }, vscode.CompletionItemKind.Struct);
            item.insertText = `\`${name}\``;
            item.filterText = prefix.text.startsWith('`') ? `\`${name}` : name;
            item.range = tableRange;
            item.detail = `${name} (${action.kind})`;
            item.sortText = `1${action.target.name}`;
            if (action.description) {
                item.documentation = new vscode.MarkdownString(action.description);
            }
            items.push(item);
        }
        if (prefix.inTableName) {
            return items;
        }

        const range = new vscode.Range(start, position);
        for (const table of await columnTables(document)) {
            items.push(...table.fields.map((field) => columnCompletionItem({ field, table: table.table }, range)));
        }
        return items;
    }
}

/**
 * The columns of the tables the scratch query names so far, with the names it qualifies each with. Those of a table
 * named just now are asked for, and offered the next time
 */
async function columnTables(document: vscode.TextDocument): Promise<ColumnTable[]> {
    const read = readColumns(document, false);
    const settled = await Promise.all([...read.values()].map((columns) => Promise.race([columns, new Promise<undefined>((resolve) => setTimeout(resolve, 150))])));
    const aliases = tableAliasesIn(document.getText());
    return settled.flatMap((columns) => {
        const table = columns?.[0]?.table;
        if (!table) {
            return [];
        }
        const text = tableNameText(table).toLowerCase();
        const names = [table.tableId, ...aliases.filter((each) => tableNameText(each.table).toLowerCase() === text).map((each) => each.alias)];
        return [{ table: table.tableId, names, fields: columns.map((column) => column.field) }];
    });
}

/** Whether `name` is a dataset or a project that a table of the query or of the Project is in */
function namesDatasetOrProject(name: string, sql: string, graph: ReturnType<typeof graphOf>): boolean {
    const named = tableNamesIn(sql).some((table) => [table.datasetId, table.projectId].some((part) => part?.toLowerCase() === name));
    return named || Object.values(graph?.actions ?? {}).some((action) => [action.target.schema, action.target.database].some((part) => part?.toLowerCase() === name));
}

// ---- Hover of a table name, and copying a table's column names

/** The Target a table name in the scratch query at `filePath` stands for. A name without a project is in the project its jobs run in */
async function targetOf(table: TableName, filePath: string): Promise<Target> {
    const place = placeOf(filePath);
    const database = table.projectId ?? place.projectId ?? (await getBigQueryClientFor(place))?.projectId ?? '';
    return { database, schema: table.datasetId, name: table.tableId };
}

function tableAt(document: vscode.TextDocument, position: vscode.Position) {
    const offset = document.offsetAt(position);
    return tableNamesAt(document.getText()).find((each) => each.start <= offset && offset <= each.end);
}

/** The hover a table has in a file of the Project: what the Project says of it when it is one of its Actions, and what BigQuery has */
class ScratchHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
        const named = tableAt(document, position);
        if (!named) {
            return undefined;
        }
        const target = await targetOf(named.table, document.uri.fsPath);
        if (!target.database) {
            return undefined;
        }
        const action = graphOf(projectOf(document.uri.fsPath))?.actions[targetId(target)];
        const table = await fetchTableMetadata(target.database, target.schema, target.name).then(tableOfMetadata, tableOfError);
        const range = new vscode.Range(document.positionAt(named.start), document.positionAt(named.end));
        return new vscode.Hover(tableHoverMarkdown(tableHoverText(action ?? { target }, table, formatTimestamp)), range);
    }
}

/**
 * Copies the column names of a table, one to a line with commas, to paste into a query. The table is the one given (by
 * the link of a hover), else the one the cursor is on in a scratch query, else one picked from the Project's.
 */
async function copyTableColumns(given?: Target) {
    let target = given?.database && given.schema && given.name ? given : undefined;
    const editor = vscode.window.activeTextEditor;
    if (!target && editor && isScratchDocument(editor.document)) {
        const named = tableAt(editor.document, editor.selection.active);
        target = named && await targetOf(named.table, editor.document.uri.fsPath);
    }
    if (!target) {
        const project = (editor?.document.uri.scheme === 'file' ? projectOf(editor.document.uri.fsPath) : undefined) ?? projects.active;
        const tables = Object.values(graphOf(project)?.actions ?? {}).filter((action) => kindHasTable(action.kind) && action.target.database);
        if (tables.length === 0) {
            vscode.window.showWarningMessage('There is no table to copy the column names of: put the cursor on a table name in a scratch query, or open a file of a compiled project.');
            return;
        }
        const picked = await vscode.window.showQuickPick(
            tables.map((action) => ({ label: action.target.name, description: `${action.target.database}.${action.target.schema}`, detail: action.kind, target: action.target })),
            { placeHolder: 'The table to copy the column names of', matchOnDescription: true },
        );
        target = picked?.target;
    }
    if (!target?.database) {
        return;
    }
    const name = `${target.database}.${target.schema}.${target.name}`;
    try {
        const metadata = await fetchTableMetadata(target.database, target.schema, target.name);
        const fields: { name: string }[] = metadata?.schema?.fields ?? [];
        if (fields.length === 0) {
            vscode.window.showWarningMessage(`${name} has no columns to copy.`);
            return;
        }
        await vscode.env.clipboard.writeText(columnNamesText(fields));
        vscode.window.setStatusBarMessage(`$(check) Copied ${fields.length} column name${fields.length === 1 ? '' : 's'} of ${target.name}`, 4000);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Could not read the columns of ${name}: ${error?.message ?? error}`);
    }
}

// ---- Wiring

function onShown(editor: vscode.TextEditor | undefined) {
    const scratch = isScratchDocument(editor?.document);
    void vscode.commands.executeCommand('setContext', 'vscode-dataform-tools.scratchQuery', scratch);
    if (scratch && editor) {
        const key = editor.document.uri.fsPath;
        // A scratch query opened from before has the same help as one just saved
        if (!dryRuns.has(key) && hasStatement(editor.document.getText())) {
            void dryRunScratch(editor.document);
        }
        if (!columnsOfFile.has(key)) {
            readColumns(editor.document, true);
        }
    }
    showStatus();
}

export function initScratchQueries(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 48);
    statusBarItem.name = 'Scratch query dry run';
    diagnostics = vscode.languages.createDiagnosticCollection('bigquery-scratch-query');
    context.subscriptions.push(
        statusBarItem,
        diagnostics,
        vscode.commands.registerCommand('vscode-dataform-tools.newScratchQuery', newScratchQuery),
        vscode.commands.registerCommand('vscode-dataform-tools.copyTableColumns', copyTableColumns),
        vscode.commands.registerCommand('vscode-dataform-tools.queryTableInScratch', queryTableInScratch),
        vscode.languages.registerCompletionItemProvider(SCRATCH_SELECTOR, new ScratchCompletionProvider(), '`', '.'),
        vscode.languages.registerHoverProvider(SCRATCH_SELECTOR, new ScratchHoverProvider()),
        vscode.window.onDidChangeActiveTextEditor(onShown),
        vscode.workspace.onDidSaveTextDocument((document) => {
            if (isScratchDocument(document)) {
                void dryRunScratch(document);
                readColumns(document, true);
            }
        }),
        vscode.workspace.onDidCloseTextDocument((document) => {
            if (isScratchDocument(document)) {
                const key = document.uri.fsPath;
                dryRuns.delete(key);
                dryRunAsked.delete(key);
                columnsOfFile.delete(key);
                diagnostics.delete(document.uri);
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.scratchQueryWarnScanGiB') || event.affectsConfiguration('vscode-dataform-tools.scratchQueryConfirmScanGiB')) {
                showStatus();
            }
        }),
    );
    onShown(vscode.window.activeTextEditor);
}
