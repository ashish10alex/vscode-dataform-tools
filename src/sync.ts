
import * as vscode from 'vscode';
import { compiledSqlFilePath } from './constants';

// Implementing the feature to sync scroll between main editor and vertical split editors
export const editorSyncDisposable = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
    let splitEditors = vscode.window.visibleTextEditors;
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        splitEditors.forEach((editor) => {
            if (editor !== activeEditor && editor.document.fileName === compiledSqlFilePath) {
                editor.revealRange(activeEditor.visibleRanges[0]);
            }
        });
    }
});
