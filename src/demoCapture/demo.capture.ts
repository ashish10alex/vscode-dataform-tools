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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RunMessage = Extract<PanelMessage, { command: 'run' }>;

interface PanelApi {
    onDidPostMessage: vscode.Event<unknown>;
    forgetSentSlices(): void;
    dbtRunMessage(message: RunMessage): Promise<boolean> | undefined;
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
        panel = (await extension.activate())?.__panel;
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
        begin();
        await vscode.commands.executeCommand('vscode-dataform-tools.showProjectInfo');
        await until('project info', () => !!slices.projectInfo && slices.projectInfo.sections.every((section) => !section.looking), 3000);
        save('project-info');
    });

    test('run', async function () {
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
