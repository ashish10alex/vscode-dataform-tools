import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';

// The column names of the file's dependencies are offered in its SQL only, not in the blocks around it
suite('schema column completions', () => {
    const column = 'zz_dependency_column';
    let savedColumns: typeof schemaAutoCompletions;
    let document: vscode.TextDocument;

    const content = [
        'config {',                  // 0
        '  type: "table",',          // 1
        '  ',                        // 2: in the config block
        '}',                         // 3
        'js {',                      // 4
        '  const x = 1;',            // 5
        '  ',                        // 6: in the js block
        '}',                         // 7
        'pre_operations {',          // 8
        '  ',                        // 9: in pre_operations
        '}',                         // 10
        'SELECT',                    // 11
        '  ',                        // 12: in the SQL
        'FROM ${ref("orders")} ',    // 13: in the ${ } at 8, after it at 22
        'post_operations {',         // 14
        '  ',                        // 15: in post_operations
        '}',                         // 16
    ].join('\n');

    suiteSetup(async () => {
        document = await vscode.workspace.openTextDocument({ language: 'sqlx', content });
        // Opening a .sqlx file activates the extension, which registers the provider and clears the columns
        await vscode.extensions.getExtension('ashishalex.dataform-lsp-vscode')?.activate();
        savedColumns = schemaAutoCompletions;
        schemaAutoCompletions = [{ name: column, metadata: { type: 'STRING', description: '', fullTableId: 'p.d.orders' } }];
    });
    suiteTeardown(() => {
        schemaAutoCompletions = savedColumns;
    });

    async function offersColumn(line: number, character: number, doc = document): Promise<boolean> {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(line, character));
        return list.items.some(item => (typeof item.label === 'string' ? item.label : item.label.label) === column);
    }

    test('offers the columns in the SQL', async () => {
        assert.ok(await offersColumn(12, 2), 'expected the column in the SELECT');
        assert.ok(await offersColumn(13, 22), 'expected the column after the ${ }');
    });

    test('does not offer the columns in the config, js, pre_operations and post_operations blocks', async () => {
        assert.ok(!(await offersColumn(2, 2)), 'config block');
        assert.ok(!(await offersColumn(6, 2)), 'js block');
        assert.ok(!(await offersColumn(9, 2)), 'pre_operations block');
        assert.ok(!(await offersColumn(15, 2)), 'post_operations block');
    });

    test('does not offer the columns in a ${ }', async () => {
        assert.ok(!(await offersColumn(13, 8)), 'closed ${ }');
        const typing = await vscode.workspace.openTextDocument({ language: 'sqlx', content: 'SELECT 1 FROM ${ref("' });
        assert.ok(!(await offersColumn(0, 21, typing)), 'open ${');
    });

    test('offers the columns in the SQL string of a ${ }, also over several lines', async () => {
        const incremental = await vscode.workspace.openTextDocument({
            language: 'sqlx',
            content: 'SELECT * FROM ${ref("orders")}\n${when(incremental(), `WHERE  > (SELECT MAX(ts) FROM ${self()})`)}\n${when(incremental(),\n  `AND  IS NOT NULL`)}',
        });
        assert.ok(await offersColumn(1, 29, incremental), 'one line');
        assert.ok(!(await offersColumn(1, 60, incremental)), 'in the ${ } in the SQL string');
        assert.ok(await offersColumn(3, 7, incremental), 'over two lines');
        assert.ok(!(await offersColumn(3, 20, incremental)), 'after the string, before the }');
    });

    test('right after FROM or JOIN no column is offered, but the CTEs are', async () => {
        const query = await vscode.workspace.openTextDocument({ language: 'sqlx', content: 'WITH recent AS (SELECT 1)\nSELECT  FROM rec' });
        assert.ok(await offersColumn(1, 7, query), 'in the SELECT');
        assert.ok(!(await offersColumn(1, 16, query)), 'after FROM');
        const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', query.uri, new vscode.Position(1, 16));
        assert.ok(list.items.some((item) => typeof item.label !== 'string' && item.label.label === 'recent' && item.label.detail === ' cte'), 'the CTE');
    });

    test('a column of several tables is offered once, with its first description and each table in its details', async () => {
        const saved = schemaAutoCompletions;
        schemaAutoCompletions = [
            { name: column, metadata: { type: 'STRING', description: '', fullTableId: 'p.d.orders' } },
            { name: column.toUpperCase(), metadata: { type: 'STRING', description: 'The key', fullTableId: 'p.d.items' } },
        ];
        try {
            const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(12, 2));
            const found = list.items.filter((item) => typeof item.label !== 'string' && item.label.label.toLowerCase() === column);
            assert.strictEqual(found.length, 1);
            assert.deepStrictEqual(found[0].label, { label: column, detail: ' STRING', description: 'The key' });
            assert.strictEqual(found[0].documentation, 'The key\n\norders: no description\nitems');
        } finally {
            schemaAutoCompletions = saved;
        }
    });

    test('a SQL comment in the SQL string of a ${ } ends with the string', async () => {
        const commented = await vscode.workspace.openTextDocument({
            language: 'sqlx',
            content: 'SELECT * FROM ${ref("orders")}\n${when(incremental(), `AND ts > 0 -- new rows only`)} ',
        });
        const line = commented.lineAt(1).text;
        assert.ok(!(await offersColumn(1, line.length - 2, commented)), 'after the string, before the }');
        assert.ok(await offersColumn(1, line.length, commented), 'after the ${ }');
    });
});

