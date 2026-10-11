import * as assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import type { PanelMessage } from '../shared/panelContract';
import { PanelSlices, applyMessage, initialSlices } from '../shared/panelState';
import { ENDED_RUN_STATES } from '../shared/cliRunJobs';

/*
Captures what the compiled query panel is sent for the website's live demo (website/demo): opens the demo Project
in the real extension, with real BigQuery, and writes every message of the host to DEMO_OUT, each with the time it
came at. `just website-demo-capture` runs it, once for the Dataform Project and once for the dbt one, and
scripts/demo/build-states.mjs makes the demo's states of what it wrote.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const OUT = process.env.DEMO_OUT;
const FILE = process.env.DEMO_FILE;
/** Set for a file that is only compiled and dry run: one with an error, for the diagnostics the website shows */
const COMPILE_ONLY = process.env.DEMO_COMPILE_ONLY === '1';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RunMessage = Extract<PanelMessage, { command: 'run' }>;

interface PanelApi {
    onDidPostMessage: vscode.Event<unknown>;
    forgetSentSlices(): void;
    dbtRunMessage(message: RunMessage): Promise<boolean> | undefined;
    dbtMessage(message: { command: 'dbt.computeChangedActions' }): Promise<void> | undefined;
    computeChangedActions(): Promise<void> | undefined;
}

interface InspectorApi {
    onDidPostMessage: vscode.Event<unknown>;
    receive?(message: unknown): Promise<void>;
}

interface Timed { at: number; message: unknown }

