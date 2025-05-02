import * as vscode from 'vscode';

export const renameProvider = vscode.languages.registerRenameProvider('sqlx', {
  provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    _: vscode.CancellationToken
      ) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
          return null;
        }
        const oldName = document.getText(wordRange);
        const edit = new vscode.WorkspaceEdit();

        // Find all occurrences in the document and replace
        for (let line = 0; line < document.lineCount; line++) {
          const lineText = document.lineAt(line).text;
          let idx = lineText.indexOf(oldName);
          while (idx !== -1) {
            const range = new vscode.Range(
              new vscode.Position(line, idx),
              new vscode.Position(line, idx + oldName.length)
            );
            edit.replace(document.uri, range, newName);
            idx = lineText.indexOf(oldName, idx + oldName.length);
          }
        }
        return edit;
      },
      prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        _: vscode.CancellationToken
      ) {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
          throw new Error('No symbol at cursor to rename');
        }
        return wordRange;
      }
    }
);
