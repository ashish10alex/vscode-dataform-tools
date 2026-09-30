import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, test, suiteSetup, suiteTeardown } from 'mocha';
import { CompileFingerprint, computeCompileFingerprint, fingerprintsMatch, staleReason } from '../../utils/cliCompileCache';

suite('cliCompileCache.computeCompileFingerprint', () => {
    let project: string;
    let cliPath: string;

    suiteSetup(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'df-fingerprint-'));
        fs.mkdirSync(path.join(project, 'definitions', 'staging'), { recursive: true });
        fs.mkdirSync(path.join(project, 'includes'));
        fs.writeFileSync(path.join(project, 'workflow_settings.yaml'), 'defaultProject: p\n');
        fs.writeFileSync(path.join(project, 'definitions', 'staging', 'a.sqlx'), 'select 1');
        fs.writeFileSync(path.join(project, 'includes', 'helpers.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(project, 'README.md'), '# readme');

        // A CLI installed the way npm does it: the executable resolves into the @dataform/cli package
        const cliPackage = path.join(project, 'cli', 'node_modules', '@dataform', 'cli');
        fs.mkdirSync(path.join(cliPackage, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(cliPackage, 'package.json'), JSON.stringify({ name: '@dataform/cli', version: '3.0.26' }));
        fs.writeFileSync(path.join(cliPackage, 'bin', 'dataform.js'), '');
        cliPath = path.join(cliPackage, 'bin', 'dataform.js');
    });

    suiteTeardown(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    const touch = (relativePath: string, content: string) => {
        const file = path.join(project, relativePath);
        fs.writeFileSync(file, content);
        const later = new Date(Date.now() + 60_000);
        fs.utimesSync(file, later, later);
    };

    test('is stable while nothing changes', async () => {
        const first = await computeCompileFingerprint(project, cliPath, '');
        const second = await computeCompileFingerprint(project, cliPath, '');
        assert.ok(fingerprintsMatch(first, second));
    });

    test('reads the CLI version from its package.json', async () => {
        const fingerprint = await computeCompileFingerprint(project, cliPath, '');
        assert.strictEqual(fingerprint.cli, `${cliPath}\t3.0.26`);
    });

    test('changes when a file in definitions changes', async () => {
        const before = await computeCompileFingerprint(project, cliPath, '');
        touch(path.join('definitions', 'staging', 'a.sqlx'), 'select 2');
        const after = await computeCompileFingerprint(project, cliPath, '');
        assert.notStrictEqual(before.files, after.files);
    });

    test('changes when a file is added to includes', async () => {
        const before = await computeCompileFingerprint(project, cliPath, '');
        fs.writeFileSync(path.join(project, 'includes', 'constants.js'), 'module.exports = {};');
        const after = await computeCompileFingerprint(project, cliPath, '');
        assert.notStrictEqual(before.files, after.files);
    });

    test('changes when the project settings change', async () => {
        const before = await computeCompileFingerprint(project, cliPath, '');
        touch('workflow_settings.yaml', 'defaultProject: other\n');
        const after = await computeCompileFingerprint(project, cliPath, '');
        assert.notStrictEqual(before.files, after.files);
    });

    test('ignores files the CLI does not read', async () => {
        const before = await computeCompileFingerprint(project, cliPath, '');
        touch('README.md', '# changed readme');
        const after = await computeCompileFingerprint(project, cliPath, '');
        assert.ok(fingerprintsMatch(before, after));
    });

    test('changes with the compiler options', async () => {
        const before = await computeCompileFingerprint(project, cliPath, '');
        const after = await computeCompileFingerprint(project, cliPath, '--schema-suffix=dev');
        assert.ok(!fingerprintsMatch(before, after));
    });
});

suite('cliCompileCache.staleReason', () => {
    const saved: CompileFingerprint = { files: 'abc', cli: '/usr/bin/dataform\t3.0.26', options: '', day: '2026-09-30' };

    test('is undefined for an identical fingerprint', () => {
        assert.strictEqual(staleReason(saved, { ...saved }), undefined);
    });

    test('names what changed', () => {
        assert.match(staleReason(saved, { ...saved, files: 'def' })!, /Project files changed/);
        assert.match(staleReason(saved, { ...saved, cli: '/usr/bin/dataform\t3.0.27' })!, /Dataform CLI changed/);
        assert.match(staleReason(saved, { ...saved, options: '--vars=a=1' })!, /compilerOptions changed/);
        assert.match(staleReason(saved, { ...saved, day: '2026-10-01' })!, /earlier day/);
    });
});
