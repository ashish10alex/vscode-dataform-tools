import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';

/*
The editor features of a dbt Project, in the real extension with a stand-in for dbt that writes a manifest recorded
from the real one (see src/test/fixtures/dbt-manifests). Run with `vscode-test --label dbt`.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

suite('the editor features of a dbt Project', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manifests = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'dbt-manifests');
    const settings = () => vscode.workspace.getConfiguration('vscode-dataform-tools');
    let dir: string;
    let standIn: string;
    let api: { compileDbt(root: string, file: string): Promise<void>; forgetDbt(root: string): void; dbtTool(root: string): Promise<{ path?: string }> };

    async function show(relativePath: string) {
        const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder!, relativePath));
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
        return document;
    }

    /** Where go to definition leads from just inside `needle` of a file, as `file:line` relative to the Project */
    async function definitions(document: vscode.TextDocument, needle: string, into = 1): Promise<string[]> {
        const offset = document.getText().indexOf(needle);
        assert.ok(offset >= 0, `${document.fileName} has no ${needle}`);
        const found = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>('vscode.executeDefinitionProvider', document.uri, document.positionAt(offset + into));
        return found.map((each) => {
            const uri = 'targetUri' in each ? each.targetUri : each.uri;
            const range = 'targetUri' in each ? each.targetRange : each.range;
            return `${path.relative(workspaceFolder!, uri.fsPath).split(path.sep).join('/')}:${range.start.line}`;
        });
    }

    async function until<T>(what: string, read: () => Promise<T>, wanted: (value: T) => boolean): Promise<T> {
        let value = await read();
        for (let waited = 0; waited < 20_000 && !wanted(value); waited += 100) {
            await sleep(100);
            value = await read();
        }
        assert.ok(wanted(value), `Timed out waiting for ${what}: ${JSON.stringify(value)}`);
        return value;
    }

    suiteSetup(async function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label dbt`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        api = (await extension.activate())?.__projects;
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-editor-')));
        standIn = path.join(dir, 'dbt');
        fs.writeFileSync(standIn, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('dbt 2.9.9'); return; }
const target = args[args.indexOf('--target-path') + 1];
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(${JSON.stringify(path.join(manifests, 'dbt-v2.json'))}, path.join(target, 'manifest.json'));
console.log(JSON.stringify({ info: { level: 'info', name: 'CommandCompleted', msg: "Finished '" + args[0] + "' successfully for target 'dev'" } }));
`, { mode: 0o755 });
        // In the user settings of the test host, so that nothing is written into the example Project
        await settings().update('dbtExecutablePath', standIn, vscode.ConfigurationTarget.Global);
        await until('the stand-in for dbt to be found', () => api.dbtTool(workspaceFolder!), (tool) => tool.path === standIn);
    });

    suiteTeardown(async function () {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (dir) {
            await settings().update('dbtExecutablePath', undefined, vscode.ConfigurationTarget.Global);
            await settings().update('dbtEditorFeatures', undefined, vscode.ConfigurationTarget.Global);
            // Nothing of this suite's compile is left for the next one to find
            await until('the stand-in for dbt to be let go', () => api.dbtTool(workspaceFolder!), (tool) => tool.path !== standIn);
            api.forgetDbt(workspaceFolder!);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('go to definition from a ref() leads to the model, whatever the language of the .sql file', async () => {
        const document = await show('models/marts/fct_orders.sql');
        // Nothing before the Project's first compile
        assert.deepStrictEqual(await definitions(document, "'stg_orders'", 3), []);
        await api.compileDbt(workspaceFolder!, 'models/marts/fct_orders.sql');
        assert.deepStrictEqual(await definitions(document, "'stg_orders'", 3), ['models/staging/stg_orders.sql:0']);
        // No language is claimed: the file keeps the id it had, and a change of it changes nothing
        const plain = await vscode.languages.setTextDocumentLanguage(document, 'plaintext');
        assert.deepStrictEqual(await definitions(plain, "'stg_payments'", 3), ['models/staging/stg_payments.sql:0']);
        // SQL of the file that is no call
        assert.deepStrictEqual(await definitions(plain, 'o.order_id'), []);
    });

    test('from a source() it leads to the table in its YAML file, and from a ref() written in YAML to the model', async () => {
        assert.deepStrictEqual(await definitions(await show('models/staging/stg_orders.sql'), "'orders'", 2), ['models/staging/_sources.yml:13']);
        assert.deepStrictEqual(await definitions(await show('models/reporting/_exposures.yml'), "ref('daily_revenue')", 6), ['models/marts/daily_revenue.sql:0']);
    });

    test('from a macro call it leads to the line of the macro', async () => {
        const document = await show('models/marts/fct_orders.sql');
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), '{{ record_run_in_audit_log() }}\n');
        await vscode.workspace.applyEdit(edit);
        try {
            assert.deepStrictEqual(await definitions(document, 'record_run_in_audit_log'), ['macros/audit.sql:5']);
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    test('the setting turns the features off and on again', async () => {
        const document = await show('models/marts/fct_orders.sql');
        await settings().update('dbtEditorFeatures', 'off', vscode.ConfigurationTarget.Global);
        await until('the features to go', () => definitions(document, "'stg_orders'", 3), (found) => found.length === 0);
        await settings().update('dbtEditorFeatures', 'auto', vscode.ConfigurationTarget.Global);
        await until('the features to come back', () => definitions(document, "'stg_orders'", 3), (found) => found.length === 1);
    });
});
