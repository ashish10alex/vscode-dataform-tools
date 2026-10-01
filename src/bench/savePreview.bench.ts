import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { execFileSync } from 'child_process';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import type { PerfSnapshot, PerfSpan } from '../perf';

/*
Run with `just bench`, not directly: it generates the synthetic project, opens it as the workspace
(BENCH_WORKSPACE) and writes the results JSON (BENCH_OUT). Measures activation, the startup compile,
save -> compiled preview and editor switch -> compiled preview, with a per-phase breakdown and the number
of git processes, BigQuery calls and CLI compiles each one costs.
*/

const EXTENSION_ID = 'ashishalex.dataform-lsp-vscode';
const ITERATIONS = Number(process.env.BENCH_ITERATIONS || 10);
const PHASES = ['compile', 'fileMetadata', 'deferral', 'dryRuns', 'lastModified', 'schemaFetch', 'gitState', 'render'];
const DEBOUNCE_MS = 750; // globalThis.DEBOUNCE_WAIT: before the save / switch handlers run, not in the timings

interface PerfApi {
    getPerfSnapshot(): PerfSnapshot;
    resetPerf(): void;
}

interface IterationResult {
    totalMs: number;
    phases: Record<string, number>;
    phaseCounts: Record<string, number>;
    counters: Record<string, number>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(what: string, probe: () => T | undefined, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = probe();
        if (value !== undefined) {
            return value;
        }
        await sleep(50);
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

function diffCounters(before: Record<string, number>, after: Record<string, number>): Record<string, number> {
    const diff: Record<string, number> = {};
    for (const [name, value] of Object.entries(after)) {
        const delta = value - (before[name] ?? 0);
        if (delta > 0) {
            diff[name] = delta;
        }
    }
    return diff;
}

/** Background work (git state, changed actions, deferral) keeps going after the preview renders: wait until the counters stop moving */
async function waitForQuiet(perf: PerfApi, quietMs = 1500, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last = JSON.stringify(perf.getPerfSnapshot().counters);
    let quietSince = Date.now();
    while (Date.now() < deadline) {
        await sleep(100);
        const current = JSON.stringify(perf.getPerfSnapshot().counters);
        if (current !== last) {
            last = current;
            quietSince = Date.now();
        } else if (Date.now() - quietSince >= quietMs) {
            return;
        }
    }
}

/** Runs `trigger`, waits for a new span called `spanName`, and attributes everything recorded until things go quiet to it */
async function measure(perf: PerfApi, spanName: string, trigger: () => Promise<void>): Promise<IterationResult> {
    await waitForQuiet(perf);
    const before = perf.getPerfSnapshot();
    // Spans are recorded when they end, so the cut-off is the latest end, not the last recorded span's start
    const since = Math.max(0, ...before.spans.map((span) => span.start + span.ms));
    const isNew = (span: PerfSpan) => span.start > since;
    await trigger();
    const span = await waitFor(spanName, () => perf.getPerfSnapshot().spans.find((s) => s.name === spanName && isNew(s)), 5 * 60 * 1000);
    await waitForQuiet(perf);
    const after = perf.getPerfSnapshot();
    const phases: Record<string, number> = {};
    const phaseCounts: Record<string, number> = {};
    for (const s of after.spans.filter(isNew)) {
        if (PHASES.includes(s.name)) {
            phases[s.name] = (phases[s.name] ?? 0) + s.ms;
            phaseCounts[s.name] = (phaseCounts[s.name] ?? 0) + 1;
        }
    }
    return { totalMs: span.ms, phases, phaseCounts, counters: diffCounters(before.counters, after.counters) };
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function summarise(iterations: IterationResult[]) {
    const names = (key: 'phases' | 'phaseCounts' | 'counters') => [...new Set(iterations.flatMap((it) => Object.keys(it[key])))];
    const medianOf = (key: 'phases' | 'phaseCounts' | 'counters') => Object.fromEntries(names(key).map((name) => [name, percentile(iterations.map((it) => it[key][name] ?? 0), 0.5)]));
    const totals = iterations.map((it) => it.totalMs);
    return { medianMs: percentile(totals, 0.5), p90Ms: percentile(totals, 0.9), phaseMediansMs: medianOf('phases'), phaseCountMedians: medianOf('phaseCounts'), counterMedians: medianOf('counters') };
}

suite('bench: save and switch -> compiled preview', function () {
    const workspace = process.env.BENCH_WORKSPACE;
    let perf: PerfApi;
    let manifest: { actions: number; coreVersion: string; placeholderProject: boolean; saveFile: string; switchFiles: string[] };
    const results: Record<string, unknown> = {};

    suiteSetup(async function () {
        assert.ok(workspace, 'BENCH_WORKSPACE is not set: run `just bench`');
        manifest = JSON.parse(fs.readFileSync(path.join(workspace, 'bench-manifest.json'), 'utf8'));
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
        const exports = await extension.activate();
        perf = exports?.__perf;
        assert.ok(perf, 'The extension does not expose __perf');
    });

    test('activation and startup compile', async function () {
        const startup = await waitFor('the startup compile', () => perf.getPerfSnapshot().spans.find((s) => s.name === 'startup.compile'), 10 * 60 * 1000);
        const activate = perf.getPerfSnapshot().spans.find((s) => s.name === 'activate');
        results.activation = { activateMs: activate?.ms, startupCompileMs: startup.ms, startupCompileSource: startup.attrs?.source };
    });

    test('save -> compiled preview', async function () {
        const uri = vscode.Uri.file(path.join(workspace!, manifest.saveFile));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
        await measure(perf, 'render', async () => {
            await vscode.commands.executeCommand('vscode-dataform-tools.showCompiledQueryWtDryRun');
        });

        const original = document.getText();
        const iterations: IterationResult[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            iterations.push(await measure(perf, 'savePreview', async () => {
                // A real content change each time, so the compile cache cannot skip the CLI
                const edit = new vscode.WorkspaceEdit();
                const text = i % 2 === 0 ? `${original}\n-- bench ${i}\n` : original;
                edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), text);
                await vscode.workspace.applyEdit(edit);
                await document.save();
            }));
        }
        results.save = { iterations, ...summarise(iterations) };
    });

    test('editor switch -> compiled preview', async function () {
        const iterations: IterationResult[] = [];
        for (let i = 0; i < ITERATIONS; i++) {
            const file = manifest.switchFiles[i % manifest.switchFiles.length];
            iterations.push(await measure(perf, 'switchPreview', async () => {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace!, file)));
                await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: false });
            }));
        }
        results.switch = { iterations, ...summarise(iterations) };
    });

    suiteTeardown(function () {
        const out = process.env.BENCH_OUT;
        if (!out) {
            return;
        }
        const repoRoot = path.resolve(__dirname, '..', '..', '..');
        const bundleJson = process.env.BENCH_BUNDLE_JSON;
        const report = {
            meta: {
                commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
                version: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version,
                date: new Date().toISOString(),
                vscode: vscode.version,
                actions: manifest?.actions,
                coreVersion: manifest?.coreVersion,
                placeholderProject: manifest?.placeholderProject,
                iterations: ITERATIONS,
                debounceMsExcluded: DEBOUNCE_MS,
            },
            bundle: bundleJson && fs.existsSync(bundleJson) ? JSON.parse(fs.readFileSync(bundleJson, 'utf8')) : undefined,
            ...results,
        };
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    });
});
