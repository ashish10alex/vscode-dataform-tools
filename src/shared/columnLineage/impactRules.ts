import { ColumnChange, ColumnEntry, ReaderCounts } from './types';

// Which columns of a query changed against its Prod Target, and how the column list orders them.

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

export function readerTotal(counts: ReaderCounts | undefined): number {
    return counts ? counts.copies + counts.derived + (counts.mayRead ?? 0) : 0;
}

/**
 * The column list: columns changed against prod first, most-read first with drops ahead of retypes on a tie,
 * then the rest of prod's columns in schema order, then columns only the dry run has. Without `dev` (no dry
 * run yet) nothing is labelled; without `prod` (no prod table yet) every dry-run column is new.
 */
export function columnEntries(
    prod: SchemaField[] | undefined,
    dev: SchemaField[] | undefined,
    counts: ReadonlyMap<string, ReaderCounts>,
): ColumnEntry[] {
    const changes = new Map((dev && prod ? diffSchemas(dev, prod) : []).map((impact) => [impact.column, impact.change]));
    const entry = (field: SchemaField): ColumnEntry => ({
        column: field.name,
        type: field.type,
        change: changes.get(field.name),
        counts: counts.get(field.name),
    });
    const prodEntries = (prod ?? []).map(entry);
    const changed = prodEntries
        .filter((candidate) => candidate.change)
        .sort((a, b) =>
            readerTotal(b.counts) - readerTotal(a.counts)
            || (a.change?.kind === 'dropped' ? 0 : 1) - (b.change?.kind === 'dropped' ? 0 : 1)
            || a.column.localeCompare(b.column));
    const prodNames = new Set((prod ?? []).map((field) => field.name.toLowerCase()));
    const added = (dev ?? [])
        .filter((field) => !prodNames.has(field.name.toLowerCase()))
        .map((field): ColumnEntry => ({ column: field.name, type: field.type, isNew: true }));
    return [...changed, ...prodEntries.filter((candidate) => !candidate.change), ...added];
}
