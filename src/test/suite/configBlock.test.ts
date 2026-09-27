import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { findConfigBlockRange, getLocationAt, parseConfigBlock } from '../../configBlock/parser';
import { closestMatch, getActionType, validateConfigBlock } from '../../configBlock/validator';
import { getTopLevelKeys } from '../../configBlock/schema';
import { CONFIG_DIAGNOSTIC_SOURCE, registerConfigBlockFeatures } from '../../configBlock/providers';
import { findProjectRoot } from './helper';

const parse = (text: string) => {
    const parsed = parseConfigBlock(text);
    assert.ok(parsed, 'expected a config block');
    return parsed;
};

const issuesFor = (text: string) => validateConfigBlock(parse(text));
const codes = (text: string) => issuesFor(text).map(issue => issue.code);

suite('configBlock.parser', () => {
    test('finds the config block, ignoring braces in strings and comments', () => {
        const text = '-- config { in sql comment\nconfig {\n  description: "has } brace", // and }\n  tags: ["a"]\n}\nSELECT "{"';
        const range = findConfigBlockRange(text);
        assert.ok(range);
        assert.strictEqual(text.slice(range.start, range.end), '{\n  description: "has } brace", // and }\n  tags: ["a"]\n}');
    });

    test('returns undefined without a config block or with an unclosed one', () => {
        assert.strictEqual(parseConfigBlock('SELECT 1'), undefined);
        assert.strictEqual(parseConfigBlock('config {\n  type: "table",\nSELECT 1'), undefined);
    });

    test('maps keys and values to document offsets', () => {
        const text = 'config {\n  type: "table",\n  "partitionBy": "DATE(ts)",\n  bigquery: { labels: { a: "b" } }\n}';
        const { root } = parse(text);
        const [type, partitionBy, bigquery] = root.properties;
        assert.strictEqual(text.slice(type.keyStart, type.keyEnd), 'type');
        assert.strictEqual(text.slice(partitionBy.keyStart, partitionBy.keyEnd), 'partitionBy');
        assert.strictEqual(partitionBy.value.kind, 'string');
        assert.strictEqual(text.slice(partitionBy.value.start, partitionBy.value.end), '"DATE(ts)"');
        assert.strictEqual(bigquery.value.kind, 'object');
    });

    test('marks spreads and non-literal values as dynamic', () => {
        const { root } = parse('config {\n  ...dataform.projectConfig.vars,\n  schema: dataform.projectConfig.vars.schema,\n  name: `t_${x}`\n}');
        assert.strictEqual(root.hasDynamicKeys, true);
        assert.deepStrictEqual(root.properties.map(p => p.value.kind), ['dynamic', 'dynamic']);
    });

    test('getLocationAt reports key and value positions and nested paths', () => {
        const text = 'config {\n  type: "incremental",\n  onSchemaChange: "EX",\n  assertions: {\n    non\n  }\n}';
        const parsed = parse(text);

        const value = getLocationAt(parsed, text.indexOf('"EX"') + 2);
        assert.strictEqual(value?.position, 'value');
        assert.strictEqual(value?.key, 'onSchemaChange');
        assert.strictEqual(value?.inString, true);

        const nestedKey = getLocationAt(parsed, text.indexOf('non') + 3);
        assert.strictEqual(nestedKey?.position, 'key');
        assert.deepStrictEqual(nestedKey?.path, ['assertions']);
        assert.strictEqual(nestedKey?.key, 'non');

        assert.strictEqual(getLocationAt(parsed, text.length), undefined);
    });
});

