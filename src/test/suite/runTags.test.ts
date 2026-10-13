import * as assert from 'assert';
import { suite, test } from 'mocha';
import { onlyAvailable } from '../../../webviews/preview_compiled/utils/runTags';

suite('panel: the tags chosen for a run', () => {
    test('a tag the Project no longer has is taken out', () => {
        assert.deepStrictEqual(onlyAvailable(['daily', 'gone', 'hourly'], ['hourly', 'daily', 'weekly']), ['daily', 'hourly']);
        assert.deepStrictEqual(onlyAvailable(['gone'], []), []);
    });

    test('when nothing is taken out the list is the same one, so nothing renders again', () => {
        const chosen = ['daily'];
        assert.strictEqual(onlyAvailable(chosen, ['daily', 'weekly']), chosen);
        const none: string[] = [];
        assert.strictEqual(onlyAvailable(none, ['daily']), none);
    });
});
