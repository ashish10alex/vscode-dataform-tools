import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import type { CompileError } from '../backend';
import { placeDbtError } from '../backend/dbt/place';
import { dbtCompileState, onDidChangeDbtCompile } from './dbtCompile';

/*
 * dbt's compile errors in the editor (xf#65). An error is marked in its source file only where its position is real
 * (see place.ts); the panel shows them all. The markers of a Project are cleared when its next compile starts.
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

function update(root: string) {
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
    context.subscriptions.push(collection, onDidChangeDbtCompile(update));
}
