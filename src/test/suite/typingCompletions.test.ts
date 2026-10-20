import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, test } from 'mocha';
import { tableCompletionItems } from '../../columnCompletionItem';
import { REF_TRIGGER_CHARACTERS } from '../../completions';

/*
 * Typing in an editor, key by key, and accepting the suggestion the list shows: VS Code opens no list as you type a
 * word that is a number, and asks only the providers of a trigger character again, so a list of tables has to stay
 * open as the digits of a name such as `0300_orders` are typed
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Types each key at the end of the document, then accepts the selected suggestion, if a list is open */
async function typeAndAccept(document: vscode.TextDocument, keys: string): Promise<string> {
    const editor = await vscode.window.showTextDocument(document);
    const end = document.positionAt(document.getText().length);
    editor.selection = new vscode.Selection(end, end);
    for (const key of keys) {
        await vscode.commands.executeCommand('type', { text: key });
        await wait(300);
    }
    await vscode.commands.executeCommand('acceptSelectedSuggestion');
    await wait(200);
    const text = document.getText();
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    return text;
}

suite('typing a table name that starts with digits', function () {
    this.timeout(15000);
    const sql = 'WITH step_0300 AS (SELECT 1)\nSELECT * FROM ';

    suiteSetup(async () => {
        await vscode.extensions.getExtension('ashishalex.dataform-lsp-vscode')?.activate();
    });

    test('after FROM in a .sqlx file the list of CTEs stays open', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'sqlx', content: sql });
        assert.ok((await typeAndAccept(document, '030')).endsWith('FROM step_0300'));
    });

    test('after FROM in a scratch query the list of tables stays open', async () => {
        const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-')), '.vscode-dataform-tools', 'tmp');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, 'typing.sql');
        fs.writeFileSync(file, sql);
        const document = await vscode.workspace.openTextDocument(file);
        assert.ok((await typeAndAccept(document, '030')).endsWith('FROM step_0300'));
    });

    test('after a $ the list of refs stays open', async () => {
        // The refs come from a compiled Project, which the tests have none of: a provider with the same trigger
        // characters as that of the refs stands in for it
        const refs = vscode.languages.registerCompletionItemProvider({ language: 'sqlx', scheme: 'untitled' }, {
            provideCompletionItems(document, position) {
                const typed = /\$(\w*)$/.exec(document.lineAt(position).text.slice(0, position.character));
                return typed ? tableCompletionItems(
                    [{ label: 'shop.0300_orders', alsoMatches: ['0300_orders'], kind: 'table', insertText: '${ref("0300_orders")}' }],
                    typed[1], new vscode.Range(position.translate(0, -typed[0].length), position), typed[0]) : undefined;
            },
        }, ...REF_TRIGGER_CHARACTERS);
        try {
            const document = await vscode.workspace.openTextDocument({ language: 'sqlx', content: 'SELECT * FROM ' });
            assert.strictEqual(await typeAndAccept(document, '$030'), 'SELECT * FROM ${ref("0300_orders")}');
        } finally {
            refs.dispose();
        }
    });
});