suite('capture for the website demo', function () {
    this.timeout(10 * 60 * 1000);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let slices: PanelSlices = initialSlices();
    let step: Timed[] = [];
    let stepStart = Date.now();
    let subscription: vscode.Disposable | undefined;
    let panel: PanelApi;
    let inspector: InspectorApi;

    function begin() {
        step = [];
        stepStart = Date.now();
    }

    function save(name: string) {
        fs.writeFileSync(path.join(OUT!, `${name}.json`), JSON.stringify(step, null, 1));
    }

    /** Waits until `done` holds and no message has come for `quietMs` */
    async function until(what: string, done: () => boolean, quietMs = 2500, limitMs = 5 * 60 * 1000) {
        const deadline = Date.now() + limitMs;
        let counted = -1;
        let quietSince = Date.now();
        while (Date.now() < deadline) {
            await sleep(100);
            if (step.length !== counted) {
                counted = step.length;
                quietSince = Date.now();
                continue;
            }
            if (done() && Date.now() - quietSince >= quietMs) {
                return;
            }
        }
        assert.fail(`Timed out waiting for ${what}. The panel has: ${JSON.stringify(slices).slice(0, 2000)}`);
    }

    suiteSetup(async function () {
        assert.ok(workspaceFolder && OUT && FILE, 'Run with `just website-demo-capture`');
        fs.mkdirSync(OUT, { recursive: true });
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        const api = await extension.activate();
        panel = api?.__panel;
        inspector = api?.__inspector;
        subscription = panel.onDidPostMessage((message) => {
            slices = applyMessage(slices, message as Parameters<typeof applyMessage>[1]);
            step.push({ at: Date.now() - stepStart, message: JSON.parse(JSON.stringify(message)) });
        });
    });

    suiteTeardown(function () {
        subscription?.dispose();
    });

    test('compile and dry run', async function () {
        begin();
        const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder!, FILE!));
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
        await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
        await until('compile and dry run', () => slices.compile?.status === 'compiled' && !!slices.bigquery && slices.bigquery.dryRunning.length === 0 && slices.bigquery.results.length > 0, 4000);
        save('compiled');
    });

    test('project info', async function () {
        if (COMPILE_ONLY) {
            this.skip();
        }
        begin();
        await vscode.commands.executeCommand('vscode-dataform-tools.showProjectInfo');
        await until('project info', () => !!slices.projectInfo && slices.projectInfo.sections.every((section) => !section.looking), 3000);
        save('project-info');
    });

    // The dependency inspector of the file, with the filter the website's demo shows: every message its page is sent
    // for the list of models, the dependencies, and a dry run and a run of each table
    test('dependency inspector', async function () {
        const filter = process.env.DEMO_INSPECTOR_FILTER;
        if (COMPILE_ONLY || !filter || slices.project?.backend === 'dbt') {
            this.skip();
        }
        const sent: Array<{ type: string; [key: string]: unknown }> = [];
        const listening = inspector.onDidPostMessage((message) => sent.push(JSON.parse(JSON.stringify(message))));
        const answered = async (ask: unknown, done: () => boolean) => {
            const start = Date.now();
            await inspector.receive!(ask);
            for (let waited = 0; !done(); waited += 50) {
                assert.ok(waited < 120_000, `The inspector did not answer ${JSON.stringify(ask)}`);
                await sleep(50);
            }
            return Date.now() - start;
        };
        try {
            await vscode.commands.executeCommand('vscode-dataform-tools.dependencyInspector');
            for (let waited = 0; !inspector.receive; waited += 50) {
                assert.ok(waited < 10_000, 'The inspector did not open');
                await sleep(50);
            }
            const modelFullId = slices.file!.actions[0].id;
            await answered({ command: 'getModels' }, () => sent.some((message) => message.type === 'models'));
            await answered({ command: 'fetchDependencies', value: { modelFullId, depth: 3 } }, () => sent.some((message) => message.type === 'dependencies'));
            const dependencies = sent.find((message) => message.type === 'dependencies') as unknown as { value: Array<{ fullId: string }> };
            const tables: Record<string, unknown> = {};
            for (const tableId of [modelFullId, ...dependencies.value.map((dependency) => dependency.fullId)]) {
                const of = (type: string) => sent.filter((message) => message.type === type && (message.value as { tableId?: string; fullTableId?: string }).tableId === tableId).pop();
                const dryRunMs = await answered({ command: 'dryRun', value: { tableId, filter } }, () => !!of('dryRunResult'));
                const queryMs = await answered({ command: 'runQuery', value: { tableId, filter } }, () => !!of('queryResult'));
                const schemaOf = () => sent.filter((message) => (message.type === 'schema' || message.type === 'schemaError') && (message.value as { fullTableId: string }).fullTableId === tableId).pop();
                await answered({ command: 'getTableSchema', value: { fullTableId: tableId } }, () => !!schemaOf());
                tables[tableId] = { dryRun: of('dryRunResult'), dryRunMs, query: of('queryResult'), queryMs, schema: schemaOf() };
            }
            fs.writeFileSync(path.join(OUT!, 'inspector.json'), JSON.stringify({ filter, modelFullId, models: sent.find((message) => message.type === 'models'), dependencies, tables }, null, 1));
        } finally {
            listening.dispose();
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    });

    // What the editor shows over the model's ref(), as the extension's hover provider gives it
    test('hover', async function () {
        if (COMPILE_ONLY) {
            this.skip();
        }
        const document = await vscode.workspace.openTextDocument(path.join(workspaceFolder!, FILE!));
        const token = /ref\(\s*["']([^"']+)["']\s*\)/.exec(document.getText());
        assert.ok(token, `${FILE} has no ref()`);
        const position = document.positionAt(token.index + token[0].indexOf(token[1]) + 1);
        let contents: string[] = [];
        for (let waited = 0; waited < 20_000 && contents.length === 0; waited += 500) {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, position);
            contents = (hovers ?? []).flatMap((hover) => hover.contents.map((content) => (typeof content === 'string' ? content : content.value))).filter(Boolean);
            if (contents.length === 0) {
                await sleep(500);
            }
        }
        assert.ok(contents.length > 0, `No hover over ref("${token[1]}")`);
        fs.writeFileSync(path.join(OUT!, 'hover.json'), JSON.stringify({ name: token[1], contents }, null, 1));
    });

    test('run', async function () {
        if (COMPILE_ONLY) {
            this.skip();
        }
        begin();
        if (slices.project?.backend === 'dbt') {
            const target = slices.file!.actions[0].target;
            assert.ok(await panel.dbtRunMessage({ command: 'run', actions: [target], includeDependencies: false, includeDependents: false, fullRefresh: false }), 'The panel shows no dbt file');
            await until('the dbt run', () => !!slices.run?.lastRun, 45_000);
        } else {
            await vscode.commands.executeCommand('vscode-dataform-tools.runCurrentFile');
            await until('the CLI run', () => {
                const run = (slices.dataform.workflowUrls ?? []).find((entry) => entry.executionMode === 'cli');
                return !!run?.state && ENDED_RUN_STATES.has(run.state);
            }, 5000);
        }
        save('run');
    });

    // The Changed list, with a model edited and a model added that are not committed. It is the last step: the
    // Project is put back as it was, and nothing after it sees the edits
    test('changed actions', async function () {
        if (COMPILE_ONLY) {
            this.skip();
        }
        const dbt = slices.project?.backend === 'dbt';
        const edited = path.join(workspaceFolder!, dbt ? 'models/int_signings.sql' : 'definitions/int_signings.sqlx');
        const added = path.join(workspaceFolder!, dbt ? 'models/fct_free_transfers.sql' : 'definitions/fct_free_transfers.sqlx');
        const before = fs.readFileSync(edited, 'utf8');
        const ref = dbt ? '{{ ref("int_signings") }}' : '${ref("int_signings")}';
        const header = dbt ? '{{ config(materialized="table") }}' : 'config {\n  type: "table",\n  description: "Signings that cost no fee",\n  tags: ["transfers"]\n}';
        const git = (...args: string[]) => execFileSync('git', args, { cwd: workspaceFolder! });
        try {
            // On a branch of its own, as work on a change is: the list then says what the branch is compared with
            git('checkout', '-q', '-b', 'feat/free-transfers');
            fs.writeFileSync(added, `${header}\n\nSELECT *\nFROM ${ref}\nWHERE transfer_fee = 0\n`);
            // The edit is saved in the editor, as a user's is: a save is what has the Project compiled again
            const compiledBefore = slices.compile?.compile ?? 0;
            const document = await vscode.workspace.openTextDocument(edited);
            await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            const at = document.getText().indexOf('players.position,');
            assert.ok(at >= 0, 'int_signings does not select players.position');
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, document.positionAt(at), 'players.date_of_birth,\n  ');
            await vscode.workspace.applyEdit(edit);
            await document.save();
            await until('the compile of the edit', () => slices.compile?.status === 'compiled' && slices.compile.compile > compiledBefore, 2000);
            begin();
            await (dbt ? panel.dbtMessage({ command: 'dbt.computeChangedActions' }) : panel.computeChangedActions());
            const changed = () => (dbt ? slices.dbt?.changedActions : slices.dataform.changedActions);
            await until('the changed actions', () => changed()?.status === 'ready' || changed()?.status === 'error', 2000);
            assert.strictEqual(changed()?.status, 'ready', `Run Changed gave: ${changed()?.error}`);
            assert.ok((changed()?.changed?.length ?? 0) >= 2, `Run Changed found: ${JSON.stringify(changed()?.changed)}`);
            fs.writeFileSync(path.join(OUT!, 'changed.json'), JSON.stringify(changed(), null, 1));
        } finally {
            fs.writeFileSync(edited, before);
            fs.rmSync(added, { force: true });
            git('checkout', '-q', 'main');
            git('branch', '-q', '-D', 'feat/free-transfers');
        }
    });
});
