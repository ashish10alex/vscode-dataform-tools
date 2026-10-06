import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setup, suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { ProjectRegistry } from '../../project/registry';
import { clearCompiled, projects, setCompiled } from '../../project';
import { emptyIndices, useIndices } from '../../utils/compiledJsonIndex';
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

        test('a Project that is still there keeps its state, one that is gone is dropped', () => {
            const registry = new ProjectRegistry();
            const [dataform] = registry.refresh([dataformRoot, dbtRoot]);
            dataform.setCompiled(compiledWith(), emptyIndices());
            registry.refresh([dataformRoot]);
            assert.strictEqual(registry.find(dataformRoot, 'dataform'), dataform);
            assert.ok(dataform.compiled);
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

        test('is forgotten when its Project is gone', () => {
            const registry = new ProjectRegistry();
            registry.refresh([dataformRoot, dbtRoot, sharedRoot]);
            registry.noteActiveFile(path.join(dbtRoot, 'models', 'orders.sql'));
            registry.refresh([dataformRoot, sharedRoot]);
            assert.strictEqual(registry.active, undefined);
        });
    });

    suite('storing a compile result', () => {
        // The window's own registry and lookups, which other suites also fill: put back what was there
        const before = { compiled: globalThis.CACHED_COMPILED_DATAFORM_JSON, fileNodeMap: globalThis.FILE_NODE_MAP, targetDependentsMap: globalThis.TARGET_DEPENDENTS_MAP, targetNameMap: globalThis.TARGET_NAME_MAP };
        suiteSetup(() => {
            before.compiled = globalThis.CACHED_COMPILED_DATAFORM_JSON;
            before.fileNodeMap = globalThis.FILE_NODE_MAP;
            before.targetDependentsMap = globalThis.TARGET_DEPENDENTS_MAP;
            before.targetNameMap = globalThis.TARGET_NAME_MAP;
        });
        setup(() => {
            clearCompiled();
        });
        suiteTeardown(() => {
            globalThis.CACHED_COMPILED_DATAFORM_JSON = before.compiled;
            useIndices(before);
        });

        test('setCompiled records it on the Project and makes it what the window-wide lookups read', () => {
            const compiled = compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }, { name: 'report', fileName: 'definitions/report.sqlx', dependsOn: ['orders'] });
            setCompiled(dataformRoot, compiled);
            const state = projects.find(dataformRoot, 'dataform');
            assert.strictEqual(state?.compiled, compiled);
            assert.strictEqual(globalThis.CACHED_COMPILED_DATAFORM_JSON, compiled);
            assert.strictEqual(state?.indices?.fileNodeMap, globalThis.FILE_NODE_MAP);
            assert.deepStrictEqual(globalThis.TARGET_DEPENDENTS_MAP.get('p.d.orders'), [target('report')]);
            assert.strictEqual(globalThis.TARGET_NAME_MAP.get('report')?.length, 1);
        });

        test('clearCompiled forgets it in both places', () => {
            setCompiled(dataformRoot, compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' }));
            clearCompiled(dataformRoot);
            assert.strictEqual(projects.find(dataformRoot, 'dataform')?.compiled, undefined);
            assert.strictEqual(globalThis.CACHED_COMPILED_DATAFORM_JSON, undefined);
            assert.strictEqual(globalThis.FILE_NODE_MAP.size, 0);
        });

        test('a folder that is not a Dataform Project still feeds the window-wide lookups', () => {
            const compiled = compiledWith({ name: 'orders', fileName: 'definitions/orders.sqlx' });
            setCompiled(plainRoot, compiled);
            assert.strictEqual(projects.find(plainRoot, 'dataform'), undefined);
            assert.strictEqual(globalThis.CACHED_COMPILED_DATAFORM_JSON, compiled);
            assert.strictEqual(globalThis.FILE_NODE_MAP.size, 1);
        });
    });
});
