import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import type { DataformBlock } from '../shared/panelContract';
import { PanelSlices, applyMessage, initialSlices } from '../shared/panelState';

/*
Recorded panel output: opens files of src/test/test-workspace in the real extension and compares what the
compiled query panel is sent with the JSON saved under src/panelRecordings/recordings.

What is recorded is the slices the panel ends with (src/shared/panelContract.ts), kept as the panel keeps them
(`applyMessage`). It pins what the panel is told of a Dataform project while the code behind it is moved (see
docs/multi-backend-build-plan.md). A difference is either a regression, or an intended change: for those, check the
diff and run `just record-panel` to save the new output.

Only what comes from compiling the project is compared. Anything BigQuery, git, stored state or the clock decides is
left out (see `recorded`), so the recordings do not depend on credentials or on the machine.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const UPDATE = process.env.UPDATE_PANEL_RECORDINGS === '1';

/** Files of the test workspace to record, by what they exercise */
const FILES: Record<string, string> = {
    'table-with-assertions': 'definitions/0100_GAMES_META.sqlx',
    'table-with-pre-operations': 'definitions/0200_PLAYER_TRANSFERS.sqlx',
    'view': 'definitions/0100_CLUBS.sqlx',
    'incremental': 'definitions/0300_INCREMENTAL.sqlx',
    'assertion': 'definitions/assertions/0100_CLUBS_ASSER.sqlx',
    'operations': 'definitions/0500_OPERATIONS.sqlx',
    'multiple-pre-post-operations': 'definitions/tests_for_vscode_extension/0100_MULTIPLE_PRE_POST_OPS.sqlx',
    'js-multiple-actions': 'definitions/010_JS_MULTIPLE.js',
    'js-declarations': 'definitions/sources.js',
    'includes-helper': 'includes/params.js',
    'project-settings': 'workflow_settings.yaml',
};

/** The fields of the `dataform` block that compiling the project decides. The rest come from BigQuery, git, stored state or the clock */
const COMPILED_DATAFORM_FIELDS = ['compilerOptions', 'dataformCoreVersion', 'projectConfig', 'packageJson', 'possibleResolutions', 'propertyGraphs', 'lineage'] as const satisfies ReadonlyArray<keyof DataformBlock>;

interface PanelApi {
    onDidPostMessage: vscode.Event<unknown>;
}

/**
 * What of the slices is compared. Left out: what BigQuery said (the `bigquery` slice and the columns kept from it),
 * when and how fast the compile ran, the number of the compile (it depends on which file the suite opens first),
 * and the fields of the `dataform` block that compiling does not decide.
 */
function recorded(slices: PanelSlices): Record<string, unknown> {
    const { compile: _fileCompile, ...file } = slices.file ?? { compile: 0 };
    const { compile: _projectCompile, ...project } = slices.project ?? { compile: 0 };
    const status = slices.compile;
    return {
        project: slices.project && project,
        file: slices.file && file,
        compile: status && { status: status.status, ...('errors' in status ? { errors: status.errors } : {}) },
        dataform: Object.fromEntries(COMPILED_DATAFORM_FIELDS.map((field) => [field, slices.dataform[field]])),
    };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortKeys);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
    }
    return value;
}

/** What is compared, as text: with keys in order and this machine's paths replaced */
function normalise(slices: PanelSlices, workspaceFolder: string): string {
    const json = JSON.stringify(sortKeys(recorded(slices)), null, 2);
    const asJsonString = (text: string) => JSON.stringify(text).slice(1, -1);
    return json.split(asJsonString(workspaceFolder)).join('<workspace>').split(asJsonString(fs.realpathSync(workspaceFolder))).join('<workspace>') + '\n';
}

suite('recorded panel output', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // The recordings live in the source tree, not next to the compiled test
    const recordingsDir = path.resolve(__dirname, '..', '..', '..', 'src', 'panelRecordings', 'recordings');
    let slices: PanelSlices = initialSlices();
    let seen = 0;
    let subscription: vscode.Disposable | undefined;

    /** Keeps the slices the way the panel does, and waits until compile and dry run have both reported and nothing more arrives */
    async function slicesAfter(trigger: () => Thenable<unknown>): Promise<PanelSlices> {
        // Each file is recorded as a panel that starts with it would have it, so a recording does not depend on the one before
        slices = initialSlices();
        seen = 0;
        await trigger();
        const deadline = Date.now() + 90 * 1000;
        let counted = -1;
        let quietSince = Date.now();
        while (Date.now() < deadline) {
            await sleep(100);
            if (seen !== counted) {
                counted = seen;
                quietSince = Date.now();
                continue;
            }
            const settled = seen > 0 && slices.compile?.status !== 'compiling' && (slices.bigquery?.dryRunning.length ?? 0) === 0;
            if (settled && Date.now() - quietSince >= 2500) {
                return slices;
            }
        }
        throw new Error(`The panel did not settle within 90s. It has: ${Object.keys(slices).join(', ')}`);
    }

    suiteSetup(async function () {
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label panel`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        const panel: PanelApi | undefined = (await extension.activate())?.__panel;
        assert.ok(panel, 'The extension does not expose __panel');
        subscription = panel.onDidPostMessage((message) => {
            slices = applyMessage(slices, message);
            seen++;
        });
        if (UPDATE) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }
    });

    suiteTeardown(function () {
        subscription?.dispose();
    });

    let panelOpen = false;
    for (const [name, relativePath] of Object.entries(FILES)) {
        test(`${name}: ${relativePath}`, async function () {
            const uri = vscode.Uri.file(path.join(workspaceFolder!, relativePath));
            const state = await slicesAfter(async () => {
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
                if (!panelOpen) {
                    // Opens the panel beside the editor; after that, switching editors re-renders it
                    panelOpen = true;
                    await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
                }
            });
            const actual = normalise(state, workspaceFolder!);
            const recordingPath = path.join(recordingsDir, `${name}.json`);
            if (UPDATE) {
                fs.writeFileSync(recordingPath, actual);
                return;
            }
            assert.ok(fs.existsSync(recordingPath), `No recording for ${name}: run \`just record-panel\``);
            assert.strictEqual(actual, fs.readFileSync(recordingPath, 'utf8'), `The panel output for ${relativePath} differs from its recording. If the change is intended, run \`just record-panel\``);
        });
    }
});
