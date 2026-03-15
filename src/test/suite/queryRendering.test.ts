import * as assert from 'assert';
import { suite, test } from 'mocha';
import { processQueryResults } from '../../bigqueryRunQuery';

// Mock BigQuery wrapper types
class Big {
    constructor(public v: string, public s?: number, public e?: number, public c?: number[]) {}
    toString() { return this.v; }
}

class BigQueryDate {
    constructor(public value: string) {}
    toString() { return this.value; }
}

class BigQueryDatetime {
    constructor(public value: string) {}
    toString() { return this.value; }
}

class BigQueryTime {
    constructor(public value: string) {}
    toString() { return this.value; }
}

class BigQueryTimestamp {
    constructor(public value: string) {}
    toString() { return this.value; }
}

class BigQueryInterval {
    constructor(public months: number, public days: number, public subsecond_nanos: number) {}
    toString() { return `${this.months}, ${this.days}, ${this.subsecond_nanos}`; }
}

suite('Query Result Rendering Tests', () => {
    test('Should correctly render various BigQuery types', () => {
        const mockRows = [
            {
                INT64_COL: 1234567890,
                INT_COL: 42,
                BIGINT_COL: "1234567890123456789",
                SMALLINT_COL: 1,
                TINYINT_COL: 123,
                FLOAT64_COL: 3.141,
                NUMERIC_VALUE: new Big("0.1902305224", 1, -1, [1, 9, 0, 2, 3, 0, 5, 2, 2, 4]),
                BOOL_COL: true,
                STRING_COL: "Hello BigQuery",
                BYTES_COL: Buffer.from("SGVsbG8gQmlnUXVlcnkh"),
                DATE_COL: new BigQueryDate("2025-12-10"),
                DATETIME_COL: new BigQueryDatetime("2025-12-10T14:30:45.123456"),
                TIME_COL: new BigQueryTime("14:30:45.123456"),
                TIMESTAMP_COL: new BigQueryTimestamp("2025-12-10T22:30:45.123456Z"),
                INTERVAL_COL: new BigQueryInterval(0, 15, 0),
                ARRAY_INT64_COL: [1, 2, 3, 5],
                ARRAY_STRING_COL: ["apple", "banana", "cherry"],
                STRUCT_COL: { NAME: "Alice", AGE: 30, ACTIVE: true },
                GEOGRAPHY_COL: "POINT(-122.4194 37.7749)",
                json_col: { product: "laptop", price: 999, in_stock: true }
            }
        ];

        const { results, columns } = processQueryResults(mockRows);

        assert.strictEqual(results.length, 1);
        assert.ok(columns.length > 0, "Should have generated columns");
        
        // Check some expected columns
        const columnFields = columns.map(c => c.field);
        assert.ok(columnFields.includes("INT64_COL"));
        assert.ok(columnFields.includes("NUMERIC_VALUE"));
        assert.ok(columnFields.includes("STRUCT_COL_x_NAME"));
        const row = results[0];

        // Basic types
        assert.strictEqual(row.INT64_COL, 1234567890);
        assert.strictEqual(row.INT_COL, 42);
        assert.strictEqual(row.BIGINT_COL, "1234567890123456789");
        assert.strictEqual(row.FLOAT64_COL, 3.141);
        assert.strictEqual(row.BOOL_COL, true);
        assert.strictEqual(row.STRING_COL, "Hello BigQuery");

        // Fixed NUMERIC type (should be string, not flattened)
        assert.strictEqual(row.NUMERIC_VALUE, "0.1902305224");

        // Dates and Times
        assert.strictEqual(row.DATE_COL, "2025-12-10");
        assert.strictEqual(row.DATETIME_COL, "2025-12-10T14:30:45.123456");
        assert.strictEqual(row.TIME_COL, "14:30:45.123456");
        assert.strictEqual(row.TIMESTAMP_COL, "2025-12-10T22:30:45.123456Z");

        // Interval
        assert.strictEqual(row.INTERVAL_COL, "0, 15, 0");

        // Array of primitives (Flattened: first element in row, rest in _children if we hadn't shifted it)
        // Wait, processQueryResults shifts the first child into the main obj.
        assert.strictEqual(row.ARRAY_INT64_COL, 1);
        assert.strictEqual(row.ARRAY_STRING_COL, "apple");

        // Struct (Gets flattened by queryBigQuery if it's an object)
        assert.strictEqual(row.STRUCT_COL_x_NAME, "Alice");
        assert.strictEqual(row.STRUCT_COL_x_AGE, 30);
        assert.strictEqual(row.STRUCT_COL_x_ACTIVE, true);

        // JSON (Also gets flattened if it's an object)
        assert.strictEqual(row.json_col_x_product, "laptop");
        assert.strictEqual(row.json_col_x_price, 999);
        assert.strictEqual(row.json_col_x_in_stock, true);

        assert.strictEqual(row.GEOGRAPHY_COL, "POINT(-122.4194 37.7749)");
    });
});
