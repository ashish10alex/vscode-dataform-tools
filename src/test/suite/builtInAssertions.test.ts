import * as assert from 'assert';
import { suite, test } from 'mocha';
import { describeBuiltInAssertion } from '../../shared/builtInAssertions';

// The SQL @dataform/core 2.x/3.x generates for `assertions: { uniqueKey, nonNull, rowConditions }`.
const uniqueKeySql = (columns: string[]) => `
SELECT
  *
FROM (
  SELECT
    ${columns.join(', ')},
    COUNT(1) AS index_row_count
  FROM \`proj.ds.orders\`
  GROUP BY ${columns.join(', ')}
  ) AS data
WHERE index_row_count > 1
`;

const rowConditionsSql = (conditions: string[]) => conditions.map(c => `
SELECT
  '${c.replace(/'/g, "\\'")}' AS failing_row_condition,
  *
FROM \`proj.ds.orders\`
WHERE NOT (${c})
`).join('UNION ALL');

suite('builtInAssertions', () => {
    test('a hand-written assertion is not built in', () => {
        assert.deepStrictEqual(describeBuiltInAssertion('orders_have_rows', 'SELECT 1 FROM x WHERE NOT (a)'), []);
    });

    test('unique key assertions list their key columns', () => {
        assert.deepStrictEqual(
            describeBuiltInAssertion('ds_orders_assertions_uniqueKey_1', uniqueKeySql(['order_id', 'line_no'])),
            [{ kind: 'uniqueKey', label: 'unique key', checks: ['order_id', 'line_no'] }],
        );
    });

    test('a rowConditions assertion made only of IS NOT NULL checks is non-null', () => {
        assert.deepStrictEqual(
            describeBuiltInAssertion('ds_orders_assertions_rowConditions', rowConditionsSql(['order_id IS NOT NULL', '`order date` IS NOT NULL'])),
            [{ kind: 'nonNull', label: 'non-null', checks: ['order_id', '`order date`'] }],
        );
    });

    test('nonNull and rowConditions folded into one assertion give both kinds', () => {
        assert.deepStrictEqual(
            describeBuiltInAssertion('ds_orders_assertions_rowConditions', rowConditionsSql(['order_id IS NOT NULL', 'amount > 0 OR (status = "void")'])),
            [
                { kind: 'nonNull', label: 'non-null', checks: ['order_id'] },
                { kind: 'rowConditions', label: 'row conditions', checks: ['amount > 0 OR (status = "void")'] },
            ],
        );
    });

    test('a compound IS NOT NULL condition stays a row condition', () => {
        assert.deepStrictEqual(
            describeBuiltInAssertion('ds_orders_assertions_rowConditions', rowConditionsSql(['a IS NOT NULL OR b IS NOT NULL'])),
            [{ kind: 'rowConditions', label: 'row conditions', checks: ['a IS NOT NULL OR b IS NOT NULL'] }],
        );
    });

    test('unparseable SQL still names the kind from the action name', () => {
        assert.deepStrictEqual(
            describeBuiltInAssertion('ds_orders_assertions_rowConditions', undefined),
            [{ kind: 'rowConditions', label: 'row conditions', checks: [] }],
        );
    });
});
