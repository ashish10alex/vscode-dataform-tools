import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { legacyStateReader } from '../shared/panelLegacyState';

/*
Recorded panel output: opens files of src/test/test-workspace in the real extension and compares what the
compiled query panel is sent with the JSON saved under src/panelRecordings/recordings.

It pins what the panel shows for a Dataform project while the code behind it is moved (see
docs/multi-backend-build-plan.md). A difference is either a regression, or an intended change: for those,
check the diff and run `just record-panel` to save the new output.

Only what comes from compiling the project is compared. Anything BigQuery, git or the clock decides is left
out (see `VOLATILE_KEYS`), so the recordings do not depend on credentials or on the machine.
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

/** Decided by BigQuery, git, stored state or the clock, not by compiling the project */
const VOLATILE_KEYS = new Set([
    'compiledQuerySchema', 'testDryRunResult', 'expectedOutputDryRunResult', 'modelsLastUpdateTimesMeta', 'tagDryRunStatsMeta',
    'compilationTimeMs', 'compilationInfo', 'lastRun', 'changedActions', 'apiRunGitState', 'deferral', 'deferToProd',
    'leftoverProxies', 'columnImpact', 'workflowUrls', 'snoozeEndTime', 'missingExecutables', 'propertyGraphValidations',
    'propertyGraphElementSchema', 'currencySymbol',
    // Sent only with a fresh compile, so it would depend on which file the suite opens first
    'compilationBackend',
]);
const isVolatile = (key: string) => VOLATILE_KEYS.has(key) || key.startsWith('dryRun');

type PanelState = Record<string, unknown>;

interface PanelApi {
    onDidPostMessage: vscode.Event<unknown>;
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

/** What is compared: the merged state without volatile keys, with this machine's paths replaced */
function normalise(state: PanelState, workspaceFolder: string): string {
    const kept = Object.fromEntries(Object.entries(state).filter(([key]) => !isVolatile(key)));
    const json = JSON.stringify(sortKeys(kept), null, 2);
    const asJsonString = (text: string) => JSON.stringify(text).slice(1, -1);
    return json.split(asJsonString(workspaceFolder)).join('<workspace>').split(asJsonString(fs.realpathSync(workspaceFolder))).join('<workspace>') + '\n';
}

suite('recorded panel output', function () {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    // The recordings live in the source tree, not next to the compiled test
    const recordingsDir = path.resolve(__dirname, '..', '..', '..', 'src', 'panelRecordings', 'recordings');
    let messages: PanelState[] = [];
    let subscription: vscode.Disposable | undefined;

    /** Merges the messages the way the panel's webview does, and waits until compile and dry run have both reported and nothing more arrives */
    async function panelStateAfter(trigger: () => Thenable<unknown>): Promise<PanelState> {
        messages = [];
        await trigger();
        const merged = () => Object.assign({}, ...messages) as PanelState;
        const deadline = Date.now() + 90 * 1000;
        let seen = -1;
        let quietSince = Date.now();
        while (Date.now() < deadline) {
            await sleep(100);
            if (messages.length !== seen) {
                seen = messages.length;
                quietSince = Date.now();
                continue;
            }
            const state = merged();
            const settled = seen > 0 && state.recompiling !== true && state.dryRunning !== true;
            if (settled && Date.now() - quietSince >= 2500) {
                return state;
            }
        }
        throw new Error(`The panel did not settle within 90s. Last state keys: ${Object.keys(merged()).join(', ')}`);
    }

    suiteSetup(async function () {
        assert.ok(workspaceFolder, 'No workspace folder: run with `vscode-test --label panel`');
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        const panel: PanelApi | undefined = (await extension.activate())?.__panel;
        assert.ok(panel, 'The extension does not expose __panel');
        const toLegacyState = legacyStateReader();
        subscription = panel.onDidPostMessage((message) => {
            if (message && typeof message === 'object') {
                // What the panel itself would merge: a slice is flattened as the panel flattens it
                messages.push(toLegacyState(message as PanelState));
            }
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
            const state = await panelStateAfter(async () => {
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
