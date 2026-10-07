import * as assert from 'assert';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, test } from 'mocha';

/*
The extension in a dbt workspace: opens the example dbt Project (src/test/fixtures/xf-examples/projects/dbt) in the
real extension. Run with `vscode-test --label dbt`, which `npm test` does. Nothing here needs dbt installed.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ProjectsApi {
    list(): Array<{ root: string; backend: string }>;
    backendContext(): { backend: string; canRun: boolean; listsChangedActions: boolean };
}

suite('a dbt workspace', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let api: ProjectsApi;

    suiteSetup(async function () {
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label dbt`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        api = (await extension.activate())?.__projects;
        assert.ok(api, 'The extension does not expose __projects');
    });

    test('is found as one dbt Project, whose Backend can run and does not list Changed Actions', () => {
        assert.deepStrictEqual(api.list(), [{ root: workspaceFolder, backend: 'dbt' }]);
        assert.deepStrictEqual(api.backendContext(), { backend: 'dbt', canRun: true, listsChangedActions: false });
    });

    test('opening a model shows no message', async () => {
        const shown: string[] = [];
        const window = vscode.window as unknown as Record<string, (...args: unknown[]) => unknown>;
        const kinds = ['showErrorMessage', 'showWarningMessage', 'showInformationMessage'];
        const originals = kinds.map((kind) => window[kind]);
        kinds.forEach((kind) => {
            window[kind] = (message: unknown) => {
                shown.push(`${kind}: ${String(message)}`);
                return Promise.resolve(undefined);
            };
        });
        try {
            const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder!, 'models', 'marts', 'fct_orders.sql'));
            await vscode.window.showTextDocument(document, { preview: false });
            // Longer than the debounce of the listeners for a change of editor
            await sleep(2000);
            assert.deepStrictEqual(shown, []);
            // That this way of listening does hear the extension: a Dataform command says why it does nothing here
            await vscode.commands.executeCommand('vscode-dataform-tools.runCurrentFile');
            assert.strictEqual(shown.length, 1, 'A Dataform command run in a dbt Project should say why it did nothing');
        } finally {
            kinds.forEach((kind, index) => {
                window[kind] = originals[index];
            });
        }
        assert.strictEqual(vscode.window.activeTextEditor?.document.languageId === 'sqlx', false, 'No language is claimed for .sql');
        assert.strictEqual(api.backendContext().backend, 'dbt');
    });
});
