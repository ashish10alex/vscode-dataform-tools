import * as assert from 'assert';
import { suite, test } from 'mocha';
import { ColumnMetadata } from '../../types';
import { applyColumnDescriptions, buildColumnsConfig, flattenSchemaFields, formatAsUnquotedJson, pathKey } from '../../utils/schemaTree';

const scalar = (name: string, type = 'STRING'): ColumnMetadata => ({ name, type });

// Same shape as a real dry-run schema: 21 top-level fields (mode omitted for NULLABLE),
// two of which are REPEATED RECORDs with 8 and 10 children.
const realShapeSchema = (): ColumnMetadata[] => [
    ...Array.from({ length: 15 }, (_, i) => scalar(`COL_${i}`)),
    { name: 'FEATURES', type: 'RECORD', mode: 'REPEATED', fields: Array.from({ length: 8 }, (_, i) => scalar(`FEAT_${i}`)) },
    scalar('WEEK_ID', 'INTEGER'),
    { name: 'HOLDS', type: 'RECORD', mode: 'REPEATED', fields: Array.from({ length: 10 }, (_, i) => scalar(`HOLD_${i}`)) },
    scalar('N_HOLDS', 'INTEGER'),
    scalar('HOLD_IDS'),
    scalar('HOLD_IDENTIFIERS'),
];

const deepSchema = (): ColumnMetadata[] => [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'tags', type: 'STRING', mode: 'REPEATED' },
    {
        name: 'customer', type: 'RECORD', fields: [
            { name: 'id', type: 'STRING' },
            {
                name: 'address', type: 'RECORD', fields: [
                    { name: 'city', type: 'STRING' },
                ]
            },
        ]
    },
    { name: 'order', type: 'RECORD', fields: [{ name: 'id', type: 'INTEGER' }] },
];

suite('schemaTree', () => {
    suite('applyColumnDescriptions', () => {
        test('matches descriptions on the full path at any depth', () => {
            const result = applyColumnDescriptions(deepSchema(), [
                { path: ['id'], description: 'top id' },
                { path: ['customer'], description: 'the customer' },
                { path: ['customer', 'id'], description: 'customer id' },
                { path: ['customer', 'address', 'city'], description: 'city name' },
                { path: ['order', 'id'], description: 'order id' },
            ]);
            assert.strictEqual(result[0].description, 'top id');
            assert.strictEqual(result[2].description, 'the customer');
            assert.strictEqual(result[2].fields![0].description, 'customer id');
            assert.strictEqual(result[2].fields![1].fields![0].description, 'city name');
            assert.strictEqual(result[3].fields![0].description, 'order id');
        });

        test('keeps mode and nested fields', () => {
            const result = applyColumnDescriptions(deepSchema(), []);
            assert.strictEqual(result[0].mode, 'REQUIRED');
            assert.strictEqual(result[1].mode, 'REPEATED');
            assert.strictEqual(result[2].fields![1].fields![0].name, 'city');
        });

        test('does not mutate the input', () => {
            const input = deepSchema();
            const snapshot = JSON.stringify(input);
            applyColumnDescriptions(input, [{ path: ['customer', 'id'], description: 'changed' }]);
            assert.strictEqual(JSON.stringify(input), snapshot);
        });
    });

    suite('flattenSchemaFields', () => {
        test('lists every field at every depth, depth-first', () => {
            assert.strictEqual(flattenSchemaFields(realShapeSchema()).length, 39);
            assert.deepStrictEqual(
                flattenSchemaFields(deepSchema()).map((f) => f.name),
                ['id', 'tags', 'customer', 'id', 'address', 'city', 'order', 'id']
            );
        });
    });

    suite('buildColumnsConfig + formatAsUnquotedJson', () => {
        test('flat schema output is unchanged from the previous flat formatter', () => {
            const fields: ColumnMetadata[] = [
                { name: 'a', type: 'STRING', description: 'first "quoted"' },
                { name: 'b', type: 'INTEGER' },
            ];
            assert.strictEqual(
                formatAsUnquotedJson(buildColumnsConfig(fields)),
                '{\n  a: "first \\"quoted\\"",\n  b: ""\n}'
            );
        });

        test('nested schema output uses Dataform columns blocks and edited descriptions', () => {
            const edits = { [pathKey(['customer', 'address', 'city'])]: 'edited city' };
            const output = formatAsUnquotedJson(buildColumnsConfig(deepSchema(), edits));
            assert.strictEqual(output, [
                '{',
                '  id: "",',
                '  tags: "",',
                '  customer: {',
                '    description: "",',
                '    columns: {',
                '      id: "",',
                '      address: {',
                '        description: "",',
                '        columns: {',
                '          city: "edited city"',
                '        }',
                '      }',
                '    }',
                '  },',
                '  order: {',
                '    description: "",',
                '    columns: {',
                '      id: ""',
                '    }',
                '  }',
                '}',
            ].join('\n'));
        });
    });
});
