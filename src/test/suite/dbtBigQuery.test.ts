import * as assert from 'assert';
import fs from 'fs';
import path from 'path';
import { suite, test } from 'mocha';
import { DbtBackend } from '../../backend/dbt';
import { buildDbtGraph } from '../../backend/dbt/graph';
import { previewQuery } from '../../bigquery/preview';
import { fileSlice } from '../../panel/slices';
import { dbtActionsToDryRun } from '../../project/dbtBigQuery';
import { findProjectRoot } from './helper';

const manifest = (name: string) => JSON.parse(fs.readFileSync(path.join(findProjectRoot(__dirname), 'src', 'test', 'fixtures', 'dbt-manifests', `${name}.json`), 'utf8'));
const backend = new DbtBackend();

suite('BigQuery for dbt: what is dry-run and previewed', () => {
    const { graph } = buildDbtGraph(manifest('dbt-v2'));
    const shownIn = (file: string) => fileSlice(graph, backend, file, 1).actions.map((action) => action.id);
    const kinds = (file: string) => dbtActionsToDryRun(graph, shownIn(file)).map((action) => action.kind);

    test('a model and every test shown with it, and not its unit test', () => {
        assert.deepStrictEqual(kinds('models/marts/fct_orders.sql'), ['incremental', 'test', 'test', 'test']);
    });

    test('an ephemeral model, a snapshot and an analysis are; a seed, sources and exposures are not', () => {
        assert.deepStrictEqual(kinds('models/intermediate/int_customer_countries.sql'), ['ephemeral']);
        assert.deepStrictEqual(kinds('analyses/revenue_by_country.sql'), ['analysis']);
        assert.deepStrictEqual(kinds('snapshots/customers_snapshot.yml'), ['snapshot']);
        assert.deepStrictEqual(kinds('seeds/country_codes.csv'), []);
        assert.deepStrictEqual(kinds('models/staging/_sources.yml'), []);
        assert.deepStrictEqual(kinds('models/reporting/_exposures.yml'), []);
    });

    test('nothing of a Project that was only parsed: its SQL is as written', () => {
        const parsed = buildDbtGraph(manifest('dbt-v2-hooks-parsed')).graph;
        assert.deepStrictEqual(dbtActionsToDryRun(parsed, Object.keys(parsed.actions)), []);
    });

    test('a preview runs the compiled query alone, never a hook', () => {
        const model = graph.actions[shownIn('models/marts/dim_customers.sql')[0]];
        assert.deepStrictEqual(model.sections.map((section) => section.title), ['pre-hook', 'query', 'post-hook']);
        const preview = previewQuery(model, 'query');
        assert.deepStrictEqual(preview?.sections, ['query']);
        assert.ok(preview?.sql.includes('stg_customers') && !preview.sql.includes('run_started'));
        assert.strictEqual(previewQuery(model, 'pre-hook'), undefined);
        assert.strictEqual(previewQuery(model, 'post-hook'), undefined);
    });
});
