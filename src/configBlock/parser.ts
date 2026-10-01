import { parse as parseLoose } from 'acorn-loose';
import type { Expression, ObjectExpression, Property, SpreadElement } from 'acorn';

/**
 * Parses the `config { ... }` block of a `.sqlx` file into a small tree with document offsets.
 * Works on the raw file text so it can be unit tested without VS Code.
 */

export type ConfigValue =
    | { kind: 'string'; text: string; start: number; end: number }
    | { kind: 'number'; start: number; end: number }
    | { kind: 'boolean'; value: boolean; start: number; end: number }
    | { kind: 'array'; elements: ConfigValue[]; start: number; end: number }
    | { kind: 'object'; object: ConfigObject; start: number; end: number }
    /** Any JS expression we can't reason about: variables, calls, template strings with `${}`. */
    | { kind: 'dynamic'; start: number; end: number }
    | { kind: 'missing'; start: number; end: number };

export interface ConfigProperty {
    key: string;
    /** Range of the key text, excluding quotes. */
    keyStart: number;
    keyEnd: number;
    /** Range of the whole `key: value` property. */
    start: number;
    end: number;
    value: ConfigValue;
}

export interface ConfigObject {
    /** Offset of `{`. */
    start: number;
    /** Offset just after `}`. */
    end: number;
    properties: ConfigProperty[];
    /** True if the object contains `...spread` or computed keys we skipped. */
    hasDynamicKeys: boolean;
}

export interface ParsedConfigBlock {
    root: ConfigObject;
    /** The full document text the offsets refer to. */
    text: string;
}

/**
 * Returns a copy of `text` with comments and string contents replaced by spaces, so offsets are
 * preserved but braces and keywords inside them can't be mistaken for code.
 */
export function blankCommentsAndStrings(text: string): string {
    const out = text.split('');
    let i = 0;
    const blank = (from: number, to: number) => {
        for (let j = from; j < to && j < out.length; j++) {
            if (out[j] !== '\n') {
                out[j] = ' ';
            }
        }
    };
    while (i < text.length) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '/' && next === '/') {
            const end = text.indexOf('\n', i);
            const stop = end === -1 ? text.length : end;
            blank(i, stop);
            i = stop;
        } else if (ch === '/' && next === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? text.length : end + 2;
            blank(i, stop);
            i = stop;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            let j = i + 1;
            while (j < text.length && text[j] !== ch) {
                if (text[j] === '\\') {
                    j++;
                } else if (text[j] === '\n' && ch !== '`') {
                    break;
                }
                j++;
            }
            // Keep the quotes, blank the contents.
            blank(i + 1, j);
            i = j + 1;
        } else {
            i++;
        }
    }
    return out.join('');
}

/** Finds the `{` offset and the offset just after the matching `}` of the config block. */
export function findConfigBlockRange(text: string, blanked = blankCommentsAndStrings(text)): { start: number; end: number } | undefined {
    const match = /(^|\n)[ \t]*config\s*\{/.exec(blanked);
    if (!match) {
        return undefined;
    }
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < blanked.length; i++) {
        if (blanked[i] === '{') {
            depth++;
        } else if (blanked[i] === '}') {
            depth--;
            if (depth === 0) {
                return { start, end: i + 1 };
            }
        }
    }
    return undefined;
}