suite('configBlock.validator', () => {
    test('valid configs have no issues', () => {
        const configs = [
            'config { type: "table", schema: "s", database: "p", description: "d", tags: ["a"], dependencies: ["x"], partitionBy: "DATE(ts)", requirePartitionFilter: true, clusterBy: ["a"], assertions: { uniqueKey: ["id"], nonNull: "id", rowConditions: ["id > 0"] } }',
            'config { type: "incremental", uniqueKey: ["id"], protected: true, onSchemaChange: "extend", incrementalStrategy: "MERGE", bigquery: { partitionBy: "d", updatePartitionFilter: "x", partitionExpirationDays: 3 } }',
            'config { type: "view", materialized: true, bigquery: { labels: { team: "x" } }, columns: { id: "The id", addr: { description: "a", columns: { city: "c" }, bigqueryPolicyTags: ["t"] } } }',
            'config { type: "operations", hasOutput: true }',
            'config { type: "assertion", schema: "s" }',
            'config { type: "declaration", database: "p", schema: "s", name: "t" }',
            'config { type: "test", dataset: "my_table" }',
            'config { hasOutput: true }',
        ];
        for (const config of configs) {
            assert.deepStrictEqual(issuesFor(config), [], config);
        }
    });

    test('flags unknown keys with a suggestion', () => {
        const [issue] = issuesFor('config { type: "table", partitonBy: "d" }');
        assert.strictEqual(issue.code, 'unknown-key');
        assert.strictEqual(issue.replacement, 'partitionBy');
        assert.match(issue.message, /Did you mean "partitionBy"\?/);
    });

    test('flags keys that belong to another action type', () => {
        const [issue] = issuesFor('config { type: "view", uniqueKey: ["id"] }');
        assert.strictEqual(issue.code, 'key-not-for-type');
        assert.match(issue.message, /incremental/);
    });

    test('checks nested objects', () => {
        assert.deepStrictEqual(codes('config { type: "table", assertions: { nonNul: ["a"] } }'), ['unknown-key']);
        assert.deepStrictEqual(codes('config { type: "table", columns: { a: { descripton: "x" } } }'), ['unknown-key']);
        assert.deepStrictEqual(codes('config { type: "view", bigquery: { requirePartitionFilter: true } }'), ['key-not-for-type']);
        // Free form objects are not checked.
        assert.deepStrictEqual(codes('config { type: "table", bigquery: { labels: { anything: "x" } } }'), []);
    });

    test('flags invalid enum values', () => {
        const [typeIssue] = issuesFor('config { type: "incremntal" }');
        assert.strictEqual(typeIssue.code, 'invalid-enum');
        assert.strictEqual(typeIssue.replacement, 'incremental');

        const [schemaChange] = issuesFor('config { type: "incremental", onSchemaChange: "EXTND" }');
        assert.strictEqual(schemaChange.replacement, 'EXTEND');
    });

    test('flags unambiguous value type mismatches only', () => {
        assert.deepStrictEqual(codes('config { type: "table", disabled: "yes" }'), ['wrong-value-kind']);
        assert.deepStrictEqual(codes('config { type: "table", description: true }'), ['wrong-value-kind']);
        // Legacy string forms of array options are accepted by core.
        assert.deepStrictEqual(codes('config { type: "table", assertions: { uniqueKey: "id" } }'), []);
    });

    test('flags partition options without partitionBy', () => {
        assert.deepStrictEqual(codes('config { type: "table", requirePartitionFilter: true }'), ['partition-options-without-partitionBy']);
        assert.deepStrictEqual(codes('config { type: "table", bigquery: { partitionExpirationDays: 3 } }'), ['partition-options-without-partitionBy']);
    });

    test('flags duplicate keys', () => {
        assert.deepStrictEqual(codes('config { type: "table", tags: ["a"], tags: ["b"] }'), ['duplicate-key']);
    });

    test('falls back to all known keys when type is not a literal', () => {
        const text = 'config { type: dataform.projectConfig.vars.type, uniqueKey: ["id"], partitonBy: "d" }';
        assert.strictEqual(getActionType(parse(text)), undefined);
        assert.deepStrictEqual(codes(text), ['unknown-key']);
    });

    test('skipKeyChecks only reports value issues', () => {
        const parsed = parse('config { type: "view", uniqueKey: ["id"], someV2Key: true, disabled: "no" }');
        assert.deepStrictEqual(validateConfigBlock(parsed, { skipKeyChecks: true }).map(i => i.code), ['wrong-value-kind']);
    });

    test('removal ranges delete the whole line and its comma', () => {
        const text = 'config {\n  type: "view",\n  uniqueKey: ["id"],\n  tags: ["a"]\n}';
        const [issue] = issuesFor(text);
        assert.ok(issue.removal);
        const fixed = text.slice(0, issue.removal.start) + text.slice(issue.removal.end);
        assert.strictEqual(fixed, 'config {\n  type: "view",\n  tags: ["a"]\n}');
    });

    test('removal of a last property on a shared line removes the preceding comma', () => {
        const text = 'config { type: "view", uniqueKey: ["id"] }';
        const [issue] = issuesFor(text);
        assert.ok(issue.removal);
        const fixed = text.slice(0, issue.removal.start) + text.slice(issue.removal.end);
        assert.strictEqual(fixed, 'config { type: "view" }');
    });

    test('closestMatch only suggests plausible typos', () => {
        assert.strictEqual(closestMatch('partitonBy', ['partitionBy', 'clusterBy']), 'partitionBy');
        assert.strictEqual(closestMatch('PARTITIONBY', ['partitionBy']), 'partitionBy');
        assert.strictEqual(closestMatch('xyz', ['partitionBy', 'clusterBy']), undefined);
    });

    test('schema includes proto keys, legacy aliases and type', () => {
        const keys = getTopLevelKeys('incremental');
        for (const key of ['type', 'uniqueKey', 'onSchemaChange', 'schema', 'dataset', 'database', 'project', 'dependencies', 'bigquery', 'protected']) {
            assert.ok(keys.has(key), key);
        }
        assert.strictEqual(getTopLevelKeys('view').has('protected'), false);
        assert.strictEqual(getTopLevelKeys('declaration').has('dependencies'), false);
    });

    test('test workspace configs have no issues', () => {
        const workspace = path.join(findProjectRoot(__dirname), 'src', 'test', 'test-workspace', 'definitions');
        const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
            entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.sqlx') ? [path.join(dir, entry.name)] : []);
        const files = walk(workspace);
        assert.ok(files.length > 0);
        for (const file of files) {
            const parsed = parseConfigBlock(fs.readFileSync(file, 'utf8'));
            if (parsed) {
                assert.deepStrictEqual(validateConfigBlock(parsed), [], file);
            }
        }
    });
});

