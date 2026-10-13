import * as assert from 'assert';
import { suite, test } from 'mocha';
import { jobPlace } from '../../bigquery/jobPlace';
import { madeUpTarget } from '../../shared/compiledGraph';

suite('where BigQuery jobs run', () => {
    const target = { database: 'warehouse-prod', schema: 'marts', name: 'orders' };

    test('the settings win when set, for both Backends', () => {
        const settings = { gcpProjectId: 'billing-project', gcpLocation: 'EU' };
        assert.deepStrictEqual(jobPlace('dataform', target, settings), { projectId: 'billing-project', location: 'EU' });
        assert.deepStrictEqual(jobPlace('dbt', target, settings), { projectId: 'billing-project', location: 'EU' });
    });

    test("unset, a dbt action's jobs run in its Target's project and BigQuery picks the location", () => {
        assert.deepStrictEqual(jobPlace('dbt', target, {}), { projectId: 'warehouse-prod' });
        // Each setting stands alone
        assert.deepStrictEqual(jobPlace('dbt', target, { gcpLocation: 'US' }), { projectId: 'warehouse-prod', location: 'US' });
        assert.deepStrictEqual(jobPlace('dbt', target, { gcpProjectId: 'billing-project' }), { projectId: 'billing-project' });
    });

    test('unset, a dbt action that builds nothing falls back to the default project of the credentials', () => {
        assert.deepStrictEqual(jobPlace('dbt', madeUpTarget('unit test', 'orders_total'), {}), {});
        assert.deepStrictEqual(jobPlace('dbt', madeUpTarget('unit test', 'orders_total'), { gcpProjectId: 'billing-project' }), { projectId: 'billing-project' });
    });

    test('unset, a Dataform action keeps the default project of the credentials', () => {
        assert.deepStrictEqual(jobPlace('dataform', target, {}), {});
        assert.deepStrictEqual(jobPlace('dataform', target, { gcpLocation: 'EU' }), { location: 'EU' });
    });

    test('a setting left blank counts as unset', () => {
        assert.deepStrictEqual(jobPlace('dbt', target, { gcpProjectId: '  ', gcpLocation: '' }), { projectId: 'warehouse-prod' });
        assert.deepStrictEqual(jobPlace('dataform', target, { gcpProjectId: '', gcpLocation: ' ' }), {});
    });
});
