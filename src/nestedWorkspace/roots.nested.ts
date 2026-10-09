import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';

/*
The extension in a workspace whose Projects are below the workspace folder: opens the folder that holds the example
dbt Projects (src/test/fixtures/xf-examples/projects), none of which is at its root. Run with
`vscode-test --label nested`, which `npm test` does. Nothing here needs dbt installed.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProjectsApi {
    list(): Array<{ root: string; backend: string }>;
    active(): string | undefined;
    backendContext(): { backend: string; canRun: boolean; listsChangedActions: boolean };
    setDbtWithoutPanel(on: boolean): void;
}

suite('a workspace with Projects below its folder', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let api: ProjectsApi;

    suiteSetup(async function () {
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label nested`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        api = (await extension.activate())?.__projects;
        assert.ok(api, 'The extension does not expose __projects');
        // No dbt is to be run by this suite: the machine's own may be found, and would be run on the example Projects
        api.setDbtWithoutPanel(false);
    });

    suiteTeardown(() => api?.setDbtWithoutPanel(true));

    test('the search of the workspace finds each of them, with no file opened', async () => {
        const expected = ['dbt', 'dbt-broken', 'dbt-hooks'].map((name) => ({ root: path.join(workspaceFolder!, name), backend: 'dbt' }));
        for (let waited = 0; waited < 10_000 && api.list().length < expected.length; waited += 100) {
            await sleep(100);
        }
        assert.deepStrictEqual(api.list().sort((a, b) => a.root.localeCompare(b.root)), expected);
    });

    test('the Project follows the file in the editor', async () => {
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(workspaceFolder!, 'dbt', 'dbt_project.yml')));
        assert.strictEqual(api.active(), path.join(workspaceFolder!, 'dbt'));
        assert.strictEqual(api.backendContext().backend, 'dbt');
        await vscode.window.showTextDocument(vscode.Uri.file(path.join(workspaceFolder!, 'dbt-hooks', 'dbt_project.yml')));
        assert.strictEqual(api.active(), path.join(workspaceFolder!, 'dbt-hooks'));
    });
});
