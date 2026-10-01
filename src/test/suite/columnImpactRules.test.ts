import * as assert from 'assert';
import { suite, test } from 'mocha';
import { diffSchemas } from '../../columnLineage/impactRules';
import { ImpactAnalysis, toImpactEntries } from '../../columnLineage/impactReport';
import { tableActions } from '../../shared/columnLineage/tableActions';

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

    test('reports nothing when the dry run matches prod', () => {
        assert.deepStrictEqual(diffSchemas([{ name: 'player_id', type: 'INT64' }], [{ name: 'PLAYER_ID', type: 'INTEGER' }]), []);
    });
});

suite('Column impact: entries for the panel', () => {
    test('counts copies, derived and may-read readers, and lists columns with readers first', () => {
        const entries = toImpactEntries({
            table: 'p.mart.player_stats',
            results: [
                { impact: { column: 'assists', change: { kind: 'dropped' } }, links: [] },
                {
                    impact: { column: 'goals', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' } },
                    links: [
                        { table: 'p.rpt.top_scorers', column: 'goals', dependencyType: 'EXACT_COPY' },
                        { table: 'p.rpt.league_table', column: 'points', dependencyType: 'OTHER' },
                        { table: 'p.rpt.match_events', dependencyType: 'TABLE_ONLY' },
                    ],
                },
            ],
        } as unknown as ImpactAnalysis);
        assert.deepStrictEqual(entries, [
            { column: 'goals', change: { kind: 'typeChanged', from: 'INT64', to: 'STRING' }, copies: 1, derived: 1, mayRead: 1 },
            { column: 'assists', change: { kind: 'dropped' }, copies: 0, derived: 0, mayRead: 0 },
        ]);
    });
});

suite('Column impact: which action to check', () => {
    test('ignores built-in assertions compiled from the same file', () => {
        const actions = [{ type: 'table', name: 'player_stats' }, { type: 'assertion', name: 'player_stats_assertions_uniqueKey_0' }];
        assert.deepStrictEqual(tableActions(actions).map((action) => action.name), ['player_stats']);
        assert.deepStrictEqual(tableActions([{ type: 'operations' }, { type: 'test' }]), []);
        assert.deepStrictEqual(tableActions(undefined), []);
    });
});
