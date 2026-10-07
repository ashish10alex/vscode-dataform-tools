import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import type { CompileStatus, FileSlice, ProjectSlice } from '../shared/panelContract';

/*
The compile loop of a dbt Project, in the real extension with a stand-in for dbt: a script that answers `--version`
as dbt v2 does and, for `parse` and `compile`, writes a manifest recorded from the real one (see
src/test/fixtures/dbt-manifests). Run with `vscode-test --label dbt`.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const P = 'alex-personal-dev-01';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface PanelApi {
    onDidPostMessage(listener: (message: unknown) => void): vscode.Disposable;
}

suite('the compile loop of a dbt Project', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const manifests = path.resolve(__dirname, '..', '..', '..', 'src', 'test', 'fixtures', 'dbt-manifests');
    let dir: string;
    let subscription: vscode.Disposable | undefined;
    const slices: { project?: ProjectSlice; compile?: CompileStatus; file?: FileSlice } = {};
    const statuses: string[] = [];
    const settings = () => vscode.workspace.getConfiguration('vscode-dataform-tools');
    /** The commands the stand-in was run with, without `--version` */
    const ran = () => (fs.existsSync(path.join(dir, 'ran.jsonl')) ? fs.readFileSync(path.join(dir, 'ran.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as string[]) : []);

    async function until(what: string, condition: () => boolean) {
        for (let waited = 0; waited < 20_000; waited += 50) {
            if (condition()) {
                return;
            }
            await sleep(50);
        }
        assert.fail(`Timed out waiting for ${what}. Compile status: ${JSON.stringify(slices.compile)}; ran: ${JSON.stringify(ran().map((args) => args[0]))}`);
    }

    async function show(relativePath: string) {
        const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder!, relativePath));
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
        return document;
    }

    suiteSetup(async function () {
        // The stand-in for dbt is a script with a shebang line, which Windows cannot start
        if (process.platform === 'win32') {
            this.skip();
        }
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label dbt`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        const panel: PanelApi = (await extension.activate())?.__panel;
        subscription = panel.onDidPostMessage((message) => {
            const { slice, value } = message as { slice?: string; value?: unknown };
            if (slice === 'project') {
                slices.project = value as ProjectSlice;
            } else if (slice === 'compile status') {
                slices.compile = value as CompileStatus;
                statuses.push(slices.compile.status);
            } else if (slice === 'file') {
                slices.file = value as FileSlice;
            }
        });

        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-loop-')));
        const standIn = path.join(dir, 'dbt');
        fs.writeFileSync(standIn, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), dir = ${JSON.stringify(dir)};
if (args[0] === '--version') { console.log('dbt 2.9.9'); return; }
fs.appendFileSync(path.join(dir, 'ran.jsonl'), JSON.stringify(args) + '\\n');
const target = args[args.indexOf('--target-path') + 1];
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(${JSON.stringify(path.join(manifests, 'dbt-v2.json'))}, path.join(target, 'manifest.json'));
console.log(JSON.stringify({ info: { level: 'info', name: 'CommandCompleted', msg: "Finished '" + args[0] + "' successfully for target 'dev'" } }));
`, { mode: 0o755 });
        // In the user settings of the test host, so that nothing is written into the example Project
        await settings().update('dbtExecutablePath', standIn, vscode.ConfigurationTarget.Global);
    });

    suiteTeardown(async function () {
        subscription?.dispose();
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (dir) {
            await settings().update('dbtExecutablePath', undefined, vscode.ConfigurationTarget.Global);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('opening the panel on a model compiles the Project and shows the model with its tests', async () => {
        await show('models/marts/fct_orders.sql');
        await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
        await until('the compile to end', () => slices.compile?.status === 'compiled' && slices.file?.role === 'actions');

        // dbt v2: parse first, then the whole Project, with private artifacts
        assert.deepStrictEqual(ran().map((args) => args[0]), ['parse', 'compile']);
        const compile = ran()[1];
        assert.strictEqual(compile[compile.indexOf('--project-dir') + 1], workspaceFolder);
        const targetPath = compile[compile.indexOf('--target-path') + 1];
        assert.ok(!targetPath.startsWith(workspaceFolder!), `dbt was told to write into the Project: ${targetPath}`);
        assert.ok(fs.existsSync(path.join(path.dirname(targetPath), 'last-used')));

        assert.strictEqual(slices.project?.backend, 'dbt');
        assert.strictEqual(slices.project?.root, workspaceFolder);
        assert.deepStrictEqual(slices.project?.parts, { runner: true, changes: false });
        assert.ok(slices.project?.tags.includes('marts'));
        assert.ok(statuses.includes('compiling'), `The panel was never told a compile was running: ${statuses.join(', ')}`);

        assert.strictEqual(slices.file?.file, 'models/marts/fct_orders.sql');
        assert.deepStrictEqual(slices.file?.actions.map((action) => [action.kind, action.target.name]), [
            ['incremental', 'fct_orders'],
            ['test', 'assert_positive_order_totals'],
            ['test', 'not_null_fct_orders_order_id'],
            ['test', 'unique_fct_orders_order_id'],
            ['unit test', 'test_fct_orders_sums_payments'],
        ]);
        assert.strictEqual(slices.file?.actions[0].id, `${P}.xf_example.fct_orders`);
        assert.strictEqual(slices.file?.actions[0].sqlPresent, true);
        // Every slice names the compile it came from
        assert.strictEqual(slices.file?.compile, slices.compile?.compile);
        assert.strictEqual(slices.project?.compile, slices.compile?.compile);
    });

    test('on dbt v2, showing another file reads the graph in memory', async () => {
        const before = ran().length;
        const compileBefore = slices.compile?.compile;
        await show('models/staging/stg_orders.sql');
        await until('the other file', () => slices.file?.file === 'models/staging/stg_orders.sql');
        assert.strictEqual(slices.file?.actions[0].target.name, 'stg_orders');
        assert.strictEqual(ran().length, before, 'dbt was run again for a file switch');
        assert.strictEqual(slices.compile?.compile, compileBefore);

        // A file that defines no action is a helper of the compile, not a blank
        await show('macros/audit.sql');
        await until('the macro file', () => slices.file?.file === 'macros/audit.sql');
        assert.deepStrictEqual([slices.file?.role, slices.file?.actions.length], ['helper', 0]);
        await show('dbt_project.yml');
        await until('the settings file', () => slices.file?.file === 'dbt_project.yml');
        assert.strictEqual(slices.file?.role, 'project settings');
        assert.strictEqual(ran().length, before);
    });

    test('a save compiles again, and the panel is told of the new compile', async () => {
        const before = ran().length;
        const compileBefore = slices.compile?.compile ?? 0;
        const document = await show('models/staging/stg_orders.sql');
        await until('the file', () => slices.file?.file === 'models/staging/stg_orders.sql');
        // A save without a change: the file is written as it was
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), ' ');
        await vscode.workspace.applyEdit(edit);
        const undo = new vscode.WorkspaceEdit();
        undo.delete(document.uri, new vscode.Range(0, 0, 0, 1));
        await vscode.workspace.applyEdit(undo);
        await document.save();
        await until('the compile after the save', () => (slices.compile?.compile ?? 0) > compileBefore && slices.compile?.status === 'compiled');
        // The parse is not repeated: no dbt_project.yml has changed since it found no hooks
        assert.deepStrictEqual(ran().slice(before).map((args) => args[0]), ['compile']);
        assert.strictEqual(slices.file?.compile, slices.compile?.compile);
    });
    test('on dbt-core, each file is compiled when it is shown, and only it', async () => {
        // A stand-in that answers as dbt-core does and, as the real one, leaves SQL only on what was selected
        const standIn = path.join(dir, 'dbt-core');
        fs.writeFileSync(standIn, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), dir = ${JSON.stringify(dir)};
if (args[0] === '--version') { console.log('Core:\\n  - installed: 1.9.9\\n\\nPlugins:\\n  - bigquery: 1.9.9'); return; }
fs.appendFileSync(path.join(dir, 'ran.jsonl'), JSON.stringify(args) + '\\n');
const target = args[args.indexOf('--target-path') + 1];
const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(manifests, 'dbt-core.json'))}, 'utf8'));
const selected = args.includes('--select') ? args[args.indexOf('--select') + 1].replace('path:', '') : undefined;
const model = Object.values(manifest.nodes).find((node) => node.original_file_path === selected);
for (const node of Object.values(manifest.nodes)) {
    const wanted = model && (node === model || (node.resource_type === 'test' && (node.depends_on.nodes || []).includes(model.unique_id)));
    if (!wanted) { node.compiled = false; node.compiled_code = null; }
}
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
`, { mode: 0o755 });
        fs.rmSync(path.join(dir, 'ran.jsonl'), { force: true });
        await show('models/marts/fct_orders.sql');
        await until('the model', () => slices.file?.file === 'models/marts/fct_orders.sql');
        const compileBefore = slices.compile?.compile ?? 0;
        // Another dbt: what the first one compiled is not shown as its work, so the next file shown is compiled
        await settings().update('dbtExecutablePath', standIn, vscode.ConfigurationTarget.Global);
        const selects = () => ran().map((args) => [args[0], ...args.slice(args.indexOf('--select'))]);
        const sqlOf = (name: string) => slices.file?.actions.find((action) => action.target.name === name)?.sqlPresent;

        await show('models/staging/stg_orders.sql');
        await until('the first compile with dbt-core', () => (slices.compile?.compile ?? 0) > compileBefore && slices.compile?.status === 'compiled' && slices.file?.file === 'models/staging/stg_orders.sql');
        assert.strictEqual(sqlOf('stg_orders'), true, JSON.stringify(selects()));

        // Another model: its SQL was not compiled, so it is, by its path
        await show('models/marts/fct_orders.sql');
        await until('fct_orders to be compiled', () => slices.file?.file === 'models/marts/fct_orders.sql' && sqlOf('fct_orders') === true && slices.compile?.status === 'compiled');
        // Its tests came with it
        assert.strictEqual(sqlOf('unique_fct_orders_order_id'), true);
        assert.deepStrictEqual(selects().at(-1), ['compile', '--select', `path:${path.join('models', 'marts', 'fct_orders.sql')}`]);
        const runs = ran().length;

        // A file with no action needs no compile
        await show('macros/audit.sql');
        await until('the macro file', () => slices.file?.file === 'macros/audit.sql');
        assert.strictEqual(ran().length, runs);

        // Back to the first model: its SQL went with the compile of the other, so it is compiled again
        await show('models/staging/stg_orders.sql');
        await until('stg_orders to be compiled again', () => slices.file?.file === 'models/staging/stg_orders.sql' && sqlOf('stg_orders') === true && slices.compile?.status === 'compiled');
        assert.deepStrictEqual(selects().at(-1), ['compile', '--select', `path:${path.join('models', 'staging', 'stg_orders.sql')}`]);
        assert.ok(selects().every(([command]) => command === 'compile'), 'dbt-core was asked for something other than a selected compile');
    });
});
