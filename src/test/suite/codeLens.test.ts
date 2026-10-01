import * as assert from 'assert';
import * as vscode from 'vscode';
import { suite, test } from 'mocha';
import { AssertionRunnerCodeLensProvider, TagsRunnerCodeLensProvider } from '../../codeLensProvider';

const sqlx = (content: string) => vscode.workspace.openTextDocument({ language: 'sqlx', content });
const lensLines = (lenses: vscode.CodeLens[]) => lenses.map((lens) => lens.range.start.line);

suite('codeLensProvider', () => {
    const text = [
        'config {',                                   // 0
        '  type: "table",',                           // 1
        '  tags: ["daily"],',                         // 2
        '  assertions: { nonNull: ["id"] }',          // 3
        '}',                                          // 4
        '-- tags and assertions in a comment',        // 5
        'SELECT tags, assertions FROM t',             // 6
    ].join('\n');

    test('offers Run Tag only on the tags key of the config block', async () => {
        const lenses = await new TagsRunnerCodeLensProvider().provideCodeLenses(await sqlx(text));
        assert.deepStrictEqual(lensLines(lenses), [2]);
    });

    test('offers Run assertions only on the assertions key of the config block', async () => {
        const lenses = await new AssertionRunnerCodeLensProvider().provideCodeLenses(await sqlx(text));
        assert.deepStrictEqual(lensLines(lenses), [3]);
    });

    test('offers Run assertion on an assertion action type', async () => {
        const lenses = await new AssertionRunnerCodeLensProvider().provideCodeLenses(await sqlx('config {\n  type: "assertion"\n}\nSELECT 1'));
        assert.deepStrictEqual(lenses.map((lens) => lens.command?.title), ['▶ Run assertion']);
    });

    test('offers nothing without a config block', async () => {
        assert.deepStrictEqual(await new TagsRunnerCodeLensProvider().provideCodeLenses(await sqlx('SELECT tags FROM t')), []);
    });
});
