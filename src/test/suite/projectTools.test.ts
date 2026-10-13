import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { requiredTools } from '../../project/tools';
import { clearExecutablePathCache, resolveExecutable } from '../../utils/executableResolver';

suite('requiredTools', () => {
    test('a Dataform Project needs the Dataform CLI, and nothing else', () => {
        assert.deepStrictEqual(requiredTools('dataform'), ['dataform']);
        assert.deepStrictEqual(requiredTools('dataform', { compilationMode: 'cli' }), ['dataform']);
    });

    test('a Dataform Project compiled with the API needs no tool', () => {
        assert.deepStrictEqual(requiredTools('dataform', { compilationMode: 'api' }), []);
    });

    test('a dbt Project needs dbt, whatever the Compilation Mode says', () => {
        assert.deepStrictEqual(requiredTools('dbt'), ['dbt']);
        assert.deepStrictEqual(requiredTools('dbt', { compilationMode: 'api' }), ['dbt']);
    });

    test('gcloud is never required', () => {
        const everything = [requiredTools('dataform'), requiredTools('dataform', { compilationMode: 'api' }), requiredTools('dbt')].flat();
        assert.ok(!(everything as string[]).includes('gcloud'));
    });
});

suite('resolveExecutable', () => {
    let tmp: string;

    suiteSetup(() => {
        globalThis.isRunningOnWindows = process.platform === 'win32';
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-executable-')));
        clearExecutablePathCache();
    });

    suiteTeardown(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
        clearExecutablePathCache();
    });

    test('says which step found an executable', () => {
        // Whatever shell runs the tests is on PATH or in a common location
        const found = resolveExecutable(process.platform === 'win32' ? 'cmd' : 'sh');
        assert.ok(found.path, 'the shell is found');
        assert.ok(found.foundBy === 'path' || found.foundBy === 'commonLocation', `found by ${found.foundBy}`);
    });

    test('gives no step for an executable that is not installed', () => {
        assert.deepStrictEqual(resolveExecutable('no-such-tool-for-the-resolver-test'), { path: null, foundBy: undefined });
    });

    test('keeps a separate answer per Project', () => {
        const one = path.join(tmp, 'one');
        const other = path.join(tmp, 'other');
        fs.mkdirSync(one);
        fs.mkdirSync(other);
        const name = 'no-such-tool-for-the-resolver-test';
        assert.strictEqual(resolveExecutable(name, one).path, null);
        assert.strictEqual(resolveExecutable(name, other).path, null);
        assert.strictEqual(resolveExecutable(name).path, null);
    });
});
