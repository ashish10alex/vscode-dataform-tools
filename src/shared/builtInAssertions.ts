/*
 * Recognises the assertions Dataform generates from a table's `assertions` config block,
 * shared by the extension and the webview (no `vscode` import).
 *
 * @dataform/core names them `<schema>_<table>_assertions_uniqueKey_<n>` and
 * `<schema>_<table>_assertions_rowConditions`, and folds `nonNull` columns into the
 * rowConditions assertion as `<col> IS NOT NULL`, so the SQL is the only place left to tell them apart.
 */

export type BuiltInAssertionKind = 'uniqueKey' | 'nonNull' | 'rowConditions';

export interface BuiltInAssertion {
    kind: BuiltInAssertionKind;
    label: string;
    /** The columns or conditions the assertion checks, one per entry; empty when the SQL could not be parsed. */
    checks: string[];
}

const LABELS: Record<BuiltInAssertionKind, string> = {
    uniqueKey: 'unique key',
    nonNull: 'non-null',
    rowConditions: 'row conditions',
};

const UNIQUE_KEY_NAME = /_assertions_uniqueKey_\d+$/;
const ROW_CONDITIONS_NAME = /_assertions_rowConditions$/;
const UNIQUE_KEY_COLUMNS = /GROUP BY ([\s\S]*?)\s*\)\s*AS data/;
const ROW_CONDITION = /WHERE NOT \(([\s\S]*?)\)\s*(?=UNION ALL\s+SELECT|$)/g;
const NON_NULL_CONDITION = /^(`[^`]+`|[\w.]+)\s+IS NOT NULL$/i;

function builtIn(kind: BuiltInAssertionKind, checks: string[]): BuiltInAssertion {
    return { kind, label: LABELS[kind], checks };
}

/**
 * The built-in assertions an assertion action was generated from: one entry for a unique key, up to two
 * (non-null, row conditions) for a rowConditions assertion, none for a hand-written assertion.
 */
export function describeBuiltInAssertion(targetName: string, query: string | undefined): BuiltInAssertion[] {
    const sql = (query ?? '').trim();

    if (UNIQUE_KEY_NAME.test(targetName)) {
        const columns = UNIQUE_KEY_COLUMNS.exec(sql)?.[1];
        return [builtIn('uniqueKey', columns ? columns.split(',').map(c => c.trim()) : [])];
    }

    if (!ROW_CONDITIONS_NAME.test(targetName)) {
        return [];
    }

    const conditions = Array.from(sql.matchAll(ROW_CONDITION), m => m[1].trim());
    const nonNullColumns: string[] = [];
    const rowConditions: string[] = [];
    for (const condition of conditions) {
        const column = NON_NULL_CONDITION.exec(condition)?.[1];
        if (column) {
            nonNullColumns.push(column);
        } else {
            rowConditions.push(condition);
        }
    }

    const result: BuiltInAssertion[] = [];
    if (nonNullColumns.length > 0) {
        result.push(builtIn('nonNull', nonNullColumns));
    }
    if (rowConditions.length > 0 || result.length === 0) {
        result.push(builtIn('rowConditions', rowConditions));
    }
    return result;
}
