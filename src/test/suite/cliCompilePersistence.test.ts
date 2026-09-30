import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { findProjectRoot } from './helper';

globalThis.isRunningOnWindows = process.platform === 'win32';
globalThis.compilerOptionsMap = {};
globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined;

import { compileDataform, ensureFreshCompilation, getDataformCliCmdBasedOnScope, getDataformCompilerOptions, isCompilationStale, prewarmCliCompilation, runCompilation } from '../../utils';
import { computeCompileFingerprint, initCliCompileCache, loadCliCompile, saveCliCompile } from '../../utils/cliCompileCache';
import { getCompilationInfo } from '../../utils/compilationInfo';

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
        const { compiledString } = await compileDataform(project);
        assert.ok(compiledString, 'the test workspace compiles');
        await saveCliCompile({ workspaceFolder: project, fingerprint, compiledAt: Date.now() - 60_000 }, compiledString);
    });

    suiteTeardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('unchanged project: the saved compilation is used without running the CLI', async () => {
        await prewarmCliCompilation(project);
        assert.ok(CACHED_COMPILED_DATAFORM_JSON, 'saved compilation loaded');
        assert.strictEqual(isCompilationStale(), false);
        assert.strictEqual(getCompilationInfo()?.fromCache, true);

        const started = performance.now();
        const { dataformCompiledJson, compilationTimeMs } = await runCompilation(project);
        assert.strictEqual(dataformCompiledJson, CACHED_COMPILED_DATAFORM_JSON);
        assert.strictEqual(compilationTimeMs, undefined, 'no CLI compile ran');
        assert.ok(performance.now() - started < 500);
    });

    test('changed project: the saved compilation is shown as outdated until the startup compile replaces it', async () => {
        // Next session, after a definition changed while VS Code was closed
        globalThis.CACHED_COMPILED_DATAFORM_JSON = undefined;
        const definition = path.join(project, 'definitions', '0100_CLUBS.sqlx');
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(definition, later, later);
        const savedAt = (await loadCliCompile(project))!.meta.compiledAt;

        await prewarmCliCompilation(project);
        const outdated = CACHED_COMPILED_DATAFORM_JSON;
        assert.ok(outdated, 'outdated compilation shown straight away');
        assert.strictEqual(isCompilationStale(), true);
        assert.match(getCompilationInfo()?.staleReason ?? '', /Project files changed/);

        // A run waits for, and joins, the compile started on activation
        await ensureFreshCompilation(project);
        assert.strictEqual(isCompilationStale(), false);
        assert.notStrictEqual(CACHED_COMPILED_DATAFORM_JSON, outdated);
        assert.strictEqual(getCompilationInfo()?.fromCache, false);

        // The fresh compilation replaces the saved one for the next session
        await waitFor(async () => ((await loadCliCompile(project))?.meta.compiledAt ?? 0) > savedAt);

        // Opening the panel now reuses the startup compile instead of compiling again
        const { dataformCompiledJson, compilationTimeMs } = await runCompilation(project);
        assert.strictEqual(dataformCompiledJson, CACHED_COMPILED_DATAFORM_JSON);
        assert.ok(compilationTimeMs !== undefined, 'the startup compile result, which did run the CLI');
    });
});
