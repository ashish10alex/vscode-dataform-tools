/*
 * Where a YAML file defines a dbt resource. A manifest gives a resource's file and no line of it, so the line is
 * looked for in the file's text. The text is scanned, not parsed: a parser would have to be asked for positions,
 * and a file that is being edited may not parse.
 */

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `name:` entry of exactly `name`, in quotes or not, whether or not it starts a list item */
const entryOf = (name: string) => new RegExp(`^\\s*(?:-\\s+)?name\\s*:\\s*(['"]?)${escaped(name)}\\1\\s*(?:#.*)?$`);

/**
 * The line of `text`, counted from 0, that declares a generic test: the first line with the test's name after the
 * entry of the column it is under, or of the model when it is under none, and before the next entry. Failing that
 * the column's entry, then the model's. Undefined when the file has not even the model's.
 */
export function testLine(text: string, test: { name: string; under?: string; column?: string }): number | undefined {
    const lines = text.split(/\r?\n/);
    const find = (name: string, from: number) => {
        const entry = entryOf(name);
        const at = lines.findIndex((line, index) => index >= from && entry.test(line));
        return at === -1 ? undefined : at;
    };
    const under = test.under === undefined ? undefined : find(test.under, 0);
    const column = test.column === undefined ? undefined : find(test.column, under === undefined ? 0 : under + 1);
    const from = column ?? under;
    if (from === undefined) {
        return undefined;
    }
    // As a word of its own: `unique` in `[unique, not_null]`, `- relationships:`, `- dbt_utils.expression_is_true:`
    const named = new RegExp(`(^|[^\\w.])${escaped(test.name)}(?![\\w.])`);
    const indent = (line: string) => line.length - line.trimStart().length;
    for (let at = from + 1; at < lines.length; at++) {
        // The next entry at the depth of the one searched under, or above it, ends it
        if (/^\s*-\s+name\s*:/.test(lines[at]) && indent(lines[at]) <= indent(lines[from])) {
            break;
        }
        // Not in a comment, and not in the prose of a description
        if (!/^\s*description\s*:/.test(lines[at]) && named.test(lines[at].replace(/#.*$/, ''))) {
            return at;
        }
    }
    return from;
}

/**
 * The line of `text`, counted from 0, that names the resource: its `name:` entry. A source's table is looked for
 * after its source's entry, as two sources may have a table of one name. Undefined when the file names no such
 * resource.
 */
export function definitionLine(text: string, resource: { name: string; sourceName?: string }): number | undefined {
    const lines = text.split(/\r?\n/);
    const find = (name: string, from: number) => {
        const entry = entryOf(name);
        const at = lines.findIndex((line, index) => index >= from && entry.test(line));
        return at === -1 ? undefined : at;
    };
    if (resource.sourceName) {
        const source = find(resource.sourceName, 0);
        return find(resource.name, source === undefined ? 0 : source + 1) ?? source;
    }
    return find(resource.name, 0);
}
