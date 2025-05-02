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
        const wordRegex = new RegExp(`\\b${oldName}\\b`, 'g');
        for (let line = 0; line < document.lineCount; line++) {
          const lineText = document.lineAt(line).text;
          let match;
          while ((match = wordRegex.exec(lineText)) !== null) {
            const range = new vscode.Range(
              new vscode.Position(line, match.index),
              new vscode.Position(line, match.index + oldName.length)
            );
            edit.replace(document.uri, range, newName);
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
