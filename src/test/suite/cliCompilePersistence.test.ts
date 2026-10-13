import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { findProjectRoot } from './helper';

globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.compilerOptionsMap = {};

import { compileDataform, ensureFreshCompilation, getDataformCliCmdBasedOnScope, isCompilationStale, prewarmCliCompilation, runCompilation } from '../../utils';
import { computeCompileFingerprint, initCliCompileCache, loadCliCompile, saveCliCompile } from '../../utils/cliCompileCache';
import { getCompilationInfo } from '../../utils/compilationInfo';
import { clearCompiled, compiledJson } from '../../project';
import { getDataformCompilerOptions, resolveDataformOptions } from '../../project/dataformOptions';

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000) {
    const start = Date.now();
    while (!(await condition())) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('Timed out');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/*
 * Walks through two VS Code starts against a copy of the test workspace, with the real Dataform CLI: one where
 * the project is unchanged since its saved compilation and one where a definition changed in between.
 * The steps depend on each other, as the compile state lives in module variables for the whole session.
 */
suite('CLI compilation persisted across sessions', function () {
    this.timeout(120_000);
    let root: string;
    let project: string;

    suiteSetup(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-persist-'));
        project = path.join(root, 'project');
        fs.cpSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'test-workspace'), project, { recursive: true });
        initCliCompileCache({ globalStorageUri: vscode.Uri.file(path.join(root, 'storage')) } as vscode.ExtensionContext);

        // What an earlier session left behind
        const fingerprint = await computeCompileFingerprint(project, getDataformCliCmdBasedOnScope(project), getDataformCompilerOptions());
        const { compiledString } = await compileDataform(project, resolveDataformOptions(project));
        assert.ok(compiledString, 'the test workspace compiles');
        await saveCliCompile({ workspaceFolder: project, fingerprint, compiledAt: Date.now() - 60_000 }, compiledString);
    });

    suiteTeardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('unchanged project: the saved compilation is used without running the CLI', async () => {
        await prewarmCliCompilation(project, resolveDataformOptions(project));
        assert.ok(compiledJson(project), 'saved compilation loaded');
        assert.strictEqual(isCompilationStale(), false);
        assert.strictEqual(getCompilationInfo(project)?.fromCache, true);

        const started = performance.now();
        const { dataformCompiledJson, compilationTimeMs } = await runCompilation(project, resolveDataformOptions(project));
        assert.strictEqual(dataformCompiledJson, compiledJson(project));
        assert.strictEqual(compilationTimeMs, undefined, 'no CLI compile ran');
        assert.ok(performance.now() - started < 500);
    });

    test('changed project: the saved compilation is shown as outdated until the startup compile replaces it', async () => {
        // Next session, after a definition changed while VS Code was closed
        clearCompiled(project);
        const definition = path.join(project, 'definitions', '0100_CLUBS.sqlx');
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(definition, later, later);
        const savedAt = (await loadCliCompile(project))!.meta.compiledAt;

        await prewarmCliCompilation(project, resolveDataformOptions(project));
        const outdated = compiledJson(project);
        assert.ok(outdated, 'outdated compilation shown straight away');
        assert.strictEqual(isCompilationStale(), true);
        assert.match(getCompilationInfo(project)?.staleReason ?? '', /Project files changed/);

        // A run waits for, and joins, the compile started on activation
        await ensureFreshCompilation(project, resolveDataformOptions(project));
        assert.strictEqual(isCompilationStale(), false);
        assert.notStrictEqual(compiledJson(project), outdated);
        assert.strictEqual(getCompilationInfo(project)?.fromCache, false);

        // The fresh compilation replaces the saved one for the next session
        await waitFor(async () => ((await loadCliCompile(project))?.meta.compiledAt ?? 0) > savedAt);

        // Opening the panel now reuses the startup compile instead of compiling again
        const { dataformCompiledJson, compilationTimeMs } = await runCompilation(project, resolveDataformOptions(project));
        assert.strictEqual(dataformCompiledJson, compiledJson(project));
        assert.ok(compilationTimeMs !== undefined, 'the startup compile result, which did run the CLI');
    });

    test('edited project: a compile of unchanged files reuses the last one instead of running the CLI', async () => {
        const definition = path.join(project, 'definitions', '0100_CLUBS.sqlx');
        const later = new Date(Date.now() + 120_000);
        fs.utimesSync(definition, later, later);

        const edited = await runCompilation(project, resolveDataformOptions(project));
        assert.ok(edited.dataformCompiledJson, 'the edit is compiled');
        const compiledAt = getCompilationInfo(project)?.compiledAt;

        // e.g. Run Changed compiling right after the panel compiled the saved file
        const started = performance.now();
        const { dataformCompiledJson } = await runCompilation(project, resolveDataformOptions(project));
        assert.strictEqual(dataformCompiledJson, edited.dataformCompiledJson);
        assert.strictEqual(getCompilationInfo(project)?.compiledAt, compiledAt, 'no CLI compile ran');
        assert.ok(performance.now() - started < 500);
    });

    test('saving again mid-compile stops the earlier compile and hands its caller the later result', async () => {
        const definition = path.join(project, 'definitions', '0100_CLUBS.sqlx');
        fs.utimesSync(definition, new Date(Date.now() + 180_000), new Date(Date.now() + 180_000));
        const first = runCompilation(project, resolveDataformOptions(project));
        await new Promise((resolve) => setTimeout(resolve, 300)); // the first CLI compile is running

        fs.utimesSync(definition, new Date(Date.now() + 240_000), new Date(Date.now() + 240_000));
        const second = runCompilation(project, resolveDataformOptions(project));

        const [earlier, later] = await Promise.all([first, second]);
        assert.ok(later.dataformCompiledJson, 'the later save is compiled');
        assert.strictEqual(earlier.dataformCompiledJson, later.dataformCompiledJson, 'the earlier caller gets the later compilation');
        assert.strictEqual(compiledJson(project), later.dataformCompiledJson);
    });
});
