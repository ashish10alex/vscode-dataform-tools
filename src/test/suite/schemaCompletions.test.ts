import * as assert from 'assert';
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