suite('configBlock.providers', () => {
    const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;

    suiteSetup(() => registerConfigBlockFeatures(context));
    suiteTeardown(() => context.subscriptions.forEach(d => d.dispose()));

    const openSqlx = (content: string) => vscode.workspace.openTextDocument({ language: 'sqlx', content });

    async function waitForConfigDiagnostics(uri: vscode.Uri): Promise<vscode.Diagnostic[]> {
        for (let i = 0; i < 50; i++) {
            const diagnostics = vscode.languages.getDiagnostics(uri).filter(d => d.source === CONFIG_DIAGNOSTIC_SOURCE);
            if (diagnostics.length > 0) {
                return diagnostics;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return [];
    }

    test('reports warnings and fixes a typo with a quick fix', async () => {
        const document = await openSqlx('config {\n  type: "table",\n  partitonBy: "DATE(ts)"\n}\nSELECT 1');
        const [diagnostic] = await waitForConfigDiagnostics(document.uri);
        assert.ok(diagnostic, 'expected a config diagnostic');
        assert.strictEqual(diagnostic.severity, vscode.DiagnosticSeverity.Warning);

        const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', document.uri, diagnostic.range);
        const fix = actions.find(action => action.title === 'Change to "partitionBy"');
        assert.ok(fix?.edit, 'expected the rename quick fix');
        await vscode.workspace.applyEdit(fix.edit);
        assert.strictEqual(document.getText(), 'config {\n  type: "table",\n  partitionBy: "DATE(ts)"\n}\nSELECT 1');
    });

    test('skips key checks in Dataform 2.x projects', async () => {
        const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataform-v2-'));
        try {
            fs.writeFileSync(path.join(projectDir, 'dataform.json'), '{}');
            fs.mkdirSync(path.join(projectDir, 'definitions'));
            const file = path.join(projectDir, 'definitions', 'model.sqlx');
            fs.writeFileSync(file, 'config {\n  type: "view",\n  uniqueKey: ["id"],\n  disabled: "no"\n}\nSELECT 1');

            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
            // Opening a .sqlx file also activates the extension itself, so each diagnostic can be
            // reported twice (once per registration); compare the distinct codes.
            const diagnostics = await waitForConfigDiagnostics(document.uri);
            assert.deepStrictEqual([...new Set(diagnostics.map(d => d.code))], ['wrong-value-kind']);
        } finally {
            fs.rmSync(projectDir, { recursive: true, force: true });
        }
    });

    test('completes keys for the action type and enum values', async () => {
        const document = await openSqlx('config {\n  type: "incremental",\n  \n}\nSELECT 1');
        const keys = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', document.uri, new vscode.Position(2, 2));
        const labels = keys.items.map(item => (typeof item.label === 'string' ? item.label : item.label.label));
        assert.ok(labels.includes('uniqueKey'));
        assert.ok(labels.includes('onSchemaChange'));
        assert.ok(!labels.includes('materialized'), 'view-only key should not be offered');
        assert.ok(!labels.includes('type'), 'existing key should not be offered again');

        const valueDocument = await openSqlx('config {\n  type: "incremental",\n  onSchemaChange: ""\n}\nSELECT 1');
        const values = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', valueDocument.uri, new vscode.Position(2, 19), '"');
        const valueLabels = values.items.map(item => (typeof item.label === 'string' ? item.label : item.label.label));
        assert.ok(valueLabels.includes('EXTEND'));
        assert.ok(valueLabels.includes('SYNCHRONIZE'));
    });

    test('shows hover docs for config keys', async () => {
        const document = await openSqlx('config {\n  type: "table",\n  assertions: { nonNull: ["id"] }\n}\nSELECT 1');
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, new vscode.Position(2, 18));
        const text = hovers.flatMap(hover => hover.contents.map(content => (typeof content === 'string' ? content : content.value))).join('\n');
        assert.match(text, /nonNull/);
        assert.match(text, /NULL/);
    });
});
