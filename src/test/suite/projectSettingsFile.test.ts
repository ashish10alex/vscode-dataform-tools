import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { projectFileSettings, settingsFileOf } from '../../project/settingsFile';

suite('the settings file of a Project', () => {
    let tmp: string;
    const project = (name: string, contents?: string) => {
        const root = path.join(tmp, name);
        fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
        if (contents !== undefined) {
            fs.writeFileSync(settingsFileOf(root), contents);
        }
        return root;
    };

    suiteSetup(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-settings-')));
    });

    suiteTeardown(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('gives the extension\'s settings by their names, and no other', () => {
        const root = project('plain', JSON.stringify({
            'vscode-dataform-tools.compilerOptions': '--schema-suffix="SANDBOX"',
            'vscode-dataform-tools.skipPreOpsInDryRun': true,
            'vscode-dataform-tools.formatOrdering': ['js', 'sql'],
            'workbench.colorTheme': 'Quiet Light',
        }));
        assert.deepStrictEqual(projectFileSettings(root), { compilerOptions: '--schema-suffix="SANDBOX"', skipPreOpsInDryRun: true, formatOrdering: ['js', 'sql'] });
    });

    test('reads comments and trailing commas, as VS Code does', () => {
        const root = project('jsonc', '{\n  // the repository\n  "vscode-dataform-tools.gitRepoName": "DP0021",\n  "vscode-dataform-tools.formatOrdering": ["js", "sql",],\n}\n');
        assert.deepStrictEqual(projectFileSettings(root), { gitRepoName: 'DP0021', formatOrdering: ['js', 'sql'] });
    });

    test('comment marks and commas inside a string are part of the string', () => {
        const root = project('strings', '{ /* a */ "vscode-dataform-tools.compilerOptions": "--vars=a=http://x,]\\"//y", // b\n "vscode-dataform-tools.gitRepoName": "a,}" , /* c */ }');
        assert.deepStrictEqual(projectFileSettings(root), { compilerOptions: '--vars=a=http://x,]"//y', gitRepoName: 'a,}' });
    });

    test('no file, or one that is not an object, gives no settings', () => {
        assert.deepStrictEqual(projectFileSettings(project('none')), {});
        assert.deepStrictEqual(projectFileSettings(project('list', '[1, 2]')), {});
        assert.deepStrictEqual(projectFileSettings(project('empty', '')), {});
    });

    test('a change to the file is read, and so is its removal', () => {
        const root = project('changing', '{ "vscode-dataform-tools.gitRepoName": "one" }');
        assert.deepStrictEqual(projectFileSettings(root), { gitRepoName: 'one' });
        fs.writeFileSync(settingsFileOf(root), '{ "vscode-dataform-tools.gitRepoName": "another" }');
        assert.deepStrictEqual(projectFileSettings(root), { gitRepoName: 'another' });
        fs.rmSync(settingsFileOf(root));
        assert.deepStrictEqual(projectFileSettings(root), {});
    });
});
