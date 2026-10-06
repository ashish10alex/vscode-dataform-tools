import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { createDataformBackend } from '../../project/dataformBackend';
import { resolveDataformOptions } from '../../project/dataformOptions';
import { actionsInFile, dryRunScripts } from '../../shared/compiledGraph';
import { findProjectRoot } from './helper';

/*
 * The Dataform Backend with the extension's own compile behind it, on a copy of the test workspace. Needs the
 * Dataform CLI, as the other compile tests do. The test workspace has no unit test; dataformBackend.test.ts covers those.
 */
suite('Dataform Backend: compiling the test workspace with the CLI', function () {
    this.timeout(120_000);
    let root: string;
    let project: string;

    suiteSetup(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-backend-'));
        project = path.join(root, 'project');
        fs.cpSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'test-workspace'), project, { recursive: true });
    });

    suiteTeardown(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('gives the Compiled Graph and keeps the raw result', async () => {
        const backend = createDataformBackend();
        const { graph, errors } = await backend.compile({
            root: project,
            options: { ...resolveDataformOptions(project, 'cli'), persistCompilation: false },
            logger: { info: () => undefined, debug: () => undefined, error: () => undefined },
            signal: new AbortController().signal,
        });
        assert.deepStrictEqual(errors, []);
        const raw = backend.rawResult;
        assert.ok(raw, 'the raw result is kept');

        const kinds = new Set(Object.values(graph.actions).map((action) => action.kind));
        for (const kind of ['table', 'view', 'incremental', 'assertion', 'operation', 'declaration', 'notebook'] as const) {
            assert.ok(kinds.has(kind), `the test workspace has a ${kind}`);
        }
        assert.ok(!kinds.has('unknown'), 'every dependency is defined');

        // Every action the raw result lists is in the graph
        const rawCount = [raw.tables, raw.assertions, raw.operations, raw.declarations, raw.notebooks, raw.propertyGraphs, raw.tests]
            .reduce((count, items) => count + (items?.length ?? 0), 0);
        assert.strictEqual(Object.keys(graph.actions).length, rawCount);

        const incremental = Object.values(graph.actions).find((action) => action.kind === 'incremental')!;
        assert.ok(actionsInFile(graph, incremental.fileName).includes(incremental));
        assert.deepStrictEqual(dryRunScripts(incremental).map((script) => script.label), ['full', 'incremental']);
    });
});
