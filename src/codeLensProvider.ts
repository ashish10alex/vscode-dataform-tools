import * as vscode from 'vscode';

export class AssertionRunnerCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    
    // Scan the document for test functions
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.includes('assertions')) {
        const range = new vscode.Range(i, 0, i, 0);
        const codeLens = new vscode.CodeLens(range, {
          title: '▶ Run assertions',
          command: 'vscode-dataform-tools.runAssertions',
          arguments: [document.uri, i]
        });
        codeLenses.push(codeLens);
      }
    }
    
    return codeLenses;
  }
}