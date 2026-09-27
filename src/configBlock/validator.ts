import { ConfigObject, ConfigProperty, ParsedConfigBlock } from './parser';
import {
    DEFAULT_ACTION_TYPE,
    KeyInfo,
    KeySet,
    SqlxActionType,
    allKnownKeysAtPath,
    getKeySetAtPath,
    isSqlxActionType,
    typesAllowingKey,
} from './schema';

export type ConfigIssueCode =
    | 'unknown-key'
    | 'key-not-for-type'
    | 'invalid-enum'
    | 'wrong-value-kind'
    | 'partition-options-without-partitionBy'
    | 'duplicate-key';

export interface ConfigIssue {
    code: ConfigIssueCode;
    message: string;
    start: number;
    end: number;
    /** Text that fixes the issue when it replaces [start, end). */
    replacement?: string;
    /** Range that removes the offending property, including its comma and line. */
    removal?: { start: number; end: number };
}

export interface ValidateOptions {
    /**
     * Skip the unknown-key and key-not-for-type checks. Used for Dataform 2.x projects, which accept
     * a different set of keys than the bundled 3.x schema.
     */
    skipKeyChecks?: boolean;
}

/** The action type of a config block, or undefined when `type` is not a string literal. */
export function getActionType(parsed: ParsedConfigBlock): SqlxActionType | undefined {
    const typeProperty = parsed.root.properties.find(p => p.key === 'type');
    if (!typeProperty) {
        return DEFAULT_ACTION_TYPE;
    }
    if (typeProperty.value.kind === 'string' && isSqlxActionType(typeProperty.value.text)) {
        return typeProperty.value.text;
    }
    return undefined;
}

/** Keys allowed at `path`; falls back to the union over all types when the type is unknown. */
export function keySetFor(type: SqlxActionType | undefined, path: string[]): KeySet | undefined {
    if (type) {
        return getKeySetAtPath(type, path);
    }
    const union = allKnownKeysAtPath(path);
    return union.size > 0 ? union : undefined;
}

export function validateConfigBlock(parsed: ParsedConfigBlock, options: ValidateOptions = {}): ConfigIssue[] {
    const issues: ConfigIssue[] = [];
    const type = getActionType(parsed);
    validateObject(parsed, parsed.root, [], type, options, issues);
    if (type === undefined || type === 'table' || type === 'incremental') {
        checkPartitionOptions(parsed.root, issues);
    }
    return issues;
}

function validateObject(
    parsed: ParsedConfigBlock,
    object: ConfigObject,
    path: string[],
    type: SqlxActionType | undefined,
    options: ValidateOptions,
    issues: ConfigIssue[],
) {
    const keySet = keySetFor(type, path);
    const seen = new Set<string>();

    object.properties.forEach((property, index) => {
        if (seen.has(property.key)) {
            issues.push({
                code: 'duplicate-key',
                message: `Duplicate config option "${property.key}". Only the last value is used.`,
                start: property.keyStart,
                end: property.keyEnd,
                removal: removalRange(parsed.text, object, index),
            });
        }
        seen.add(property.key);

        const info = keySet?.get(property.key);
        if (keySet && !info) {
            if (!options.skipKeyChecks) {
                issues.push(unknownKeyIssue(parsed, object, index, path, type, keySet));
            }
        } else if (info) {
            validateValue(property, info, issues);
        }

        if (property.value.kind === 'object') {
            validateObject(parsed, property.value.object, [...path, property.key], type, options, issues);
        }
    });
}

