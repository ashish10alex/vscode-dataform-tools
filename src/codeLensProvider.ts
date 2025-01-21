import * as vscode from 'vscode';

export class AssertionRunnerCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const assertionConfigTypeRegexExp = /type\s*:\s*(['"])assertion\1/;

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
      } else if (assertionConfigTypeRegexExp.exec(line.text) !== null){
        const range = new vscode.Range(i, 0, i, 0);
        const codeLens = new vscode.CodeLens(range, {
          title: '▶ Run assertion',
          command: 'vscode-dataform-tools.runQuery',
          arguments: [document.uri, i]
        });
        codeLenses.push(codeLens);
      }
    }
    return codeLenses;
  }
}

export class TagsRunnerCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      if (line.text.includes('tags')) {
        const range = new vscode.Range(i, 0, i, 0);
        const codeLens = new vscode.CodeLens(range, {
          title: '▶ Run Tag',
          command: 'vscode-dataform-tools.runFilesTagsWtOptions',
          arguments: [document.uri, i]
        });
        codeLenses.push(codeLens);
      }
    }
    return codeLenses;
  }
}
