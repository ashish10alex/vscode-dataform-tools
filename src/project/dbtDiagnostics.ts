import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { CompileError, Editor } from '../backend';
import { placeCompiledLine, placeDbtError } from '../backend/dbt/place';
import type { DryRunResult } from '../bigquery/dryRunService';
import { CompiledGraph, isTestKind } from '../shared/compiledGraph';
import { dbtAskedBigQuery, dbtDryRunResults, onDidDryRunDbt } from './dbtBigQuery';
import { dbtCompileState, onDidChangeDbtCompile } from './dbtCompile';
import { projects } from './index';

/*
 * dbt's compile errors in the editor (xf#65). An error is marked in its source file only where its position is real
 * (see place.ts); the panel shows them all. The markers of a Project are cleared when its next compile starts.
 *
 * BigQuery's dry-run errors are marked too (piece 7.9 of the build plan), in a collection of their own. Such an
 * error is placed in the compiled query, not in the source. Where its compiled line is one line of the source,
 * unchanged, it is marked there. Otherwise it is marked on the first line of the file, or for a generic test on the
 * line of the YAML file that declares it, and says where in the compiled query it is: every broken query shows in
 * its file, and the panel has the rest.
 */

const SOURCE = 'dbt compile';
let collection: vscode.DiagnosticCollection | undefined;
/** The files that have markers, by Project root */
const marked = new Map<string, vscode.Uri[]>();

function textOf(file: string): string | undefined {
    // What is in the editor, saved or not, is what the marker is drawn on
    const open = vscode.workspace.textDocuments.find((document) => document.uri.fsPath === file);
    if (open) {
        return open.getText();
    }
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

/** The markers for the errors of a compile, by file: only the errors that name a file and have a real position in it */
export function dbtDiagnostics(root: string, errors: CompileError[], read: (file: string) => string | undefined = textOf): Map<string, vscode.Diagnostic[]> {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const error of errors) {
        if (!error.fileName) {
            continue;
        }
        const file = path.join(root, error.fileName);
        const source = read(file);
        const place = source === undefined ? undefined : placeDbtError(error, source);
        if (!place) {
            continue;
        }
        const diagnostic = new vscode.Diagnostic(new vscode.Range(place.line, place.start, place.line, place.end), error.message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = SOURCE;
        if (error.code) {
            diagnostic.code = error.code;
        }
        byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
    }
    return byFile;
}

const DRY_RUN_SOURCE = 'BigQuery dry run';
let dryRunCollection: vscode.DiagnosticCollection | undefined;
const dryRunMarked = new Map<string, vscode.Uri[]>();

/** The markers for the dry-run errors of a compile, by file. `editor` says where a YAML file declares a test */
export function dbtDryRunDiagnostics(root: string, graph: CompiledGraph, results: DryRunResult[], editor: Pick<Editor, 'placeOf'> | undefined, read: (file: string) => string | undefined = textOf): Map<string, vscode.Diagnostic[]> {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const { action: id, error, sections } of results) {
        const action = graph.actions[id];
        if (!error || !action?.fileName) {
            continue;
        }
        const file = path.join(root, action.fileName);
        const source = read(file);
        if (source === undefined) {
            continue;
        }
        const lines = source.split('\n');
        const section = action.sections.find((each) => each.title === (error.section ?? sections[0]));
        const compiledLine = error.line === undefined ? undefined : section?.sql.split('\n')[error.line - 1];
        const yaml = /\.ya?ml$/i.test(action.fileName);
        // A file of generic tests has none of their SQL: no line of it is a line of a compiled query
        const exact = yaml ? undefined : placeCompiledLine(compiledLine, source);
        // A test's error is told apart from its model's, and from the other tests its file declares
        let message = isTestKind(action.kind) ? `${action.kind} ${action.target.name}: ${error.message}` : error.message;
        let range: vscode.Range;
        if (exact) {
            range = new vscode.Range(exact.line, exact.start, exact.line, exact.end);
        } else {
            const line = Math.min((yaml && editor?.placeOf(id)?.lineIn?.(source)) || 0, lines.length - 1);
            const text = (lines[line] ?? '').replace(/\r$/, '');
            range = new vscode.Range(line, text.length - text.trimStart().length, line, text.length);
            const where = error.line === undefined ? '' : ` at line ${error.line}${error.column === undefined ? '' : `, column ${error.column}`}`;
            message += `\n\nThe error is in the compiled query${where}. Open the Compiled Query panel to see it there.`;
        }
        const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = DRY_RUN_SOURCE;
        byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
    }
    return byFile;
}

function clearDryRunMarkers(root: string) {
    for (const uri of dryRunMarked.get(root) ?? []) {
        dryRunCollection?.delete(uri);
    }
    dryRunMarked.delete(root);
}

function updateDryRun(root: string) {
    clearDryRunMarkers(root);
    const project = projects.find(root, 'dbt');
    const graph = project?.dbtBackend?.lastResult?.graph;
    // Dry runs that failed for want of credentials say nothing of any file
    if (!dryRunCollection || !project || !graph || dbtCompileState(root).compiling || !dbtAskedBigQuery()) {
        return;
    }
    const uris: vscode.Uri[] = [];
    for (const [file, diagnostics] of dbtDryRunDiagnostics(root, graph, dbtDryRunResults(root, project.compileNumber), project.dbtBackend?.editor)) {
        const uri = vscode.Uri.file(file);
        dryRunCollection.set(uri, diagnostics);
        uris.push(uri);
    }
    if (uris.length > 0) {
        dryRunMarked.set(root, uris);
    }
}

function update(root: string) {
    // The start of a compile clears what BigQuery said of the last one's SQL; anything else leaves it as it is
    updateDryRun(root);
    if (!collection) {
        return;
    }
    const state = dbtCompileState(root);
    for (const uri of marked.get(root) ?? []) {
        collection.delete(uri);
    }
    marked.delete(root);
    if (state.compiling) {
        return;
    }
    const uris: vscode.Uri[] = [];
    for (const [file, diagnostics] of dbtDiagnostics(root, state.errors)) {
        const uri = vscode.Uri.file(file);
        collection.set(uri, diagnostics);
        uris.push(uri);
    }
    if (uris.length > 0) {
        marked.set(root, uris);
    }
}

export function initDbtDiagnostics(context: vscode.ExtensionContext) {
    collection = vscode.languages.createDiagnosticCollection('dbtCompile');
    dryRunCollection = vscode.languages.createDiagnosticCollection('dbtDryRun');
    context.subscriptions.push(collection, dryRunCollection, onDidChangeDbtCompile(update), onDidDryRunDbt(updateDryRun));
}
