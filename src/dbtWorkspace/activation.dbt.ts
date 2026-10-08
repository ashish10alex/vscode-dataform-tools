import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';

/*
The extension in a dbt workspace: opens the example dbt Project (src/test/fixtures/xf-examples/projects/dbt) in the
real extension. Run with `vscode-test --label dbt`, which `npm test` does. Nothing here needs dbt installed.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface DbtTool {
    status: 'looking' | 'found' | 'unusable' | 'missing';
    path?: string;
    foundBy?: string;
    probe?: { flavour: string; version: string; label: string };
    reason?: string;
    looked?: string[];
}

interface ProjectsApi {
    list(): Array<{ root: string; backend: string }>;
    backendContext(): { backend: string; canRun: boolean; listsChangedActions: boolean };
    dbtTool(root: string): Promise<DbtTool>;
    setDbtWithoutPanel(on: boolean): void;
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
        // No dbt is to be run by this suite: the machine's own may be found, and would be run on the example Project
        api.setDbtWithoutPanel(false);
    });

    suiteTeardown(() => api?.setDbtWithoutPanel(true));

    test('is found as one dbt Project, whose Backend can run and does not list Changed Actions', () => {
        assert.deepStrictEqual(api.list(), [{ root: workspaceFolder, backend: 'dbt' }]);
        assert.deepStrictEqual(api.backendContext(), { backend: 'dbt', canRun: true, listsChangedActions: false });
    });

    test('its dbt is the one the path setting names, probed, and is looked for again when the setting changes', async function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-setting-'));
        const settings = vscode.workspace.getConfiguration('vscode-dataform-tools');
        // In the user settings of the test host, so that nothing is written into the example Project
        const set = (value: string | undefined) => settings.update('dbtExecutablePath', value, vscode.ConfigurationTarget.Global);
        const settled = async (wanted: (tool: DbtTool) => boolean) => {
            for (let waited = 0; waited < 10_000; waited += 100) {
                const tool = await api.dbtTool(workspaceFolder!);
                if (wanted(tool)) {
                    return tool;
                }
                await sleep(100);
            }
            return api.dbtTool(workspaceFolder!);
        };
        try {
            const standIn = path.join(dir, 'dbt');
            fs.writeFileSync(standIn, '#!/bin/sh\necho "dbt 2.9.9"\n', { mode: 0o755 });
            await set(standIn);
            assert.deepStrictEqual(await settled((tool) => tool.path === standIn), {
                status: 'found', path: standIn, foundBy: 'the dbtExecutablePath setting',
                probe: { flavour: 'dbt v2', version: '2.9.9', label: 'dbt 2.9.9', recognised: true, bigQueryAdapter: true },
            });

            // A dbt that cannot say what it is
            const broken = path.join(dir, 'broken-dbt');
            fs.writeFileSync(broken, '#!/bin/sh\necho "No module named dbt" >&2\nexit 1\n', { mode: 0o755 });
            await set(broken);
            const unusable = await settled((tool) => tool.path === broken);
            assert.strictEqual(unusable.status, 'unusable');
            assert.match(unusable.reason ?? '', /No module named dbt/);

            // The file that was found goes away: the next ask looks again, and passes the setting over
            await set(standIn);
            await settled((tool) => tool.path === standIn);
            fs.rmSync(standIn);
            const after = await api.dbtTool(workspaceFolder!);
            assert.notStrictEqual(after.path, standIn);
            assert.ok(after.status === 'missing' ? after.looked?.[0].includes('the dbtExecutablePath setting') : after.foundBy !== 'the dbtExecutablePath setting');
        } finally {
            await set(undefined);
            fs.rmSync(dir, { recursive: true, force: true });
        }
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
            // That this way of listening does hear the extension: a Dataform-only command says why it does nothing here.
            // It is not in the palette of a dbt Project, but a keybinding can still run it
            await vscode.commands.executeCommand('vscode-dataform-tools.runCurrentFileWtApi');
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
