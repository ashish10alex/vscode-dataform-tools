import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { backendForSharedRootFile, detectProjects, detectProjectsAbove, detectWorkspaceProjects, projectForFile, Project } from '../../project/detection';

suite('project detection', () => {
    let tmp: string;
    const folder = (name: string, ...files: string[]) => {
        const directory = path.join(tmp, name);
        for (const file of files) {
            fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
            fs.writeFileSync(path.join(directory, file), '');
        }
        fs.mkdirSync(directory, { recursive: true });
        return directory;
    };

    suiteSetup(() => {
        tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'project-detection-')));
    });

    suiteTeardown(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    suite('detectProjects', () => {
        test('a root with workflow_settings.yaml is a Dataform Project', () => {
            const root = folder('df-3', 'workflow_settings.yaml');
            assert.deepStrictEqual(detectProjects(root), [{ root, backend: 'dataform' }]);
        });

        test('a root with dataform.json is a Dataform Project', () => {
            const root = folder('df-2', 'dataform.json');
            assert.deepStrictEqual(detectProjects(root), [{ root, backend: 'dataform' }]);
        });

        test('a root with both Dataform settings files is still one Dataform Project', () => {
            const root = folder('df-both', 'workflow_settings.yaml', 'dataform.json');
            assert.deepStrictEqual(detectProjects(root), [{ root, backend: 'dataform' }]);
        });

        test('a root with dbt_project.yml is a dbt Project', () => {
            const root = folder('dbt', 'dbt_project.yml');
            assert.deepStrictEqual(detectProjects(root), [{ root, backend: 'dbt' }]);
        });

        test('a root with the settings files of both Backends is two Projects sharing it', () => {
            const root = folder('both', 'workflow_settings.yaml', 'dbt_project.yml');
            assert.deepStrictEqual(detectProjects(root), [{ root, backend: 'dataform' }, { root, backend: 'dbt' }]);
        });

        test('a root with neither is no Project', () => {
            assert.deepStrictEqual(detectProjects(folder('plain', 'README.md')), []);
        });

        test('a directory that does not exist is no Project', () => {
            assert.deepStrictEqual(detectProjects(path.join(tmp, 'missing')), []);
        });

        test('a settings file below the root does not make it a Project', () => {
            assert.deepStrictEqual(detectProjects(folder('nested', 'transform/dbt_project.yml', 'dbt_packages/dbt_utils/dbt_project.yml')), []);
        });

        test('a directory named like a settings file does not count', () => {
            const root = folder('dir-marker');
            fs.mkdirSync(path.join(root, 'dbt_project.yml'));
            assert.deepStrictEqual(detectProjects(root), []);
        });
    });

    test('detectWorkspaceProjects lists the Projects of every workspace folder, in order', () => {
        const dataform = folder('ws-df', 'workflow_settings.yaml');
        const plain = folder('ws-plain');
        const dbt = folder('ws-dbt', 'dbt_project.yml');
        assert.deepStrictEqual(detectWorkspaceProjects([dataform, plain, dbt]), [{ root: dataform, backend: 'dataform' }, { root: dbt, backend: 'dbt' }]);
        assert.deepStrictEqual(detectWorkspaceProjects([]), []);
    });

    suite('backendForSharedRootFile', () => {
        const root = path.join(path.sep, 'repo');
        const file = (...parts: string[]) => path.join(root, ...parts);

        test('a file type only one Backend has decides', () => {
            assert.strictEqual(backendForSharedRootFile(root, file('definitions', 'orders.sqlx')), 'dataform');
            assert.strictEqual(backendForSharedRootFile(root, file('models', 'orders.sql')), 'dbt');
            assert.strictEqual(backendForSharedRootFile(root, file('seeds', 'countries.CSV')), 'dbt');
            assert.strictEqual(backendForSharedRootFile(root, file('models', 'forecast.py')), 'dbt');
        });

        test('the file type wins over the Compiled Graphs and the user\'s choice', () => {
            assert.strictEqual(backendForSharedRootFile(root, file('models', 'orders.sql'), { isListed: () => true, preferred: 'dataform' }), 'dbt');
        });

        test('a shared file type belongs to the one Compiled Graph that lists it', () => {
            const isListed = (backend: string, relativePath: string) => backend === 'dbt' && relativePath === 'models/marts/_marts.yml';
            assert.strictEqual(backendForSharedRootFile(root, file('models', 'marts', '_marts.yml'), { isListed, preferred: 'dataform' }), 'dbt');
            const dataformJs = (backend: string, relativePath: string) => backend === 'dataform' && relativePath === 'definitions/sources.js';
            assert.strictEqual(backendForSharedRootFile(root, file('definitions', 'sources.js'), { isListed: dataformJs }), 'dataform');
        });

        test('a file no Compiled Graph lists, or both list, goes to the user\'s choice', () => {
            assert.strictEqual(backendForSharedRootFile(root, file('includes', 'constants.js'), { isListed: () => false, preferred: 'dataform' }), 'dataform');
            assert.strictEqual(backendForSharedRootFile(root, file('shared.yaml'), { isListed: () => true, preferred: 'dbt' }), 'dbt');
        });

        test('with nothing to go on it is undecided', () => {
            assert.strictEqual(backendForSharedRootFile(root, file('README.md')), undefined);
            assert.strictEqual(backendForSharedRootFile(root, file('includes', 'constants.js'), { isListed: () => false }), undefined);
        });
    });

    suite('projectForFile', () => {
        const dataformRoot = path.join(path.sep, 'work', 'dataform');
        const dbtRoot = path.join(path.sep, 'work', 'dbt');
        const sharedRoot = path.join(path.sep, 'work', 'shared');
        const projects: Project[] = [
            { root: dataformRoot, backend: 'dataform' },
            { root: dbtRoot, backend: 'dbt' },
            { root: sharedRoot, backend: 'dataform' },
            { root: sharedRoot, backend: 'dbt' },
        ];

        test('a file inside a Project belongs to it, whatever its type', () => {
            assert.deepStrictEqual(projectForFile(projects, path.join(dbtRoot, 'models', 'orders.sql')), { kind: 'project', project: projects[1] });
            assert.deepStrictEqual(projectForFile(projects, path.join(dbtRoot, 'dbt_project.yml')), { kind: 'project', project: projects[1] });
            assert.deepStrictEqual(projectForFile(projects, path.join(dataformRoot, 'includes', 'constants.js')), { kind: 'project', project: projects[0] });
        });

        test('a file outside every Project belongs to none', () => {
            assert.deepStrictEqual(projectForFile(projects, path.join(path.sep, 'work', 'notes.md')), { kind: 'none' });
            assert.deepStrictEqual(projectForFile([], path.join(dbtRoot, 'models', 'orders.sql')), { kind: 'none' });
        });

        test('a sibling folder whose name starts with a root\'s name is outside it', () => {
            assert.deepStrictEqual(projectForFile(projects, path.join(path.sep, 'work', 'dbt-old', 'models', 'orders.sql')), { kind: 'none' });
        });

        test('at a shared root the file decides its Project', () => {
            assert.deepStrictEqual(projectForFile(projects, path.join(sharedRoot, 'definitions', 'orders.sqlx')), { kind: 'project', project: projects[2] });
            assert.deepStrictEqual(projectForFile(projects, path.join(sharedRoot, 'models', 'orders.sql')), { kind: 'project', project: projects[3] });
            assert.deepStrictEqual(projectForFile(projects, path.join(sharedRoot, 'includes', 'constants.js'), { preferred: 'dataform' }), { kind: 'project', project: projects[2] });
        });

        test('at a shared root a file nothing settles is ambiguous, with both candidates', () => {
            assert.deepStrictEqual(projectForFile(projects, path.join(sharedRoot, 'includes', 'constants.js')), { kind: 'ambiguous', candidates: [projects[2], projects[3]] });
        });

        test('with workspace folders nested in one another the innermost root wins', () => {
            const outer: Project = { root: path.join(path.sep, 'repo'), backend: 'dataform' };
            const inner: Project = { root: path.join(path.sep, 'repo', 'transform'), backend: 'dbt' };
            assert.deepStrictEqual(projectForFile([outer, inner], path.join(inner.root, 'models', 'orders.sql')), { kind: 'project', project: inner });
            assert.deepStrictEqual(projectForFile([outer, inner], path.join(outer.root, 'definitions', 'orders.sqlx')), { kind: 'project', project: outer });
        });
    });

    suite('detectProjectsAbove', () => {
        test('the nearest directory above the file with a settings file is its Project', () => {
            const repo = folder('mono', 'README.md', 'transform/dbt_project.yml', 'transform/models/staging/orders.sql', 'pipelines/workflow_settings.yaml');
            assert.deepStrictEqual(detectProjectsAbove(path.join(repo, 'transform', 'models', 'staging', 'orders.sql'), repo), [{ root: path.join(repo, 'transform'), backend: 'dbt' }]);
            assert.deepStrictEqual(detectProjectsAbove(path.join(repo, 'pipelines', 'definitions', 'orders.sqlx'), repo), [{ root: path.join(repo, 'pipelines'), backend: 'dataform' }]);
            assert.deepStrictEqual(detectProjectsAbove(path.join(repo, 'README.md'), repo), []);
        });

        test('a Project inside another wins for its own files', () => {
            const repo = folder('nested', 'workflow_settings.yaml', 'dbt/dbt_project.yml');
            assert.deepStrictEqual(detectProjectsAbove(path.join(repo, 'dbt', 'models', 'orders.sql'), repo), [{ root: path.join(repo, 'dbt'), backend: 'dbt' }]);
            assert.deepStrictEqual(detectProjectsAbove(path.join(repo, 'definitions', 'orders.sqlx'), repo), [{ root: repo, backend: 'dataform' }]);
        });

        test('never looks above the workspace folder', () => {
            const project = folder('too-deep', 'dbt_project.yml', 'models/orders.sql');
            assert.deepStrictEqual(detectProjectsAbove(path.join(project, 'models', 'orders.sql'), path.join(project, 'models')), []);
        });

        test('a file of an installed package belongs to the Project that installed it', () => {
            const project = folder('with-packages', 'dbt_project.yml', 'dbt_packages/dbt_utils/dbt_project.yml', 'node_modules/@dataform/core/dataform.json');
            const own = [{ root: project, backend: 'dbt' }];
            assert.deepStrictEqual(detectProjectsAbove(path.join(project, 'dbt_packages', 'dbt_utils', 'macros', 'sql', 'star.sql'), project), own);
            assert.deepStrictEqual(detectProjectsAbove(path.join(project, 'node_modules', '@dataform', 'core', 'index.js'), project), own);
        });
    });
});