// VS Code opens no list as you type a word that is a number, such as the `0400` of a table `0400_orders`: a digit opens
// the tables where a table goes, after FROM or JOIN, and no list elsewhere
suite('a digit typed where a table goes', () => {
    const sql = 'WITH step_1 AS (SELECT 1)\nSELECT 1 FROM 1 JOIN 1';

    // The command also asks the providers a digit does not open: VS Code's words of the document, which have a plain
    // label, and BigQuery's functions. The editor asks only those that a digit opens; ours label each table and column
    // with its details
    async function labelsOnDigit(uri: vscode.Uri, line: number, character: number): Promise<string[]> {
        const list = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider', uri, new vscode.Position(line, character), '1');
        return list.items.flatMap((item) => typeof item.label === 'string' || item.kind === vscode.CompletionItemKind.Function ? [] : [item.label.label]);
    }

    suiteSetup(async () => {
        await vscode.extensions.getExtension('ashishalex.dataform-lsp-vscode')?.activate();
    });

    test('in a .sqlx file: the CTEs after FROM and JOIN, nothing after SELECT', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'sqlx', content: sql });
        const saved = schemaAutoCompletions;
        schemaAutoCompletions = [{ name: 'zz_digit_column', metadata: { type: 'STRING', description: '', fullTableId: 'p.d.orders' } }];
        try {
            // The column is there to offer, as Ctrl+Space after SELECT shows
            const invoked = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(1, 8));
            assert.ok(invoked.items.some((item) => typeof item.label !== 'string' && item.label.label === 'zz_digit_column'), 'Ctrl+Space after SELECT');
            assert.deepStrictEqual(await labelsOnDigit(document.uri, 1, 8), [], 'a digit after SELECT');
            assert.ok((await labelsOnDigit(document.uri, 1, 15)).includes('step_1'), 'after FROM');
            assert.ok((await labelsOnDigit(document.uri, 1, 22)).includes('step_1'), 'after JOIN');
        } finally {
            schemaAutoCompletions = saved;
        }
    });

    test('in a scratch query: the CTEs after FROM and JOIN, nothing after SELECT', async () => {
        const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-')), '.vscode-dataform-tools', 'tmp');
        fs.mkdirSync(folder, { recursive: true });
        const file = path.join(folder, 'digit.sql');
        fs.writeFileSync(file, sql);
        const document = await vscode.workspace.openTextDocument(file);
        assert.deepStrictEqual(await labelsOnDigit(document.uri, 1, 8), [], 'after SELECT');
        assert.ok((await labelsOnDigit(document.uri, 1, 15)).includes('step_1'), 'after FROM');
        assert.ok((await labelsOnDigit(document.uri, 1, 22)).includes('step_1'), 'after JOIN');
    });
});
