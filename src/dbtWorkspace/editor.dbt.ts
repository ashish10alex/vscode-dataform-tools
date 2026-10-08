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
    let api: {
        compileDbt(root: string, file: string): Promise<void>;
        forgetDbt(root: string): void;
        dbtTool(root: string): Promise<{ path?: string }>;
        setTableFetch(fetch: ((action: { id: string; target: { name: string } }) => Promise<unknown>) | undefined): void;
        heldTableCount(root: string): number;
        setDbtWithoutPanel(on: boolean): void;
        setDbtDryRun(run: ((sql: string, action: { target: { name: string } }) => Promise<unknown>) | undefined): void;
    };
    /** The actions BigQuery was asked to dry-run, in order */
    const dryRan: string[] = [];
    const dryRunMarkers = (relativePath: string) => vscode.languages.getDiagnostics(vscode.Uri.file(path.join(workspaceFolder!, relativePath)))
        .filter((diagnostic) => diagnostic.source === 'BigQuery dry run')
        .map((diagnostic) => `${diagnostic.range.start.line}:${diagnostic.range.start.character}-${diagnostic.range.end.character} ${diagnostic.message}`);

    /** Saves the file as it is: a change and its undoing, so that there is something to save */
    async function save(document: vscode.TextDocument) {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), ' ');
        await vscode.workspace.applyEdit(edit);
        const undo = new vscode.WorkspaceEdit();
        undo.delete(document.uri, new vscode.Range(0, 0, 0, 1));
        await vscode.workspace.applyEdit(undo);
        await document.save();
    }
    /** The commands the stand-in was run with, without `--version` */
    const ran = () => (fs.existsSync(path.join(dir, 'ran.jsonl')) ? fs.readFileSync(path.join(dir, 'ran.jsonl'), 'utf8').trim().split('\n').map((line) => (JSON.parse(line) as string[])[0]) : []);
    /** The tables BigQuery was asked for, in order */
    const asked: string[] = [];

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

    /** What a hover just inside `needle` of a file says, each extension's part as Markdown */
    async function hovers(document: vscode.TextDocument, needle: string, into = 1): Promise<string[]> {
        const offset = document.getText().indexOf(needle);
        assert.ok(offset >= 0, `${document.fileName} has no ${needle}`);
        const found = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, document.positionAt(offset + into));
        return found.flatMap((hover) => hover.contents.map((content) => (typeof content === 'string' ? content : content.value)));
    }

    /**
     * What is offered at the `|` of `line`, written as the first line of the file, by this extension's provider alone:
     * its entries have a range, which the editor's own word suggestions do not. Each as "label [beside it] (detail)".
     */
    async function completions(document: vscode.TextDocument, line: string): Promise<string[]> {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), `${line.replace('|', '')}\n`);
        await vscode.workspace.applyEdit(edit);
        try {
            const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(0, line.indexOf('|')));
            return list.items
                .filter((item) => item.kind === vscode.CompletionItemKind.Reference || item.kind === vscode.CompletionItemKind.Field)
                .map((item) => (typeof item.label === 'string' ? `${item.label} (${item.detail})` : `${item.label.label} [${item.label.description}] (${item.detail})`));
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
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
        // BigQuery's answers: stg_payments is not built yet
        api.setTableFetch(async (action) => {
            asked.push(action.target.name);
            return action.target.name === 'stg_payments'
                ? { state: 'missing' }
                : { state: 'found', rows: 42, fields: [{ name: 'order_id', type: 'INT64' }, { name: 'status', type: 'STRING', description: 'From BigQuery' }] };
        });
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-editor-')));
        standIn = path.join(dir, 'dbt');
        fs.writeFileSync(standIn, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('dbt 2.9.9'); return; }
