import { ColumnChange } from '../shared/columnLineage/types';

// Which columns of a query changed against its Prod Target, for the column impact check.

export interface SchemaField {
    name: string;
    type: string;
}

export interface ColumnImpact {
    /** Column name as prod spells it */
    column: string;
    change: ColumnChange;
}

/** Legacy and standard SQL names for the same type */
const TYPE_ALIASES: Record<string, string> = {
    INTEGER: 'INT64',
    FLOAT: 'FLOAT64',
    BOOLEAN: 'BOOL',
    RECORD: 'STRUCT',
};

function normaliseType(type: string): string {
    const upper = (type ?? '').toUpperCase();
    return TYPE_ALIASES[upper] ?? upper;
}

/**
 * Top-level columns that prod has but the dry run no longer produces, and those whose type changed. Names
 * compare case-insensitively, as in BigQuery. Nested fields and mode changes are left out.
 */
export function diffSchemas(devFields: SchemaField[], prodFields: SchemaField[]): ColumnImpact[] {
    const dev = new Map(devFields.map((field) => [field.name.toLowerCase(), field]));
    const impacts: ColumnImpact[] = [];
    for (const prod of prodFields) {
        const match = dev.get(prod.name.toLowerCase());
        if (!match) {
            impacts.push({ column: prod.name, change: { kind: 'dropped' } });
        } else if (normaliseType(match.type) !== normaliseType(prod.type)) {
            impacts.push({ column: prod.name, change: { kind: 'typeChanged', from: normaliseType(prod.type), to: normaliseType(match.type) } });
        }
    }
    return impacts;
}
