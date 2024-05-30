
import * as vscode from 'vscode';

// Implementing the feature to sync scroll between main editor and vertical split editors
// BUG: git hunks start syncing as well !
export const editorSyncDisposable = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
    let splitEditors = vscode.window.visibleTextEditors;
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        splitEditors.forEach((editor) => {
            if (editor !== activeEditor) {
                editor.revealRange(activeEditor.visibleRanges[0]);
            }
        });
    }
});
