import * as assert from 'assert';
import { suite, test } from 'mocha';
import { diffSchemas, findSelectAlias, findTopLevelSelect, impactMessage, selectOutputNames } from '../../columnLineage/impactRules';
import { ColumnLink } from '../../shared/columnLineage/types';

const SQL = `-- top scorers, with a SELECT in this comment
WITH appearances AS (
  SELECT player_id, COUNT(*) AS games FROM \${ref("matches")} GROUP BY 1
)
, goals AS (SELECT player_id, SUM(goals) AS goals FROM \${ref("events")} GROUP BY player_id)
SELECT
  a.player_id,
  CAST(g.goals AS STRING) AS goals_text,
  SAFE_DIVIDE(g.goals, a.games) goals_per_game,
  \`team name\`,
  'SELECT' AS label
FROM appearances AS a
JOIN goals AS g USING (player_id)`;

suite('Column impact: schema diff', () => {
    test('finds dropped and retyped top-level columns, case-insensitively, treating legacy type names as equal', () => {
        const impacts = diffSchemas(
            [{ name: 'PLAYER_ID', type: 'INTEGER' }, { name: 'goals', type: 'STRING' }, { name: 'is_captain', type: 'BOOL' }],
            [{ name: 'player_id', type: 'INT64' }, { name: 'goals', type: 'INTEGER' }, { name: 'assists', type: 'INTEGER' }, { name: 'is_captain', type: 'BOOLEAN' }],
        );
        assert.deepStrictEqual(impacts, [
            { column: 'goals', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' } },
            { column: 'assists', change: { kind: 'dropped' } },
        ]);
    });
});

suite('Column impact: anchors', () => {
    test('finds the final top-level SELECT, past comments and CTE bodies', () => {
        const range = findTopLevelSelect(SQL)!;
        assert.strictEqual(SQL.slice(range.start, range.end), 'SELECT');
        assert.strictEqual(SQL.slice(0, range.start).split('\n').length, 6);
    });

    test('reads output names: aliases with and without AS, CAST inside, qualified and backticked columns', () => {
        assert.deepStrictEqual(selectOutputNames(SQL).map((item) => item.name), ['player_id', 'goals_text', 'goals_per_game', 'team name', 'label']);
        const alias = findSelectAlias(SQL, 'GOALS_TEXT')!;
        assert.strictEqual(SQL.slice(alias.start, alias.end), 'goals_text');
        assert.strictEqual(findSelectAlias(SQL, 'games'), undefined);
    });

    test('handles a plain query with no CTEs and the last column right before FROM', () => {
        const sql = 'SELECT player_id, goals FROM `p.d.t`';
        assert.deepStrictEqual(selectOutputNames(sql).map((item) => item.name), ['player_id', 'goals']);
    });
});

suite('Column impact: message', () => {
    const focus = 'p.mart.player_stats';
    const reader = (table: string, column: string, dependencyType: ColumnLink['dependencyType']): ColumnLink => ({ table: `p.${table}`, column, dependencyType });

    test('says nothing when nothing reads the column', () => {
        assert.strictEqual(impactMessage({ column: 'assists', change: { kind: 'dropped' } }, [], focus), undefined);
    });

    test('lists copies first, labels the rest, and counts readers past the first three', () => {
        const message = impactMessage({ column: 'goals', change: { kind: 'dropped' } }, [
            reader('rpt.league_table', 'points', 'OTHER'),
            reader('rpt.top_scorers', 'goals', 'EXACT_COPY'),
            reader('rpt.form', 'goals_last_5', 'OTHER'),
            reader('rpt.awards', 'golden_boot', 'OTHER'),
            reader('rpt.season', 'goals', 'EXACT_COPY'),
            { table: 'p.rpt.match_events', dependencyType: 'TABLE_ONLY' },
        ], focus);
        assert.strictEqual(message,
            'goals exists in prod but this query no longer produces it. ' +
            'Still read by 5 columns: rpt.season.goals (copy), rpt.top_scorers.goals (copy), rpt.awards.golden_boot (derived or filtered) and 2 more. ' +
            'May also read it (no column detail): rpt.match_events. ' +
            'Dataplex lineage for mart.player_stats, last 30 days.');
    });

    test('describes a type change, and a reader known only at table level', () => {
        assert.strictEqual(
            impactMessage({ column: 'goals', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' } }, [{ table: 'p.rpt.match_events', dependencyType: 'TABLE_ONLY' }], focus),
            'goals changes type from INT64 to STRING. May also read it (no column detail): rpt.match_events. Dataplex lineage for mart.player_stats, last 30 days.');
    });
});
