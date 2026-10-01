import * as vscode from 'vscode';
import { findConfigBlockRange } from './configBlock/parser';

/** Lines of the config block: `tags` or `assertions` in a query or comment elsewhere is not a config key */
function configBlockLines(document: vscode.TextDocument): { start: number; end: number } | undefined {
  const range = findConfigBlockRange(document.getText());
  return range && { start: document.positionAt(range.start).line, end: document.positionAt(range.end).line };
}

export class AssertionRunnerCodeLensProvider implements vscode.CodeLensProvider {
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const codeLenses: vscode.CodeLens[] = [];
    const assertionConfigTypeRegexExp = /type\s*:\s*(['"])assertion\1/;
    const assertionsKeyRegexExp = /\bassertions['"]?\s*:/;
    const lines = configBlockLines(document);
    if (!lines) {
      return codeLenses;
    }

    for (let i = lines.start; i <= lines.end; i++) {
      const line = document.lineAt(i);
      if (assertionsKeyRegexExp.test(line.text)) {
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
    const tagsKeyRegexExp = /\btags['"]?\s*:/;
    const lines = configBlockLines(document);
    if (!lines) {
      return codeLenses;
    }

    for (let i = lines.start; i <= lines.end; i++) {
      const line = document.lineAt(i);
      if (tagsKeyRegexExp.test(line.text)) {
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