export function parseConfigBlock(text: string): ParsedConfigBlock | undefined {
    const range = findConfigBlockRange(text);
    if (!range) {
        return undefined;
    }
    // Wrap the object in parentheses so it parses as an expression. acorn-loose recovers from the
    // syntax errors of a config block being typed, e.g. `type: ,` parses with a missing value.
    const source = `(${text.slice(range.start, range.end)})`;
    let program;
    try {
        program = parseLoose(source, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch {
        return undefined;
    }
    const statement = program.body[0];
    if (!statement || statement.type !== 'ExpressionStatement' || statement.expression.type !== 'ObjectExpression') {
        return undefined;
    }
    // Maps offsets in `source` back to offsets in the document.
    const toDoc = (offset: number) => range.start + offset - 1;
    return { root: convertObject(statement.expression, source, toDoc), text };
}

/** acorn-loose fills in what is missing with a zero-width identifier named `✖`. */
const isPlaceholder = (node: { type: string; start: number; end: number; name?: string }) =>
    node.start === node.end || (node.type === 'Identifier' && node.name === '✖');

function convertObject(node: ObjectExpression, source: string, toDoc: (offset: number) => number): ConfigObject {
    const object: ConfigObject = {
        start: toDoc(node.start),
        end: toDoc(node.end),
        properties: [],
        hasDynamicKeys: false,
    };
    for (const property of node.properties as (Property | SpreadElement)[]) {
        if (property.type === 'SpreadElement' || property.computed) {
            object.hasDynamicKeys = true;
            continue;
        }
        const name = property.key;
        let key: string;
        let isQuoted = false;
        if (name.type === 'Identifier') {
            if (isPlaceholder(name)) {
                continue;
            }
            key = name.name;
        } else if (name.type === 'Literal' && (typeof name.value === 'string' || typeof name.value === 'number')) {
            key = String(name.value);
            isQuoted = typeof name.value === 'string';
        } else {
            object.hasDynamicKeys = true;
            continue;
        }
        let value: ConfigValue;
        let end = toDoc(property.end);
        if (property.kind === 'init' && !property.method && !property.shorthand) {
            value = convertValue(property.value as Expression, source, toDoc);
            if (value.kind === 'missing') {
                // A missing value sits right after the colon, not at the token acorn-loose stopped at
                const colon = source.indexOf(':', name.end);
                if (colon !== -1 && colon < property.value.start) {
                    end = toDoc(colon + 1);
                    value = { kind: 'missing', start: end, end };
                }
            }
        } else {
            // Shorthand `{ foo }`, methods and accessors: the value is not a literal.
            const end = toDoc(property.end);
            value = { kind: property.shorthand ? 'missing' : 'dynamic', start: end, end };
        }
        object.properties.push({
            key,
            keyStart: toDoc(name.start + (isQuoted ? 1 : 0)),
            keyEnd: toDoc(name.end - (isQuoted ? 1 : 0)),
            start: toDoc(property.start),
            end,
            value,
        });
    }
    return object;
}

function convertValue(node: Expression, source: string, toDoc: (offset: number) => number): ConfigValue {
    const start = toDoc(node.start);
    const end = toDoc(node.end);
    if (isPlaceholder(node)) {
        return { kind: 'missing', start, end };
    }
    switch (node.type) {
        case 'Literal':
            if (typeof node.value === 'string') {
                return { kind: 'string', text: node.value, start, end };
            }
            if (typeof node.value === 'number' || typeof node.value === 'bigint') {
                return { kind: 'number', start, end };
            }
            if (typeof node.value === 'boolean') {
                return { kind: 'boolean', value: node.value, start, end };
            }
            break;
        case 'TemplateLiteral':
            if (node.expressions.length === 0) {
                return { kind: 'string', text: node.quasis[0]?.value.cooked ?? '', start, end };
            }
            break;
        case 'UnaryExpression':
            if (['-', '+', '~', '!'].includes(node.operator) && node.argument.type === 'Literal' && typeof node.argument.value === 'number') {
                return { kind: 'number', start, end };
            }
            break;
        case 'ArrayExpression': {
            let previousEnd = node.start + 1;
            const elements = node.elements.map((element, index): ConfigValue => {
                if (!element) {
                    // A hole (`[a, , b]`) is missing, right after the comma that precedes it
                    const at = index === 0 ? previousEnd : source.indexOf(',', previousEnd) + 1;
                    previousEnd = at;
                    return { kind: 'missing', start: toDoc(at), end: toDoc(at) };
                }
                previousEnd = element.end;
                return element.type === 'SpreadElement'
                    ? { kind: 'dynamic', start: toDoc(element.start), end: toDoc(element.end) }
                    : convertValue(element, source, toDoc);
            });
            return { kind: 'array', elements, start, end };
        }
        case 'ObjectExpression':
            return { kind: 'object', object: convertObject(node, source, toDoc), start, end };
    }
    return { kind: 'dynamic', start, end };
}

export interface ConfigLocation {
    /** Keys leading to the innermost object containing the offset. */
    path: string[];
    object: ConfigObject;
    /** `key` when the cursor is where a property name goes, `value` when after `key:`. */
    position: 'key' | 'value';
    /** For `value`: the key whose value is being edited. For `key`: the partial key typed so far. */
    key: string;
    /** For `value`: true when the cursor is inside a string literal. */
    inString: boolean;
    /** The property under the cursor, if any. */
    property?: ConfigProperty;
    /** True when the cursor is on the property's key text. */
    onKey: boolean;
}

const contains = (start: number, end: number, offset: number) => offset >= start && offset <= end;

/** Describes where `offset` is inside the config block, or undefined if it's outside. */
export function getLocationAt(parsed: ParsedConfigBlock, offset: number): ConfigLocation | undefined {
    const { root, text } = parsed;
    if (offset <= root.start || offset >= root.end) {
        return undefined;
    }

    // Walk down to the innermost object literal containing the offset.
    let object = root;
    const path: string[] = [];
    let descended = true;
    while (descended) {
        descended = false;
        for (const property of object.properties) {
            const inner = innermostObject(property.value, offset);
            if (inner) {
                path.push(property.key);
                object = inner;
                descended = true;
                break;
            }
        }
    }

    const property = object.properties.find(p => contains(p.start, Math.max(p.end, p.value.end), offset));
    const onKey = !!property && contains(property.keyStart, property.keyEnd, offset);

    // Work out key vs value position from the text since the last top-level `,` or `{` of the object;
    // this is more reliable than the AST while the user is half way through typing.
    const blanked = blankCommentsAndStrings(text.slice(object.start, offset));
    let depth = 0;
    let segmentStart = 1;
    for (let i = 1; i < blanked.length; i++) {
        const ch = blanked[i];
        if (ch === '{' || ch === '[' || ch === '(') {
            depth++;
        } else if (ch === '}' || ch === ']' || ch === ')') {
            depth--;
        } else if (ch === ',' && depth === 0) {
            segmentStart = i + 1;
        }
    }
    const segment = blanked.slice(segmentStart);
    const colon = segment.indexOf(':');
    const quote = /["'`]/;
    if (colon === -1) {
        const typed = text.slice(object.start + segmentStart, offset).trim().replace(/^["'`]/, '');
        return { path, object, position: 'key', key: typed, inString: false, property, onKey };
    }
    const key = text.slice(object.start + segmentStart, object.start + segmentStart + colon).trim().replace(/^["'`]|["'`]$/g, '');
    // Inside a string when an odd number of quote characters follow the colon.
    const afterColon = segment.slice(colon + 1);
    const quoteCount = afterColon.split('').filter(ch => quote.test(ch)).length;
    return { path, object, position: 'value', key, inString: quoteCount % 2 === 1, property, onKey };
}

function innermostObject(value: ConfigValue, offset: number): ConfigObject | undefined {
    if (value.kind === 'object' && offset > value.object.start && offset < value.object.end) {
        return value.object;
    }
    if (value.kind === 'array' && offset > value.start && offset < value.end) {
        for (const element of value.elements) {
            const inner = innermostObject(element, offset);
            if (inner) {
                return inner;
            }
        }
    }
    return undefined;
}
