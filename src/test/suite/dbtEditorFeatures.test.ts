import * as assert from 'assert';
import { suite, test } from 'mocha';
import { OTHER_DBT_EXTENSIONS, dbtEditorFeaturesOn } from '../../project/dbtEditor';

suite('dbt editor features beside other dbt extensions', () => {
    const none = () => false;
    const powerUser = (id: string) => id === 'innoverio.vscode-dbt-power-user';

    test('on when no other dbt extension is installed, whatever but "off" the setting says', () => {
        for (const setting of ['auto', 'on', undefined, 'something else']) {
            assert.deepStrictEqual(dbtEditorFeaturesOn(setting, none), { on: true });
        }
    });

    test('"auto" stands down beside either extension, and says which and how to have both', () => {
        for (const id of OTHER_DBT_EXTENSIONS) {
            const features = dbtEditorFeaturesOn('auto', (installed) => installed === id);
            assert.strictEqual(features.on, false);
            assert.ok(!features.on && features.because.includes(id) && features.because.includes('"on"'), JSON.stringify(features));
        }
        // No setting is "auto"
        assert.strictEqual(dbtEditorFeaturesOn(undefined, powerUser).on, false);
    });

    test('"on" stays on beside another extension, and "off" is off without one', () => {
        assert.deepStrictEqual(dbtEditorFeaturesOn('on', powerUser), { on: true });
        const off = dbtEditorFeaturesOn('off', none);
        assert.ok(!off.on && off.because.includes('"off"'));
    });
});
