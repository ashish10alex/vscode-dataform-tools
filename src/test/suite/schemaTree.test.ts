import * as assert from 'assert';
import { suite, test } from 'mocha';
import { ColumnMetadata } from '../../types';
import { applyColumnDescriptions, buildColumnsConfig, flattenSchemaFields, flattenSchemaRows, formatAsUnquotedJson, pathKey } from '../../utils/schemaTree';

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
    suite('flattenSchemaRows', () => {
        test('lists each parent immediately before its children, with their depth', () => {
            const { rows, omitted } = flattenSchemaRows(deepSchema());
            assert.strictEqual(omitted, 0);
            assert.deepStrictEqual(rows.map((row) => [row.name, row.depth]), [
                ['customer', 0],
                ['address', 1],
                ['city', 2],
                ['id', 1],
                ['id', 0],
                ['order', 0],
                ['id', 1],
                ['tags', 0],
            ]);
        });

        test('carries the full path from the root, for nested fields too', () => {
            const { rows } = flattenSchemaRows(deepSchema());
            const paths = rows.map((row) => row.path.join('.'));
            assert.deepStrictEqual(paths, [
                'customer',
                'customer.address',
                'customer.address.city',
                'customer.id',
                'id',
                'order',
                'order.id',
                'tags',
            ]);
        });

        test('sorts siblings by name at every depth', () => {
            const { rows } = flattenSchemaRows([
                { name: 'b', type: 'RECORD', fields: [{ name: 'z', type: 'STRING' }, { name: 'a', type: 'STRING' }] },
                { name: 'a', type: 'STRING' },
            ]);
            assert.deepStrictEqual(rows.map((row) => row.name), ['a', 'b', 'a', 'z']);
        });

        test('appends the mode to the type unless it is NULLABLE', () => {
            const { rows } = flattenSchemaRows(deepSchema());
            const byName = (name: string) => rows.find((row) => row.name === name)!;
            assert.strictEqual(byName('tags').type, 'STRING REPEATED');
            assert.strictEqual(byName('customer').type, 'RECORD');
            assert.strictEqual(rows.filter((row) => row.name === 'id')[1].type, 'STRING REQUIRED');
        });

        test('caps the rows and counts every field left out, descendants included', () => {
            const all = flattenSchemaRows(realShapeSchema());
            assert.strictEqual(all.rows.length, 39);

            const { rows, omitted } = flattenSchemaRows(realShapeSchema(), { maxRows: 10 });
            assert.strictEqual(rows.length, 10);
            assert.strictEqual(omitted, 29);
        });

        test('skips the children of a record it stopped at rather than half listing them', () => {
            const fields: ColumnMetadata[] = [
                scalar('a'),
                { name: 'b', type: 'RECORD', fields: [scalar('b1'), scalar('b2')] },
            ];
            const { rows, omitted } = flattenSchemaRows(fields, { maxRows: 1 });
            assert.deepStrictEqual(rows.map((row) => row.name), ['a']);
            assert.strictEqual(omitted, 3);
        });

        test('does not mutate the input', () => {
            const fields = deepSchema();
            const snapshot = JSON.stringify(fields);
            flattenSchemaRows(fields, { maxRows: 2 });
            assert.strictEqual(JSON.stringify(fields), snapshot);
        });
    });
});
