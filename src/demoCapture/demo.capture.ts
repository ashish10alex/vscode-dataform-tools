import * as assert from 'assert';
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
});