function unknownKeyIssue(
    parsed: ParsedConfigBlock,
    object: ConfigObject,
    index: number,
    path: string[],
    type: SqlxActionType | undefined,
    keySet: KeySet,
): ConfigIssue {
    const property = object.properties[index];
    const where = path.length > 0 ? ` in "${path.join('.')}"` : '';
    const allowedTypes = typesAllowingKey(path, property.key);
    if (type && allowedTypes.length > 0) {
        return {
            code: 'key-not-for-type',
            message: `"${property.key}" is not a valid option${where} for type "${type}". It only applies to type: ${allowedTypes.join(', ')}.`,
            start: property.keyStart,
            end: property.keyEnd,
            removal: removalRange(parsed.text, object, index),
        };
    }
    const suggestion = closestMatch(property.key, [...keySet.keys()]);
    return {
        code: 'unknown-key',
        message: `Unknown config option "${property.key}"${where}.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
        start: property.keyStart,
        end: property.keyEnd,
        replacement: suggestion,
        removal: removalRange(parsed.text, object, index),
    };
}

function validateValue(property: ConfigProperty, info: KeyInfo, issues: ConfigIssue[]) {
    const { value } = property;

    if (info.enumValues && value.kind === 'string') {
        const names = info.enumValues.map(v => v.name);
        const matches = info.enumCaseInsensitive
            ? names.some(name => name.toUpperCase() === value.text.toUpperCase())
            : names.includes(value.text);
        if (!matches) {
            const suggestion = closestMatch(value.text, names);
            issues.push({
                code: 'invalid-enum',
                message: `"${value.text}" is not a valid value for "${property.key}". Expected one of: ${names.join(', ')}.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
                // Just the string contents, without quotes.
                start: value.start + 1,
                end: value.end - 1,
                replacement: suggestion,
            });
        }
        return;
    }

    // Only flag unambiguous mismatches; core converts some legacy forms (e.g. string -> array).
    const expectsBoolean = info.kind === 'boolean' && (value.kind === 'string' || value.kind === 'number');
    const expectsString = info.kind === 'string' && (value.kind === 'boolean' || value.kind === 'number');
    if (expectsBoolean || expectsString) {
        issues.push({
            code: 'wrong-value-kind',
            message: `"${property.key}" expects a ${info.kind}, but got a ${value.kind}.`,
            start: value.start,
            end: value.end,
        });
    }
}

/** requirePartitionFilter / partitionExpirationDays are rejected by core without partitionBy. */
function checkPartitionOptions(root: ConfigObject, issues: ConfigIssue[]) {
    const bigquery = root.properties.find(p => p.key === 'bigquery');
    const bigqueryProperties = bigquery?.value.kind === 'object' ? bigquery.value.object.properties : [];
    const all = [...root.properties, ...bigqueryProperties];
    if (all.some(p => p.key === 'partitionBy')) {
        return;
    }
    for (const property of all) {
        if (property.key === 'requirePartitionFilter' || property.key === 'partitionExpirationDays') {
            issues.push({
                code: 'partition-options-without-partitionBy',
                message: `"${property.key}" requires "partitionBy" to be set. It is not valid for non partitioned BigQuery tables.`,
                start: property.keyStart,
                end: property.keyEnd,
            });
        }
    }
}

/**
 * Range that deletes the property at `index` together with its separating comma. When the property
 * sits on its own line(s), the whole line is removed.
 */
export function removalRange(text: string, object: ConfigObject, index: number): { start: number; end: number } {
    const property = object.properties[index];
    const propertyEnd = Math.max(property.end, property.value.end);

    // Include a trailing comma directly after the property.
    let end = propertyEnd;
    let scan = end;
    while (scan < text.length && (text[scan] === ' ' || text[scan] === '\t')) {
        scan++;
    }
    if (text[scan] === ',') {
        end = scan + 1;
    }

    const lineStart = text.lastIndexOf('\n', property.start - 1) + 1;
    const onlyWhitespaceBefore = text.slice(lineStart, property.start).trim() === '';
    let lineEnd = text.indexOf('\n', end);
    if (lineEnd === -1) {
        lineEnd = text.length;
    }
    const onlyWhitespaceAfter = text.slice(end, lineEnd).trim() === '';
    if (onlyWhitespaceBefore && onlyWhitespaceAfter && lineEnd < text.length) {
        return { start: lineStart, end: lineEnd + 1 };
    }

    if (end === propertyEnd && index > 0) {
        // Last property on a shared line: remove the comma before it instead.
        const previous = object.properties[index - 1];
        return { start: Math.max(previous.end, previous.value.end), end: propertyEnd };
    }
    return { start: property.start, end };
}

/** The candidate closest to `input` if it's a plausible typo, otherwise undefined. */
export function closestMatch(input: string, candidates: string[]): string | undefined {
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        if (candidate.toLowerCase() === input.toLowerCase()) {
            return candidate;
        }
        const distance = levenshtein(input.toLowerCase(), candidate.toLowerCase());
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    const threshold = input.length >= 8 ? 3 : 2;
    return bestDistance <= threshold && bestDistance < input.length ? best : undefined;
}

function levenshtein(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0];
        previous[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const above = previous[j];
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
            diagonal = above;
        }
    }
    return previous[b.length];
}
