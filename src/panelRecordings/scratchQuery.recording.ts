import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { SCRATCH_FOLDER } from '../scratch/scratchQuery';

/*
Scratch queries in the real extension, in src/test/test-workspace: making one, and the completion of the Project's
table names in it. Nothing here needs BigQuery: the dry run of a scratch query fails without credentials, which the
extension shows and the test does not look at.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('Scratch queries', () => {
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const extensionFolder = path.join(root, '.vscode-dataform-tools');
    const hadExtensionFolder = fs.existsSync(extensionFolder);
    /** The table of definitions/0100_CLUBS.sqlx as the completion writes it: `project.dataset.0100_CLUBS` in backticks */
    let clubsName = '';

    suiteSetup(async () => {
        await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
        // A file of the Project in the editor: the scratch query goes to its Project, which is compiled for the panel
        const model = await vscode.workspace.openTextDocument(path.join(root, 'definitions', '0100_CLUBS.sqlx'));
        await vscode.window.showTextDocument(model);
        await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryInWebView');
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(hadExtensionFolder ? path.join(root, ...SCRATCH_FOLDER.split('/')) : extensionFolder, { recursive: true, force: true });
    });

    test('the command makes a dated .sql file in a folder that ignores itself, and opens it', async () => {
        await vscode.commands.executeCommand('vscode-dataform-tools.newScratchQuery');
        const document = vscode.window.activeTextEditor!.document;
        const folder = path.join(root, ...SCRATCH_FOLDER.split('/'));
        assert.strictEqual(path.dirname(document.uri.fsPath), folder);
        assert.match(path.basename(document.uri.fsPath), /^scratch-\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.sql$/);
        assert.strictEqual(fs.readFileSync(path.join(folder, '.gitignore'), 'utf8'), '*\n');
        assert.match(document.getText(), /^-- Scratch query/);
    });

    test('a second one in the same minute is another file', async () => {
        const first = vscode.window.activeTextEditor!.document.uri.fsPath;
        await vscode.commands.executeCommand('vscode-dataform-tools.newScratchQuery');
        assert.notStrictEqual(vscode.window.activeTextEditor!.document.uri.fsPath, first);
    });

    test('the tables of the Project are offered after a backtick, by their full names', async () => {
        const editor = vscode.window.activeTextEditor!;
        const end = editor.document.positionAt(editor.document.getText().length);
        await editor.edit((edit) => edit.insert(end, 'SELECT * FROM `'));
        const position = editor.document.positionAt(editor.document.getText().length);

        // The tables come from the Project's compile, which may still be running
        let tables: vscode.CompletionItem[] = [];
        for (let waited = 0; waited < 90_000 && tables.length === 0; waited += 500) {
            const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', editor.document.uri, position, '`');
            tables = list.items.filter((item) => item.kind === vscode.CompletionItemKind.Struct);
            if (tables.length === 0) {
                await sleep(500);
            }
        }
        assert.ok(tables.length > 0, 'no table was offered');
        for (const table of tables) {
            assert.match(String(table.insertText), /^`[\w-]+\.[\w-]+\.[\w-]+`$/);
        }
        const clubs = tables.find((table) => /\.0100_CLUBS`$/.test(String(table.insertText)));
        assert.ok(clubs, `0100_CLUBS was not offered among ${tables.map((table) => table.insertText).join(', ')}`);
        clubsName = String(clubs.insertText);
    });

    test('a table name has the hover of a table of the Project, with the links to search and to copy its columns allowed', async () => {
        const editor = vscode.window.activeTextEditor!;
        const whole = new vscode.Range(new vscode.Position(0, 0), editor.document.positionAt(editor.document.getText().length));
        await editor.edit((edit) => edit.replace(whole, `SELECT *\nFROM ${clubsName}\n`));
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', editor.document.uri, new vscode.Position(1, 12));
        const markdown = hovers.flatMap((hover) => hover.contents).find((content): content is vscode.MarkdownString => content instanceof vscode.MarkdownString && content.value.includes('0100_CLUBS'));
        assert.ok(markdown, 'the table has no hover');
        // What the Project says of the table is there whether or not BigQuery could be asked
        assert.match(markdown.value, /\*\*Kind:\*\* view/);
        assert.deepStrictEqual((markdown.isTrusted as { enabledCommands: string[] }).enabledCommands, ['vscode-dataform-tools.searchTableColumns', 'vscode-dataform-tools.copyTableColumns']);
        // Nothing is hovered beside the name
        assert.deepStrictEqual(await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', editor.document.uri, new vscode.Position(0, 3)), []);
    });
});
