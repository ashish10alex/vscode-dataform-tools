import * as vscode from 'vscode';
import { logger } from '../logger';
import { getMetadataForSqlxFileBlocks } from '../sqlxFileParser';
import { GraphAction, indexGraph, targetFqn } from '../shared/columnLineage/graphLinks';
import { ColumnLink, TraceFocus } from '../shared/columnLineage/types';
import { DataplexTraceSource } from './dataplexSource';
import { ColumnImpact, SchemaField, diffSchemas, findSelectAlias, findTopLevelSelect, impactMessage } from './impactRules';
import { indexByProdTarget } from './prodIndex';
import { SchemaCache } from './schemaCache';

/*
 * After a dry run, compares the query's schema with its Prod Target's and warns about dropped or retyped
 * columns that Dataplex lineage shows are still read downstream. Runs in the background so the dry run isn't
 * slowed down, and writes to its own diagnostic collection.
 */

export const IMPACT_CODE = 'column-impact';
const DIAGNOSTIC_SOURCE = 'Dataform Tools · column lineage';
/** Prod schemas are re-read after this, so a save soon after a prod run sees the new columns */
const PROD_SCHEMA_TTL_MS = 2 * 60 * 1000;
/** Lineage only changes when jobs run (and is ingested about two hours later), so keep lookups for a while */
const LINKS_TTL_MS = 10 * 60 * 1000;
const SETUP_DOCS = 'https://cloud.google.com/dataplex/docs/use-lineage';

export interface ImpactPayload {
    focus: TraceFocus;
    schemas: SchemaCache;
    index: Map<string, GraphAction>;
}

let collection: vscode.DiagnosticCollection | undefined;
/** Set when the Data Lineage API is off or not permitted; checks stop for the session */
let unavailable = false;
const generations = new Map<string, number>();
const payloads = new Map<string, { message: string; line: number; payload: ImpactPayload }[]>();
const reruns = new Map<string, () => Promise<void>>();
let schemaCache: { cache: SchemaCache; createdAt: number } | undefined;
const linkCache = new Map<string, { fetchedAt: number; links: Promise<ColumnLink[]> }>();

export function initColumnImpact(context: vscode.ExtensionContext) {
    collection = vscode.languages.createDiagnosticCollection('dataformColumnLineage');
    context.subscriptions.push(
        collection,
        vscode.workspace.onDidCloseTextDocument((document) => clearColumnImpact(document.uri)),
    );
}

/** The trace target behind a diagnostic. Code action providers get copies of diagnostics, so match on text and line. */
export function impactPayload(uri: vscode.Uri, diagnostic: vscode.Diagnostic): ImpactPayload | undefined {
    return payloads.get(uri.toString())?.find((entry) => entry.message === diagnostic.message && entry.line === diagnostic.range.start.line)?.payload;
}

export function clearColumnImpact(uri: vscode.Uri) {
    const key = uri.toString();
    generations.set(key, (generations.get(key) ?? 0) + 1);
    payloads.delete(key);
    collection?.delete(uri);
}

/** Forgets cached schemas and lineage, then checks the file again with its last dry-run schema */
export async function refreshColumnImpact(uri: vscode.Uri) {
    linkCache.clear();
    schemaCache = undefined;
    await reruns.get(uri.toString())?.();
}

function isEnabled(uri: vscode.Uri): boolean {
    return !unavailable && vscode.workspace.getConfiguration('vscode-dataform-tools', uri).get<boolean>('columnImpactCheck', true);
}

function schemas(): SchemaCache {
    if (!schemaCache || Date.now() - schemaCache.createdAt > PROD_SCHEMA_TTL_MS) {
        schemaCache = { cache: new SchemaCache(), createdAt: Date.now() };
    }
    return schemaCache.cache;
}

function readersOf(source: DataplexTraceSource, table: string, column: string): Promise<ColumnLink[]> {
    const key = `${table}#${column.toLowerCase()}`;
    const cached = linkCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < LINKS_TTL_MS) {
        return cached.links;
    }
    const links = source.links(table, column, 'downstream');
    linkCache.set(key, { fetchedAt: Date.now(), links });
    links.catch(() => linkCache.delete(key));
    return links;
}

/** The main SQL block's text and where it starts, so anchors skip the config block and pre_operations */
function sqlBlock(document: vscode.TextDocument): { text: string; offset: number; firstLine: number } {
    const block = getMetadataForSqlxFileBlocks(document).sqlBlock;
    const firstLine = block.exists ? Math.max(0, block.startLine - 1) : 0;
    const lastLine = block.exists ? Math.min(document.lineCount - 1, block.endLine) : document.lineCount - 1;
    const range = new vscode.Range(firstLine, 0, lastLine, document.lineAt(lastLine).text.length);
    return { text: document.getText(range), offset: document.offsetAt(range.start), firstLine };
}

