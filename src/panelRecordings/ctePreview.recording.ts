import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';

/*
Preview CTE in the real extension, in src/test/test-workspace: the CodeLens and light bulb on a .sqlx file, and the
query the command runs, from the Project's real compile. The query is caught before it is sent to BigQuery, so
nothing here needs credentials.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const COMMAND = 'vscode-dataform-tools.previewCte';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SQLX = `config {
  type: "table",
  description: "with nothing (select 1) is not a CTE"
}

pre_operations {
  DECLARE min_id INT64 DEFAULT 0;
}

WITH clubs AS (
  SELECT * FROM \${ref("0100_CLUBS")}
),
named AS (
  SELECT * FROM clubs WHERE id > min_id
)
SELECT * FROM (WITH inner_cte AS (SELECT 1 AS x) SELECT * FROM inner_cte), named
`;

suite('Preview CTE', () => {
    const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
    const file = path.join(root, 'definitions', '0900_CTE_PREVIEW.sqlx');
    let document: vscode.TextDocument;

    suiteSetup(async () => {
        fs.writeFileSync(file, SQLX);
        await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
        document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
    });

    suiteTeardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(file, { force: true });
    });

    /** Runs the command, catching the query it would run and any warning it shows */
    const run = async (...args: unknown[]) => {
        const commands = vscode.commands as { executeCommand: unknown };
        const window = vscode.window as { showWarningMessage: unknown };
        const execute = vscode.commands.executeCommand;
        const warn = vscode.window.showWarningMessage;
        const caught: { query?: string; type?: string; warning?: string } = {};
        commands.executeCommand = (command: string, ...rest: unknown[]) => {
            if (command === 'vscode-dataform-tools.runGeneratedQuery') {
                [caught.query, caught.type] = rest as string[];
                return Promise.resolve();
            }
            return execute(command, ...rest);
        };
        window.showWarningMessage = (message: string) => {
            caught.warning = message;
            return Promise.resolve(undefined);
        };
        try {
            await execute(COMMAND, ...args);
        } finally {
            commands.executeCommand = execute;
            window.showWarningMessage = warn;
        }
        return caught;
    };

    test('a CodeLens above each CTE of the query, not one inside parentheses or in the config block', async () => {
        let lenses: vscode.CodeLens[] = [];
        // The CodeLens providers answer once the extension has registered them
        for (let waited = 0; waited < 30_000 && lenses.length === 0; waited += 500) {
            const all = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', document.uri);
            lenses = all.filter((lens) => lens.command?.command === COMMAND);
            if (lenses.length === 0) {
                await sleep(500);
            }
        }
        assert.deepStrictEqual(lenses.map((lens) => [lens.range.start.line, lens.command!.title, lens.command!.arguments![1]]), [
            [9, '▶ Preview CTE', { name: 'clubs', occurrence: 0 }],
            [12, '▶ Preview CTE', { name: 'named', occurrence: 0 }],
        ]);
    });

    test('the light bulb in a CTE offers to preview it', async () => {
        const inNamed = document.positionAt(SQLX.indexOf('WHERE id'));
        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, new vscode.Range(inNamed, inNamed));
        const preview = actions.find((action) => action.command?.command === COMMAND);
        assert.strictEqual(preview?.title, 'Preview results of CTE named');
        assert.deepStrictEqual(preview?.command?.arguments?.[1], { name: 'named', occurrence: 0 });
    });

    test('runs the pre-operations, then the compiled WITH clause up to the CTE and a SELECT of its rows', async () => {
        let caught: Awaited<ReturnType<typeof run>> = {};
        // Until the new file is compiled, the Project has no action for it
        for (let waited = 0; waited < 90_000 && !caught.query; waited += 1000) {
            caught = await run(document.uri, { name: 'named', occurrence: 0 });
            if (!caught.query) {
                await sleep(1000);
            }
        }
        assert.strictEqual(caught.type, 'table', caught.warning);
        assert.match(caught.query ?? '', /^DECLARE min_id INT64 DEFAULT 0;\nWITH clubs AS \(\n  SELECT \* FROM `[\w-]+\.[\w-]+\.0100_CLUBS`\n\),\nnamed AS \(\n  SELECT \* FROM clubs WHERE id > min_id\n\)\nSELECT \* FROM named LIMIT 1000;$/);
    });

    test('from the cursor, with no arguments, the CTE the cursor is in', async () => {
        const editor = await vscode.window.showTextDocument(document);
        const inClubs = document.positionAt(SQLX.indexOf('SELECT * FROM ${ref'));
        editor.selection = new vscode.Selection(inClubs, inClubs);
        const caught = await run();
        assert.match(caught.query ?? '', /\nSELECT \* FROM clubs LIMIT 1000;$/);
        assert.doesNotMatch(caught.query ?? '', /named AS/);
    });

    test('a CTE the compiled query does not have is said, and nothing runs', async () => {
        const caught = await run(document.uri, { name: 'no_such_cte', occurrence: 0 });
        assert.strictEqual(caught.query, undefined);
        assert.strictEqual(caught.warning, 'CTE no_such_cte is not in the compiled query.');
    });
});
