import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setup, suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { ProjectRegistry } from '../../project/registry';
import { clearCompiled, compileNumber, compiledIndices, compiledJson, projects, setCompiled } from '../../project';
import { DataformCompiledJson } from '../../types';

const target = (name: string) => ({ database: 'p', schema: 'd', name });
const compiledWith = (...tables: { name: string; fileName: string; dependsOn?: string[] }[]) => ({
    tables: tables.map((table) => ({ type: 'table', target: target(table.name), fileName: table.fileName, dependencyTargets: (table.dependsOn ?? []).map(target) })),
    assertions: [], operations: [], notebooks: [], declarations: [], targets: [], tests: [],
}) as unknown as DataformCompiledJson;

suite('project registry', () => {
    let tmp: string;
    let dataformRoot: string;
    let dbtRoot: string;
    let sharedRoot: string;
    let plainRoot: string;
    const folder = (name: string, ...files: string[]) => {
        const directory = path.join(tmp, name);
        fs.mkdirSync(directory, { recursive: true });
        files.forEach((file) => fs.writeFileSync(path.join(directory, file), ''));
        return directory;
    };

    suiteSetup(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-registry-')));
        dataformRoot = folder('dataform', 'workflow_settings.yaml');
        dbtRoot = folder('dbt', 'dbt_project.yml');
        sharedRoot = folder('shared', 'workflow_settings.yaml', 'dbt_project.yml');
        plainRoot = folder('plain');
    });

    suiteTeardown(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    suite('refresh', () => {
        test('finds the Projects at the roots of the workspace folders', () => {
            const registry = new ProjectRegistry();
            const found = registry.refresh([dataformRoot, plainRoot, dbtRoot]);
            assert.deepStrictEqual(found.map(({ root, backend }) => ({ root, backend })), [{ root: dataformRoot, backend: 'dataform' }, { root: dbtRoot, backend: 'dbt' }]);
            assert.strictEqual(registry.find(dataformRoot, 'dataform'), found[0]);
            assert.strictEqual(registry.find(dataformRoot, 'dbt'), undefined);
        });

        test('a Dataform Project has its own Dataform Backend, a dbt Project has none yet', () => {
            const registry = new ProjectRegistry();
            const [dataform, dbt] = registry.refresh([dataformRoot, dbtRoot]);
            const [shared] = registry.refresh([dataformRoot, sharedRoot, dbtRoot]).filter((project) => project.root === sharedRoot && project.backend === 'dataform');
            assert.strictEqual(dataform.dataformBackend?.name, 'dataform');
            assert.notStrictEqual(shared.dataformBackend, dataform.dataformBackend);
            assert.strictEqual(dbt.dataformBackend, undefined);
        });

        test('a Project that is still there keeps its state, one that is gone is dropped', () => {
            const registry = new ProjectRegistry();
            const [dataform] = registry.refresh([dataformRoot, dbtRoot]);
            dataform.dataformBackend!.keep(compiledWith());
            registry.refresh([dataformRoot]);
            assert.strictEqual(registry.find(dataformRoot, 'dataform'), dataform);
            assert.ok(dataform.dataformBackend!.rawResult);
            assert.strictEqual(registry.find(dbtRoot, 'dbt'), undefined);
        });
    });

    suite('ensure', () => {
        test('finds a Project the registry has not been told about', () => {
            const registry = new ProjectRegistry();
            const state = registry.ensure(dataformRoot, 'dataform');
            assert.strictEqual(state?.root, dataformRoot);
            assert.strictEqual(registry.ensure(dataformRoot, 'dataform'), state);
            assert.deepStrictEqual(registry.projects, [state]);
        });

        test('gives nothing where there is no such Project', () => {
            const registry = new ProjectRegistry();
            assert.strictEqual(registry.ensure(plainRoot, 'dataform'), undefined);
            assert.strictEqual(registry.ensure(dbtRoot, 'dataform'), undefined);
            assert.deepStrictEqual(registry.projects, []);
        });
    });

    suite('active Project', () => {
        test('with one Project it is the active one from the start', () => {
            const registry = new ProjectRegistry();
            const [only] = registry.refresh([dataformRoot, plainRoot]);
            assert.strictEqual(registry.active, only);
        });

        test('with several and no file focused yet there is none', () => {
            const registry = new ProjectRegistry();
            registry.refresh([dataformRoot, dbtRoot]);
            assert.strictEqual(registry.active, undefined);
        });

        test('follows the file that has focus', () => {
            const registry = new ProjectRegistry();
            const [dataform, dbt] = registry.refresh([dataformRoot, dbtRoot]);
            assert.strictEqual(registry.noteActiveFile(path.join(dbtRoot, 'models', 'orders.sql')), true);
            assert.strictEqual(registry.active, dbt);
            assert.strictEqual(registry.noteActiveFile(path.join(dbtRoot, 'models', 'customers.sql')), false);
            assert.strictEqual(registry.noteActiveFile(path.join(dataformRoot, 'definitions', 'orders.sqlx')), true);
            assert.strictEqual(registry.active, dataform);
        });

        test('a file outside every Project leaves the active Project as it was', () => {
            const registry = new ProjectRegistry();
            const [, dbt] = registry.refresh([dataformRoot, dbtRoot]);
            registry.noteActiveFile(path.join(dbtRoot, 'models', 'orders.sql'));
            assert.strictEqual(registry.noteActiveFile(path.join(plainRoot, 'notes.md')), false);
            assert.strictEqual(registry.active, dbt);
        });

        test('at a shared root the file decides, and an undecided file changes nothing', () => {
            const registry = new ProjectRegistry();
            const [dataform, dbt] = registry.refresh([sharedRoot]);
            registry.noteActiveFile(path.join(sharedRoot, 'models', 'orders.sql'));
            assert.strictEqual(registry.active, dbt);
            assert.strictEqual(registry.noteActiveFile(path.join(sharedRoot, 'README.md')), false);
            assert.strictEqual(registry.active, dbt);
            registry.noteActiveFile(path.join(sharedRoot, 'definitions', 'orders.sqlx'));
            assert.strictEqual(registry.active, dataform);
        });

        test('picking a Project makes it the active one', () => {
            const registry = new ProjectRegistry();
            const [dataform, dbt] = registry.refresh([dataformRoot, dbtRoot]);
            registry.activate(dbt);
            assert.strictEqual(registry.active, dbt);
            registry.activate(dataform);
            assert.strictEqual(registry.active, dataform);
        });

        test('a Project the registry does not hold cannot be made active', () => {
            const registry = new ProjectRegistry();
            const [dataform] = registry.refresh([dataformRoot, dbtRoot]);
            registry.activate(dataform);
            registry.activate(new ProjectRegistry().refresh([sharedRoot])[0]);
            assert.strictEqual(registry.active, dataform);
        });

        test('is forgotten when its Project is gone', () => {
            const registry = new ProjectRegistry();
            registry.refresh([dataformRoot, dbtRoot, sharedRoot]);
            registry.noteActiveFile(path.join(dbtRoot, 'models', 'orders.sql'));
            registry.refresh([dataformRoot, sharedRoot]);
            assert.strictEqual(registry.active, undefined);
        });
    });

    suite('storing a compile result', () => {
        // The window's own registry, which other suites also fill: only these folders are touched
        setup(() => {
            clearCompiled(dataformRoot);
        });

        test('setCompiled records the result and its lookups on the Project', () => {
            const compiled = compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }, { name: 'report', fileName: 'definitions/report.sqlx', dependsOn: ['orders'] });
            setCompiled(dataformRoot, compiled);
            assert.strictEqual(projects.find(dataformRoot, 'dataform')?.dataformBackend?.rawResult, compiled);
            assert.strictEqual(compiledJson(dataformRoot), compiled);
            const indices = compiledIndices(dataformRoot);
            assert.strictEqual(indices.fileNodeMap.get('definitions/report.sqlx')?.length, 1);
            assert.deepStrictEqual(indices.targetDependentsMap.get('p.d.orders'), [target('report')]);
            assert.strictEqual(indices.targetNameMap.get('report')?.length, 1);
        });

        test('each new compile result gets the next number, for its Project alone', () => {
            const before = compileNumber(dataformRoot);
            const otherBefore = compileNumber(sharedRoot);
            const first = compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' });
            setCompiled(dataformRoot, first);
            assert.strictEqual(compileNumber(dataformRoot), before + 1);
            // Handing the same result over again is not another compile
            setCompiled(dataformRoot, first);
            assert.strictEqual(compileNumber(dataformRoot), before + 1);
            setCompiled(dataformRoot, compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }));
            assert.strictEqual(compileNumber(dataformRoot), before + 2);
            assert.strictEqual(compileNumber(sharedRoot), otherBefore);
            assert.strictEqual(compileNumber(plainRoot), 0);
        });

        test('clearCompiled forgets it', () => {
            setCompiled(dataformRoot, compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }));
            clearCompiled(dataformRoot);
            assert.strictEqual(compiledJson(dataformRoot), undefined);
            assert.strictEqual(compiledIndices(dataformRoot).fileNodeMap.size, 0);
        });

        test('each Project keeps its own result', () => {
            const one = compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' });
            const other = compiledWith({ name: 'customers', fileName: 'definitions/customers.sqlx' });
            setCompiled(dataformRoot, one);
            setCompiled(sharedRoot, other);
            assert.strictEqual(compiledJson(dataformRoot), one);
            assert.strictEqual(compiledJson(sharedRoot), other);
            assert.ok(compiledIndices(dataformRoot).targetNameMap.has('orders'));
            assert.ok(!compiledIndices(dataformRoot).targetNameMap.has('customers'));
            clearCompiled(sharedRoot);
            assert.strictEqual(compiledJson(dataformRoot), one);
        });

        test('nothing is kept for a folder that is not a Dataform Project', () => {
            setCompiled(plainRoot, compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }));
            setCompiled(dbtRoot, compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }));
            assert.strictEqual(compiledJson(plainRoot), undefined);
            assert.strictEqual(compiledJson(dbtRoot), undefined);
            assert.strictEqual(compiledIndices(plainRoot).fileNodeMap.size, 0);
        });
    });
});
