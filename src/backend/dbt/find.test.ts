import * as assert from 'assert';
import path from 'path';
import { suite, test } from 'mocha';
import { DbtSearch, findDbt } from './find';

const root = path.resolve('/work/shop');
const home = path.resolve('/home/me');

/** A search on a machine that has just the given files */
function search(files: string[], overrides: Partial<DbtSearch> = {}) {
    const present = new Set(files.map((file) => path.resolve(file)));
    return findDbt({ root, env: {}, platform: 'linux', homeDir: home, isFile: (file) => present.has(path.resolve(file)), ...overrides });
}

suite('finding dbt', () => {
    const everywhere = [
        '/custom/dbt', '/env/dbt', path.join(root, '.venv/bin/dbt'), path.join(root, 'venv/bin/dbt'), '/pyenv/bin/dbt', '/usr/bin/dbt', path.join(home, '.local/bin/dbt'),
    ];
    const all = { settingPath: '/custom/dbt', pythonEnvironmentBin: '/pyenv/bin', env: { DBT_BIN: '/env/dbt', PATH: '/bin:/usr/bin' } };

    test('the steps are tried in order, and the first that has a dbt wins', () => {
        const order = [
            ['/custom/dbt', 'the dbtExecutablePath setting'],
            ['/env/dbt', '$DBT_BIN'],
            [path.join(root, '.venv/bin/dbt'), "the Project's .venv"],
            [path.join(root, 'venv/bin/dbt'), "the Project's venv"],
            ['/pyenv/bin/dbt', "the Python extension's environment"],
            ['/usr/bin/dbt', 'PATH'],
            [path.join(home, '.local/bin/dbt'), 'a known install directory'],
        ];
        order.forEach(([file, foundBy], index) => {
            // Without the dbts of the steps before this one
            const found = search(everywhere.slice(index), all).found;
            assert.deepStrictEqual(found, { path: path.resolve(file), foundBy });
        });
    });

    test('with no dbt anywhere, says where it looked', () => {
        const result = search([], all);
        assert.strictEqual(result.found, undefined);
        assert.deepStrictEqual(result.looked, [
            'the dbtExecutablePath setting (/custom/dbt)', '$DBT_BIN (/env/dbt)', "the Project's .venv", "the Project's venv",
            "the Python extension's environment (/pyenv/bin)", 'PATH', `${path.join(home, '.local', 'bin')}, /opt/homebrew/bin, /usr/local/bin`,
        ]);
        // What was not given is not listed
        assert.deepStrictEqual(search([]).looked.slice(0, 3), ["the Project's .venv", "the Project's venv", 'PATH']);
    });

    test('a setting that points at nothing is passed over, and listed', () => {
        const result = search(['/usr/bin/dbt'], { settingPath: '/gone/dbt', env: { PATH: '/usr/bin' } });
        assert.deepStrictEqual(result.found, { path: path.resolve('/usr/bin/dbt'), foundBy: 'PATH' });
        assert.strictEqual(result.looked[0], 'the dbtExecutablePath setting (/gone/dbt)');
    });

    test('a setting can be relative to the Project, or a name to find on PATH', () => {
        assert.strictEqual(search([path.join(root, 'tools/dbt')], { settingPath: 'tools/dbt' }).found?.path, path.join(root, 'tools/dbt'));
        assert.deepStrictEqual(search(['/usr/bin/dbtf'], { env: { DBT_BIN: 'dbtf', PATH: '/bin:/usr/bin' } }).found, { path: path.resolve('/usr/bin/dbtf'), foundBy: '$DBT_BIN' });
    });

    test('on Windows a venv keeps its dbt in Scripts, and dbt has an extension', () => {
        const scripts = path.join(root, '.venv', 'Scripts', 'dbt.exe');
        assert.strictEqual(search([scripts], { platform: 'win32' }).found?.path, scripts);
        const onPath = path.join('C:\\tools', 'dbt.exe');
        assert.strictEqual(search([onPath], { platform: 'win32', env: { Path: 'C:\\Windows;C:\\tools' } }).found?.foundBy, 'PATH');
        // A batch file cannot be run without a shell, so it is passed over for a dbt.exe further along
        const shim = path.join('C:\\shims', 'dbt.cmd');
        assert.strictEqual(search([shim, onPath], { platform: 'win32', env: { Path: 'C:\\shims;C:\\tools' } }).found?.path, onPath);
    });
});