/** A retyped column anchors on its alias; a dropped one (no longer in the SQL) on the top-level SELECT */
function anchor(document: vscode.TextDocument, sql: ReturnType<typeof sqlBlock>, impact: ColumnImpact): vscode.Range {
    const found = (impact.change.kind === 'typeChanged' ? findSelectAlias(sql.text, impact.column) : undefined)
        ?? findTopLevelSelect(sql.text);
    if (found) {
        return new vscode.Range(document.positionAt(sql.offset + found.start), document.positionAt(sql.offset + found.end));
    }
    return document.lineAt(sql.firstLine).range;
}

async function noticeUnavailable(reason: string) {
    const docs = 'Open setup docs';
    const off = "Don't check again";
    const choice = await vscode.window.showWarningMessage(`Column impact checks are off for this session. ${reason}`, docs, off);
    if (choice === docs) {
        void vscode.env.openExternal(vscode.Uri.parse(SETUP_DOCS));
    } else if (choice === off) {
        await vscode.workspace.getConfiguration('vscode-dataform-tools').update('columnImpactCheck', false, vscode.ConfigurationTarget.Global);
    }
}

/**
 * Checks one dry run. `curFileMeta` is the file metadata the dry run used; `devSchema` the schema it returned
 * (for an incremental table, the full-refresh query's).
 */
export async function checkColumnImpact(curFileMeta: any, document: vscode.TextDocument, devSchema: { fields?: SchemaField[] } | undefined): Promise<void> {
    const uri = document.uri;
    const key = uri.toString();
    const generation = (generations.get(key) ?? 0) + 1;
    generations.set(key, generation);
    reruns.set(key, () => checkColumnImpact(curFileMeta, document, devSchema));
    const stale = () => generations.get(key) !== generation;
    const clear = () => {
        payloads.delete(key);
        collection?.delete(uri);
    };

    const tables = curFileMeta?.fileMetadata?.tables ?? [];
    const action = tables[0];
    const devFields = (devSchema?.fields ?? []).filter((field) => field.name);
    if (!collection || !isEnabled(uri) || !document.fileName.endsWith('.sqlx') || tables.length !== 1
        || !['table', 'view', 'incremental'].includes(action?.type) || devFields.length === 0 || !CACHED_COMPILED_DATAFORM_JSON) {
        clear();
        return;
    }

    try {
        const { index, toProd } = await indexByProdTarget(indexGraph(CACHED_COMPILED_DATAFORM_JSON));
        const prodTable = toProd(targetFqn(action.target));
        const cache = schemas();
        const prodFields = await cache.schema(prodTable);
        if (stale()) {
            return;
        }
        const impacts = prodFields?.length ? diffSchemas(devFields, prodFields) : [];
        if (impacts.length === 0) {
            // In step with prod, or no prod table yet (a new action)
            clear();
            return;
        }

        const source = new DataplexTraceSource(cache, index);
        const results = await Promise.all(impacts.map(async (impact) => ({ impact, links: await readersOf(source, prodTable, impact.column) })));
        if (stale()) {
            return;
        }

        const sql = sqlBlock(document);
        const diagnostics: vscode.Diagnostic[] = [];
        const entries: { message: string; line: number; payload: ImpactPayload }[] = [];
        for (const { impact, links } of results) {
            const message = impactMessage(impact, links, prodTable);
            if (!message) {
                continue;
            }
            const diagnostic = new vscode.Diagnostic(anchor(document, sql, impact), message, vscode.DiagnosticSeverity.Warning);
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = IMPACT_CODE;
            diagnostics.push(diagnostic);
            entries.push({
                message,
                line: diagnostic.range.start.line,
                payload: { focus: { table: prodTable, column: impact.column, change: impact.change }, schemas: cache, index },
            });
        }
        payloads.set(key, entries);
        collection.set(uri, diagnostics);
    } catch (error: any) {
        if (stale()) {
            return;
        }
        clear();
        if (error?.code === 7 || error?.code === 16) {
            unavailable = true;
            void noticeUnavailable(error.message);
        } else {
            logger.error(`Column impact check failed: ${error?.message ?? error}`);
        }
    }
}

export function columnImpactCodeActions(): vscode.Disposable {
    return vscode.languages.registerCodeActionsProvider('sqlx', {
        provideCodeActions(document, _range, context) {
            const impacts = context.diagnostics.filter((diagnostic) => diagnostic.code === IMPACT_CODE);
            if (impacts.length === 0) {
                return;
            }
            const actions: vscode.CodeAction[] = [];
            for (const diagnostic of impacts) {
                const payload = impactPayload(document.uri, diagnostic);
                if (!payload) {
                    continue;
                }
                const action = new vscode.CodeAction(`Trace downstream readers of ${payload.focus.column}`, vscode.CodeActionKind.QuickFix);
                action.command = { command: 'vscode-dataform-tools.traceImpactedColumn', title: action.title, arguments: [payload] };
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                actions.push(action);
            }
            const refresh = new vscode.CodeAction('Refresh column lineage', vscode.CodeActionKind.QuickFix);
            refresh.command = { command: 'vscode-dataform-tools.refreshColumnImpact', title: refresh.title, arguments: [document.uri] };
            return [...actions, refresh];
        },
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] });
}
