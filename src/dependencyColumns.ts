import * as vscode from 'vscode';
import type { SchemaMetadata } from './types';

/*
 * The columns of the tables a .sqlx file reads, kept for each document as the compiled query panel last fetched them.
 * Completions and the panel's column hover read them from here, so a file never shows the columns of another.
 */

const columnsOfDocument = new Map<string, SchemaMetadata[]>();

export function setDependencyColumns(uri: vscode.Uri, columns: SchemaMetadata[]) {
    columnsOfDocument.set(uri.toString(), columns);
}

export function forgetDependencyColumns(uri: vscode.Uri) {
    columnsOfDocument.delete(uri.toString());
}

/**
 * The columns of the document's dependencies. A file not compiled yet has none. A document never compiled that is no
 * file, such as an untitled one, has those of `schemaAutoCompletions`, which only the tests set.
 */
export function dependencyColumnsOf(uri: vscode.Uri): SchemaMetadata[] {
    return columnsOfDocument.get(uri.toString()) ?? (uri.scheme === 'file' ? [] : globalThis.schemaAutoCompletions ?? []);
}
