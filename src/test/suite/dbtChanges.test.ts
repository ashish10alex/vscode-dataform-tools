import * as assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as vscode from 'vscode';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { DbtBackend, DbtOptions } from '../../backend/dbt';
import { initChangedActions } from '../../changedActions';
import { dbtChangesResult, dbtChangesView, forgetDbtChanges, listDbtChangedActions, onDidChangeDbtChanges, toDbtChangesView } from '../../project/dbtChanges';
import { ProjectState } from '../../project/registry';
import { countTypeNames, describeTypeCounts } from '../../shared/actionTypes';
import { findProjectRoot } from './helper';

/*
Run Changed for a dbt Project, from the host's side: a git repository made for the test, and a stand-in for dbt that
records what it was asked and writes a recorded manifest. What a real dbt lists is checked against both engines by
hand (see the pull request), and what is made of it in src/backend/dbt/changes.test.ts.
*/

const manifests = path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'dbt-manifests');

suite('Run Changed for a dbt Project: the base and the list', () => {
    let dir: string;
    let root: string;
    let options: DbtOptions;
    let project: ProjectState;
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' }).trim();
    /** What the stand-in was asked, in order: its arguments, and what it found in the Project it was pointed at */
    const ran = (): Array<{ args: string[]; packages: boolean; profiles: string | null }> =>
        fs.existsSync(path.join(dir, 'ran.jsonl')) ? fs.readFileSync(path.join(dir, 'ran.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
    const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

    suiteSetup(function () {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-changes-')));
        // Where bases are kept, which the extension's own start gives
        initChangedActions({ globalStorageUri: vscode.Uri.file(path.join(dir, 'storage')) } as vscode.ExtensionContext);
        root = path.join(dir, 'shop');
        fs.mkdirSync(path.join(root, 'models'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dbt_project.yml'), 'name: xf_example\nprofile: xf_example\n');
        fs.writeFileSync(path.join(root, 'packages.yml'), 'packages: []\n');
        fs.writeFileSync(path.join(root, 'models', 'fct_orders.sql'), 'select 1 as id\n');
        fs.writeFileSync(path.join(root, '.gitignore'), 'dbt_packages/\nprofiles.yml\n');
        execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
        git('add', '-A');
        git('commit', '-q', '--no-verify', '-m', 'base');
        git('checkout', '-q', '-b', 'feat/orders');
        // What git does not have: the installed packages, and a profile kept beside the Project
        fs.mkdirSync(path.join(root, 'dbt_packages', 'dbt_utils'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dbt_packages', 'dbt_utils', 'marker'), '');
        fs.writeFileSync(path.join(root, 'profiles.yml'), 'xf_example: {}\n');
        fs.writeFileSync(path.join(root, 'models', 'fct_orders.sql'), 'select 2 as id\n');

        const standIn = path.join(dir, 'dbt');
        fs.writeFileSync(standIn, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), dir = ${JSON.stringify(dir)};
const project = args[args.indexOf('--project-dir') + 1];
fs.appendFileSync(path.join(dir, 'ran.jsonl'), JSON.stringify({
    args,
    packages: fs.existsSync(path.join(project, 'dbt_packages', 'dbt_utils', 'marker')),
    profiles: args.includes('--profiles-dir') ? args[args.indexOf('--profiles-dir') + 1] : null,
}) + '\\n');
if (args[0] === 'deps') { return; }
const target = args[args.indexOf('--target-path') + 1];
fs.mkdirSync(target, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(manifests, 'dbt-v2.json'))}, 'utf8'));
if (args[0] === 'ls') {
    manifest.nodes['model.xf_example.fct_orders'].checksum = { name: 'sha256', checksum: 'edited' };
    delete manifest.nodes['model.xf_example.daily_revenue'];
    console.log(JSON.stringify({ info: { name: 'PrintEvent' }, data: { msg: JSON.stringify({ unique_id: 'model.xf_example.fct_orders' }) } }));
}
fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
`, { mode: 0o755 });
        options = { binary: standIn, flavour: 'dbt v2', artifactDir: path.join(dir, 'artifacts') };
        project = new ProjectState(root, 'dbt', undefined, new DbtBackend());
    });

    suiteTeardown(() => {
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('nothing is offered until the Project is known to be in a git repository, and nothing is listed unasked', async () => {
        assert.strictEqual(dbtChangesView(root), undefined);
        await new Promise<void>((resolve) => {
            const subscription = onDidChangeDbtChanges((changed) => {
                if (changed === root) {
                    subscription.dispose();
                    resolve();
                }
            });
        });
        assert.deepStrictEqual(dbtChangesView(root), { status: 'idle' });
        assert.deepStrictEqual(ran(), []);
    });

    test('parses the merge-base in a copy that has the installed packages and the profile, then asks dbt what changed', async function () {
        this.timeout(60 * 1000);
        const seen: string[] = [];
        const subscription = onDidChangeDbtChanges(() => seen.push(dbtChangesView(root)!.status));
        const result = await listDbtChangedActions(project, options);
        subscription.dispose();
        assert.ok(result);
        assert.deepStrictEqual(seen, ['computing', 'ready']);

        const [parse, ls, ...rest] = ran();
        assert.deepStrictEqual(rest, []);
        assert.strictEqual(parse.args[0], 'parse');
        // Not the working tree: a copy of the merge-base, which is gone once it is parsed
        const copy = flag(parse.args, '--project-dir');
        assert.notStrictEqual(copy, root);
        assert.ok(!fs.existsSync(copy));
        assert.ok(parse.packages, 'the copy had the installed packages');
        assert.strictEqual(parse.profiles, root);
        // The working tree's packages were linked, not moved
        assert.ok(fs.existsSync(path.join(root, 'dbt_packages', 'dbt_utils', 'marker')));

        assert.strictEqual(ls.args[0], 'ls');
        assert.strictEqual(flag(ls.args, '--project-dir'), root);
        assert.strictEqual(flag(ls.args, '--select'), 'state:modified');
        assert.strictEqual(flag(ls.args, '--state'), flag(parse.args, '--target-path'));
        assert.strictEqual(flag(ls.args, '--state'), result.stateDir);
        // Not where compiles write
        assert.strictEqual(flag(ls.args, '--target-path'), path.join(options.artifactDir, 'changes', 'target'));

        assert.deepStrictEqual(result.changed.map((action) => [action.fileName, action.target.name, action.kind, action.reasons]), [['models/marts/fct_orders.sql', 'fct_orders', 'incremental', ['sql']]]);
        assert.deepStrictEqual(result.deleted.map((action) => action.target.name), ['daily_revenue']);
        assert.strictEqual(result.baseRef, 'main');
        assert.strictEqual(result.headRef, 'feat/orders');
        assert.strictEqual(result.mergeBaseSha, git('rev-parse', 'main'));
        assert.strictEqual(dbtChangesResult(root), result);
    });

    test('the view is the one Dataform\'s button draws, with a dbt Kind as the type', () => {
        const view = toDbtChangesView(dbtChangesResult(root)!);
        assert.deepStrictEqual(view.changed, [{ target: 'alex-personal-dev-01.xf_example.fct_orders', fileName: 'models/marts/fct_orders.sql', type: 'incremental', reasons: ['sql'] }]);
        assert.deepStrictEqual(view.deleted, [{ target: 'alex-personal-dev-01.xf_example.daily_revenue', fileName: 'models/marts/daily_revenue.sql', type: 'materialized view' }]);
        assert.strictEqual(view.headLabel, 'working tree');
        assert.strictEqual(describeTypeCounts(countTypeNames(['incremental', 'seed', 'snapshot', 'test', 'unit test', 'materialized view', 'table'])), '1 table, 1 incremental, 1 view, 1 seed, 1 snapshot, 2 tests');
    });

    test('a base that was parsed is kept: asking again only lists', async function () {
        this.timeout(60 * 1000);
        const before = ran().length;
        await listDbtChangedActions(project, options);
        assert.deepStrictEqual(ran().slice(before).map((run) => run.args[0]), ['ls']);
    });

    test('another dbt target or other variables are another base', async function () {
        this.timeout(60 * 1000);
        const before = ran().length;
        await listDbtChangedActions(project, { ...options, target: 'ci' });
        const [parse, ls] = ran().slice(before);
        assert.deepStrictEqual([parse.args[0], ls.args[0]], ['parse', 'ls']);
        assert.strictEqual(flag(parse.args, '--target'), 'ci');
    });

    test('a branch that asks for other packages has the base install its own', async function () {
        this.timeout(60 * 1000);
        fs.writeFileSync(path.join(root, 'packages.yml'), 'packages:\n  - package: dbt-labs/dbt_utils\n    version: 1.3.0\n');
        const before = ran().length;
        await listDbtChangedActions(project, { ...options, vars: '{"a": 1}' });
        const [deps, parse] = ran().slice(before);
        assert.strictEqual(deps.args[0], 'deps');
        assert.ok(!deps.args.includes('--target-path'), 'dbt-core deps takes no --target-path');
        assert.strictEqual(flag(deps.args, '--project-dir'), flag(parse.args, '--project-dir'));
        assert.ok(!parse.packages, 'the packages of the working tree were not given to the copy');
        git('checkout', '-q', '--', 'packages.yml');
    });

    test('a save or another branch forgets the list, which is then asked for again', () => {
        assert.strictEqual(dbtChangesView(root)!.status, 'ready');
        forgetDbtChanges({ file: path.join(dir, 'elsewhere', 'a.sql') });
        assert.strictEqual(dbtChangesView(root)!.status, 'ready');
        forgetDbtChanges({ file: path.join(root, 'models', 'fct_orders.sql') });
        assert.deepStrictEqual(dbtChangesView(root), { status: 'idle' });
        assert.strictEqual(dbtChangesResult(root), undefined);
    });

    test('why there is no list is shown: here a base without the Project', async function () {
        this.timeout(60 * 1000);
        git('checkout', '-q', '--orphan', 'empty');
        git('rm', '-rqf', '--cached', '.');
        fs.writeFileSync(path.join(root, 'README.md'), 'nothing yet\n');
        git('add', 'README.md');
        git('commit', '-q', '--no-verify', '-m', 'empty');
        const emptyBase = git('rev-parse', 'HEAD');
        git('branch', '-f', 'main', emptyBase);
        await assert.rejects(listDbtChangedActions(project, options), /has no dbt project here/);
        const view = dbtChangesView(root)!;
        assert.strictEqual(view.status, 'error');
        assert.match(view.error!, /main @ [0-9a-f]{7} has no dbt project here/);
    });
});
