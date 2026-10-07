import * as assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { suite, suiteSetup, suiteTeardown, test } from 'mocha';
import { exampleProjectRoot, readDbtLog } from './fixtures';
import { activeDbtTarget, listDbtTargets, profilesDirectories } from './targets';

suite('dbt targets', () => {
    let dir: string;
    const write = (file: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
    };
    const PROFILE = 'shop:\n  target: dev\n  outputs:\n    dev:\n      type: bigquery\n      keyfile: /secret/key.json\n    ci:\n      type: bigquery\n';

    suiteSetup(() => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dbt-targets-')));
    });
    suiteTeardown(() => fs.rmSync(dir, { recursive: true, force: true }));

    test("the example Project's are the outputs of its profile, in the file's order", () => {
        const root = exampleProjectRoot('dbt');
        assert.deepStrictEqual(listDbtTargets(root, { env: {}, homeDir: dir }), {
            profile: 'xf_example', profilesFile: path.join(root, 'profiles.yml'), names: ['dev', 'ci'], defaultName: 'dev',
        });
    });

    test('profiles.yml is looked for where dbt looks, in its order', () => {
        const root = path.join(dir, 'order');
        const home = path.join(dir, 'home');
        assert.deepStrictEqual(profilesDirectories(root, { profilesDir: 'conf', env: { DBT_PROFILES_DIR: '/etc/dbt' }, homeDir: home }), [
            path.join(root, 'conf'), path.resolve('/etc/dbt'), root, path.join(home, '.dbt'),
        ]);
        write('order/dbt_project.yml', 'name: shop\nprofile: shop\n');
        const found = (options: Parameters<typeof listDbtTargets>[1]) => listDbtTargets(root, { env: {}, homeDir: home, ...options })?.names;
        assert.strictEqual(found({}), undefined);
        write('home/.dbt/profiles.yml', PROFILE.replace('ci:', 'home:'));
        assert.deepStrictEqual(found({}), ['dev', 'home']);
        write('order/profiles.yml', PROFILE.replace('ci:', 'root:'));
        assert.deepStrictEqual(found({}), ['dev', 'root']);
        write('env/profiles.yml', PROFILE.replace('ci:', 'env:'));
        assert.deepStrictEqual(found({ env: { DBT_PROFILES_DIR: path.join(dir, 'env') } }), ['dev', 'env']);
        write('order/conf/profiles.yml', PROFILE.replace('ci:', 'option:'));
        assert.deepStrictEqual(found({ profilesDir: 'conf', env: { DBT_PROFILES_DIR: path.join(dir, 'env') } }), ['dev', 'option']);
    });

    test('only names are read, and a default that is not one of them is not given', () => {
        const root = path.join(dir, 'names');
        write('names/dbt_project.yml', 'profile: shop\n');
        write('names/profiles.yml', PROFILE.replace('target: dev', `target: "{{ env_var('DBT_TARGET', 'dev') }}"`));
        const targets = listDbtTargets(root, { env: {}, homeDir: dir });
        assert.deepStrictEqual(targets?.names, ['dev', 'ci']);
        assert.strictEqual(targets?.defaultName, undefined);
        assert.ok(!JSON.stringify(targets).includes('secret'));
        // A value that is a Jinja expression outside a string does not stop the names being read
        write('names/profiles.yml', 'shop:\n  outputs:\n    dev:\n      project: {{ env_var("P") }}\n    ci:\n      project: x\n');
        assert.deepStrictEqual(listDbtTargets(root, { env: {}, homeDir: dir })?.names, ['dev', 'ci']);
    });

    test('cannot be told when the profile is missing, has no outputs, or a file does not parse', () => {
        const none = (name: string, project: string, profiles?: string) => {
            write(`${name}/dbt_project.yml`, project);
            if (profiles !== undefined) {
                write(`${name}/profiles.yml`, profiles);
            }
            return listDbtTargets(path.join(dir, name), { env: {}, homeDir: path.join(dir, 'nobody') });
        };
        assert.strictEqual(none('no-profile-key', 'name: shop\n', PROFILE), undefined);
        assert.strictEqual(none('no-file', 'profile: shop\n'), undefined);
        assert.strictEqual(none('other-profile', 'profile: other\n', PROFILE), undefined);
        assert.strictEqual(none('no-outputs', 'profile: shop\n', 'shop:\n  target: dev\n'), undefined);
        // A Jinja statement is not YAML
        assert.strictEqual(none('jinja', 'profile: shop\n', "shop:\n  outputs:\n{% if env_var('CI') %}\n    ci:\n      type: bigquery\n{% endif %}\n"), undefined);
        assert.strictEqual(none('bad-project', 'profile: [shop\n', PROFILE), undefined);
        assert.strictEqual(listDbtTargets(path.join(dir, 'not-a-project'), { env: {}, homeDir: dir }), undefined);
    });

    test('the active one is read from what each engine logs', () => {
        // As dbt-core 1.12.5 logs it when a compile starts, and dbt v2 2.0.6 when a command ends
        const core = '{"data": {"node_count": 24, "num_threads": 4, "target_name": "ci"}, "info": {"code": "Q027", "level": "info", "msg": "Concurrency: 4 threads (target=\'ci\')", "name": "ConcurrencyLine"}}';
        const v2 = JSON.stringify({ data: { success: true }, info: { code: 'Q039', level: 'info', msg: "\n==== Execution Summary ====\nFinished 'compile' successfully for target 'dev' [2.1s]\nProcessed: 10 models", name: 'CommandCompleted' } });
        assert.strictEqual(activeDbtTarget(`{"info":{"msg":"start"}}\n${core}\nnot json target\n`), 'ci');
        assert.strictEqual(activeDbtTarget(`${v2}\n`), 'dev');
        // A real dbt v2 parse that met an error still says; a real dbt-core parse does not
        assert.strictEqual(activeDbtTarget(readDbtLog('dbt-v2-macro').stdout), 'dev');
        assert.strictEqual(activeDbtTarget(readDbtLog('dbt-core-macro').stdout), undefined);
        assert.strictEqual(activeDbtTarget(''), undefined);
    });
});