fs.appendFileSync(${JSON.stringify(path.join(dir, 'ran.jsonl'))}, JSON.stringify(args) + '\\n');
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
        api?.setDbtDryRun(undefined);
        await settings().update('dbtDryRunOnSave', undefined, vscode.ConfigurationTarget.Global);
        await settings().update('showCompiledQueryInVerticalSplitOnSave', undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (dir) {
            await settings().update('dbtExecutablePath', undefined, vscode.ConfigurationTarget.Global);
            await settings().update('dbtEditorFeatures', undefined, vscode.ConfigurationTarget.Global);
            // Nothing of this suite's compile is left for the next one to find
            await until('the stand-in for dbt to be let go', () => api.dbtTool(workspaceFolder!), (tool) => tool.path !== standIn);
            api.forgetDbt(workspaceFolder!);
            api.setTableFetch(undefined);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('a Project is parsed when one of its files is first shown, with the panel closed, and not again for the next file', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        // As a window that has just opened the Project: nothing known of it, and nothing asked
        api.forgetDbt(workspaceFolder!);
        api.setDbtWithoutPanel(true);
        const document = await show('models/marts/fct_orders.sql');
        await until('the definition of a ref()', () => definitions(document, "'stg_orders'", 3), (found) => found.length > 0);
        assert.deepStrictEqual(ran(), ['parse']);
        await show('models/staging/stg_orders.sql');
        await sleep(500);
        assert.deepStrictEqual(ran(), ['parse']);
    });

    test('go to definition from a ref() leads to the model, whatever the language of the .sql file', async () => {
        const document = await show('models/marts/fct_orders.sql');
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

    test('a hover on a ref() says what the Project and BigQuery know of the table, which is asked of BigQuery once', async () => {
        const document = await show('models/marts/fct_orders.sql');
        asked.length = 0;
        const [text] = await hovers(document, "'stg_orders'", 3);
        assert.ok(text.startsWith('#### [alex-personal-dev-01.xf_example.stg_orders](https://console.cloud.google.com/bigquery?'), text);
        assert.ok(text.includes('**Kind:** view \u00B7 `models/staging/stg_orders.sql`'), text);
        assert.ok(text.includes('**Rows:** 42'), text);
        assert.ok(text.includes('| status | STRING |'), text);
        await hovers(document, "'stg_orders'", 3);
        assert.deepStrictEqual(asked, ['stg_orders']);
        assert.strictEqual(api.heldTableCount(workspaceFolder!), 1);

        const [missing] = await hovers(document, "'stg_payments'", 3);
        assert.ok(missing.includes('_Not built yet: BigQuery has no table of this name._'), missing);
    });

    test('a hover on a column says which tables the file reads have it, through its alias when it has one', async () => {
        const document = await show('models/marts/fct_orders.sql');
        // The description is the one the Project's YAML gives the column, not BigQuery's
        assert.deepStrictEqual(await hovers(document, 'o.status', 3), ['**status** `STRING` \u00B7 stg_orders (view)\n\nWhere the order is: `placed`, `shipped`, `completed` or `returned`.']);
        // `p` is stg_payments, which has no table yet, and whose YAML documents no column of the name
        assert.deepStrictEqual(await hovers(document, 'p.amount', 3), []);
        // A bare name: every table the file reads
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), 'select order_id from x\n');
        await vscode.workspace.applyEdit(edit);
        try {
            assert.deepStrictEqual(await hovers(document, 'order_id from x', 3), ['**order_id** `INT64` \u00B7 stg_orders (view)']);
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
        // A word that is no column of them, and SQL inside Jinja
        assert.deepStrictEqual(await hovers(document, 'left join', 1), []);
    });

    test('inside a ref() the models, seeds and snapshots are offered, and inside a source() its sources, then their tables', async () => {
        const document = await show('models/marts/fct_orders.sql');
        const refs = await completions(document, "select * from {{ ref('|') }}");
        assert.strictEqual(refs.length, 11, refs.join(', '));
        assert.ok(refs.includes('stg_orders (view)') && refs.includes('country_codes (seed)') && refs.includes('customers_snapshot (snapshot)'), refs.join(', '));
        assert.deepStrictEqual(await completions(document, '{{ source("|") }}'), ['raw (source)']);
        assert.deepStrictEqual(await completions(document, "{{ source('raw', '|') }}"), ['customers (source)', 'orders (source)', 'payments (source)']);
        // Not in another call, and not in a string of the SQL
        assert.deepStrictEqual(await completions(document, "{{ config(alias='|') }}"), []);
        assert.deepStrictEqual(await completions(document, "select '|'"), []);
    });

    test('after an alias and a dot the columns of its table are offered, and elsewhere those of every table the file reads', async () => {
        const document = await show('models/marts/fct_orders.sql');
        assert.deepStrictEqual(await completions(document, 'select o.| from x'), ['order_id [stg_orders] (INT64 \u00B7 stg_orders (view))', 'status [stg_orders] (STRING \u00B7 stg_orders (view))']);
        // stg_payments is not built: what its YAML documents, which is nothing
        assert.deepStrictEqual(await completions(document, 'select p.| from x'), []);
        // A name that is no alias of the file, such as a CTE's
        assert.deepStrictEqual(await completions(document, 'select cte.| from x'), []);
        const bare = await completions(document, 'select sta| from x');
        assert.deepStrictEqual(bare, ['order_id [stg_orders] (INT64 \u00B7 stg_orders (view))', 'status [stg_orders] (STRING \u00B7 stg_orders (view))']);
    });

    test('the held schemas are dropped when the Project compiles again', async () => {
        assert.ok(api.heldTableCount(workspaceFolder!) > 0);
        const document = await show('models/marts/fct_orders.sql');
        await document.save();
        await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
        await until('the schemas to be dropped', async () => api.heldTableCount(workspaceFolder!), (count) => count === 0);
        asked.length = 0;
        await until('the next hover', () => hovers(document, "'stg_orders'", 3), (found) => found.length === 1);
        assert.deepStrictEqual(asked, ['stg_orders']);
    });

    test('a save with the panel closed compiles the file and dry-runs it, and marks what BigQuery says in the editor', async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        // Longer than the debounce of a save, so that nothing of the tests above is still to come
        await sleep(1500);
        // A save opens the panel unless this is off: with it off, the panel stays closed
        await settings().update('showCompiledQueryInVerticalSplitOnSave', false, vscode.ConfigurationTarget.Global);
        // BigQuery's answers: an error in a line of the model that is as written, one in a generic test, one in a line Jinja built
        const wrong: Record<string, string> = { fct_orders: 'sum(p.amount)', not_null_fct_orders_order_id: 'select', assert_positive_order_totals: 'fct_orders' };
        api.setDbtDryRun(async (sql, action) => {
            dryRan.push(action.target.name);
            const needle = wrong[action.target.name];
            const line = needle ? sql.split('\n').findIndex((text) => text.includes(needle)) + 1 : 0;
            return line > 0
                ? { error: { hasError: true, message: `Unrecognized name near ${needle}`, location: { line, column: 3 } } }
                : { error: { hasError: false, message: '' }, statistics: { totalBytesProcessed: 10 }, schema: { fields: [{ name: 'amount', type: 'NUMERIC' }] } };
        });
        const document = await show('models/marts/fct_orders.sql');
        // Nothing is marked for the dry runs of the tests above, which had no credentials to ask BigQuery with
        assert.deepStrictEqual(dryRunMarkers('models/marts/fct_orders.sql'), []);
        dryRan.length = 0;
        const before = ran().length;
        await save(document);
        await until('the dry-run markers', async () => dryRunMarkers('models/marts/fct_orders.sql'), (found) => found.length > 0);
        assert.deepStrictEqual(ran().slice(before), ['compile']);
        assert.deepStrictEqual([...dryRan].sort(), ['assert_positive_order_totals', 'fct_orders', 'not_null_fct_orders_order_id', 'unique_fct_orders_order_id']);

        // On the line of the source that is the compiled line
        const sumLine = document.getText().split('\n').findIndex((text) => text.includes('sum(p.amount)'));
        assert.deepStrictEqual(dryRunMarkers('models/marts/fct_orders.sql'), [`${sumLine}:2-25 Unrecognized name near sum(p.amount)`]);
        // A generic test: on the line of the YAML file that declares it, saying where in the compiled query
        const yaml = fs.readFileSync(path.join(workspaceFolder!, 'models/marts/_marts.yml'), 'utf8').split('\n');
        const [inYaml] = dryRunMarkers('models/marts/_marts.yml');
        const declared = yaml.findIndex((text, index) => index > yaml.findIndex((line) => line.includes('- name: fct_orders')) && text.includes('data_tests: [unique, not_null]'));
        assert.ok(inYaml.startsWith(`${declared}:8-`), inYaml);
        assert.ok(inYaml.includes('test not_null_fct_orders_order_id: Unrecognized name near select') && inYaml.includes('Open the Compiled Query panel'), inYaml);
        // A line that Jinja built: on the first line of the singular test's own file
        const [inTest] = dryRunMarkers('tests/assert_positive_order_totals.sql');
        assert.ok(inTest.startsWith('0:0-') && /The error is in the compiled query at line \d+, column 3\./.test(inTest), inTest);
        // The panel was not opened for it
        assert.deepStrictEqual(vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label)), ['fct_orders.sql']);
    });

    test("a hover on a column that only the file's own query gives says what its dry run said", async () => {
        const document = await show('models/staging/stg_orders.sql');
        await save(document);
        await until('the dry run of the file', async () => dryRan.includes('stg_orders'), (done) => done);
        // `amount` is no column of the source the file reads, as BigQuery is made to answer here
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(0, 0), 'select amount from x\n');
        await vscode.workspace.applyEdit(edit);
        try {
            await until('the hover', () => hovers(document, 'amount from x', 3), (found) => found.length > 0);
            assert.deepStrictEqual(await hovers(document, 'amount from x', 3), ['**amount** `NUMERIC` \u00B7 stg_orders (view)']);
        } finally {
            await vscode.commands.executeCommand('workbench.action.files.revert');
        }
    });

    test('with the panel open a save is the panel\'s to compile and dry-run, once, and its errors are marked the same', async () => {
        const document = await show('models/marts/fct_orders.sql');
        await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
        await until('the dry runs of the panel', async () => dryRan.filter((name) => name === 'fct_orders').length, (count) => count >= 2);
        // Longer than the debounce of a save, so that nothing of the above is still to come
        await sleep(1500);
        dryRan.length = 0;
        const before = ran().length;
        await save(document);
        await until('the dry runs of the save', async () => dryRan.length, (count) => count >= 4);
        await sleep(1000);
        assert.deepStrictEqual([ran().slice(before), dryRan.length], [['compile'], 4]);
        assert.strictEqual(dryRunMarkers('models/marts/fct_orders.sql').length, 1);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await sleep(1000);
    });

    test('with dbtDryRunOnSave off a save only parses, and the markers of the last compile go', async () => {
        const document = await show('models/marts/fct_orders.sql');
        dryRan.length = 0;
        await save(document);
        await until('the dry runs of a save', async () => dryRan.length, (count) => count === 4);
        await until('their markers', async () => dryRunMarkers('models/marts/fct_orders.sql'), (found) => found.length > 0);
        await settings().update('dbtDryRunOnSave', false, vscode.ConfigurationTarget.Global);
        dryRan.length = 0;
        const before = ran().length;
        await save(document);
        await until('the parse', async () => ran().slice(before), (commands) => commands.length > 0);
        await until('the markers to go', async () => dryRunMarkers('models/marts/fct_orders.sql'), (found) => found.length === 0);
        await sleep(500);
        assert.deepStrictEqual([ran().slice(before), dryRan], [['parse'], []]);
        // The editor features still have the graph
        assert.deepStrictEqual(await definitions(document, "'stg_orders'", 3), ['models/staging/stg_orders.sql:0']);
        await settings().update('dbtDryRunOnSave', undefined, vscode.ConfigurationTarget.Global);
    });

    test('the setting turns the features off and on again', async () => {
        const document = await show('models/marts/fct_orders.sql');
        await settings().update('dbtEditorFeatures', 'off', vscode.ConfigurationTarget.Global);
        await until('the features to go', () => definitions(document, "'stg_orders'", 3), (found) => found.length === 0);
        await settings().update('dbtEditorFeatures', 'auto', vscode.ConfigurationTarget.Global);
        await until('the features to come back', () => definitions(document, "'stg_orders'", 3), (found) => found.length === 1);
    });
});
