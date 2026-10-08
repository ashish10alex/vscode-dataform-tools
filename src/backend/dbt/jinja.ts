/*
 * Finding dbt's calls in the text of a file, for the editor features (piece 7.3 of the build plan): the `ref()`,
 * `source()` or macro call at a place, the argument being typed, and the alias a table is read under. It reads the
 * text only: whether a name is a model or a macro is for the Backend's `editor` part to say.
 *
 * In a SQL file a call is looked for inside `{{ }}` and `{% %}`, and not inside `{# #}`. In a YAML file `ref()` and
 * `source()` are looked for anywhere but in a `#` comment, since they are written there with and without braces.
 */

/** A string argument of a call. `start` and `end` are offsets of its contents, without the quotes */
export interface JinjaArgument {
    value: string;
    start: number;
    end: number;
}

export interface JinjaCall {
    /** `macro` is any other call: a macro, a filter with arguments or a method. Only the Backend knows which */
    kind: 'ref' | 'source' | 'macro';
    /** As written, with its package when it has one: `ref`, `cents_to_dollars`, `dbt_utils.star` */
    name: string;
    nameStart: number;
    nameEnd: number;
    /** The string arguments given by position, up to the first argument that is not a string */
    args: JinjaArgument[];
    /** The `v=` or `version=` of a `ref()`, as written */
    version?: string;
    /** From the first character of the name to after the closing bracket, or to where the text stopped */
    start: number;
    end: number;
    /** Whether the closing bracket was found */
    closed: boolean;
    /** The name the SQL after the call gives the table: `o` in `{{ ref('orders') }} as o`. Unset in a YAML file */
    alias?: string;
}

/** An argument of `ref()` or `source()` that is being typed: the caret is inside its quotes */
export interface TypingArgument {
    kind: 'ref' | 'source';
    /** Which argument by position, from 0 */
    index: number;
    /** The string arguments before it */
    before: string[];
    /** What is typed of it so far, and where that starts */
    prefix: string;
    start: number;
}

/** A column name in the SQL of a file, with the alias before its dot when it has one */
export interface ColumnWord {
    qualifier?: string;
    word: string;
    /** Of the word alone, without the qualifier */
    start: number;
    end: number;
}

interface Region {
    start: number;
    end: number;
    /** Offset after the closing `}}` of an expression, where an alias would be. Unset for `{% %}` and unclosed ones */
    after?: number;
}

const CLOSERS: Record<string, string> = { '{{': '}}', '{%': '%}', '{#': '#}' };

/** The insides of each `{{ }}` and `{% %}` of a SQL file. One left open runs to the end of the text */
function jinjaRegions(text: string): Region[] {
    const regions: Region[] = [];
    const opener = /\{[{%#]/g;
    for (let found = opener.exec(text); found; found = opener.exec(text)) {
        const close = text.indexOf(CLOSERS[found[0]], found.index + 2);
        const end = close < 0 ? text.length : close;
        if (found[0] !== '{#') {
            // An expression written inside a string of another, as in a hook, is not followed by SQL of the file
            const nested = text.slice(found.index + 2, end).includes('{{');
            regions.push({ start: found.index + 2, end, after: found[0] === '{{' && close >= 0 && !nested ? close + 2 : undefined });
        }
        opener.lastIndex = close < 0 ? text.length : close + 2;
    }
    return regions;
}

/** Each line of a YAML file up to its `#` comment, as a region */
function yamlRegions(text: string): Region[] {
    const regions: Region[] = [];
    let start = 0;
    for (const line of text.split('\n')) {
        // A `#` starts a comment at the start of a line or after a space
        const comment = /(^|\s)#/.exec(line);
        const end = comment ? comment.index + comment[1].length : line.length;
        if (end > 0) {
            regions.push({ start, end: start + end });
        }
        start += line.length + 1;
    }
    return regions;
}

interface Scan {
    args: JinjaArgument[];
    version?: string;
    end: number;
    closed: boolean;
    /** Set when the scan stopped at `limit` inside a string given by position at the call's own depth */
    typing?: { index: number; start: number };
}

/**
 * Reads the arguments of a call from after its opening bracket, to its closing bracket or to `limit`. Only the call's
 * own arguments are kept; a call inside an argument is found again as its own call.
 */
function scanArguments(text: string, open: number, limit: number): Scan {
    const scan: Scan = { args: [], end: limit, closed: false };
    let stringsOnly = true;
    let index = 0;
    let argumentStart = open;
    const finish = (end: number) => {
        const written = text.slice(argumentStart, end);
        const literal = /^(\s*)(["'])((?:\\.|(?!\2).)*)\2\s*$/s.exec(written);
        const keyword = /^\s*([A-Za-z_]\w*)\s*=(?!=)\s*(["']?)(.*?)\2\s*$/s.exec(written);
        if (literal) {
            if (stringsOnly) {
                const start = argumentStart + literal[1].length + 1;
                scan.args.push({ value: literal[3], start, end: start + literal[3].length });
            }
        } else if (keyword) {
            if (keyword[1] === 'v' || keyword[1] === 'version') {
                scan.version = keyword[3];
            }
        } else if (written.trim() !== '') {
            stringsOnly = false;
        }
        index++;
        argumentStart = end + 1;
    };
    let depth = 1;
    for (let i = open; i < limit; i++) {
        const char = text[i];
        if (char === '"' || char === "'") {
            let close = i + 1;
            while (close < limit && text[close] !== char) {
                close += text[close] === '\\' ? 2 : 1;
            }
            if (close >= limit) {
                // The text stops inside this string: it is being typed, if it is the whole of its argument so far
                if (depth === 1 && text.slice(argumentStart, i).trim() === '') {
                    scan.typing = { index, start: i + 1 };
                }
                return scan;
            }
            i = close;
        } else if (char === '(' || char === '[' || char === '{') {
            depth++;
        } else if (char === ')' || char === ']' || char === '}') {
            depth--;
            if (depth === 0) {
                finish(i);
                scan.end = i + 1;
                scan.closed = true;
                return scan;
            }
        } else if (char === ',' && depth === 1) {
            finish(i);
        }
    }
    return scan;
}

const CALL = /(?<![\w.])([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/g;

/** Words that follow a table in SQL and are not its alias */
const NOT_AN_ALIAS = new Set([
    'on', 'using', 'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'group', 'order', 'limit',
    'union', 'intersect', 'except', 'having', 'window', 'qualify', 'for', 'tablesample', 'pivot', 'unpivot', 'select', 'from',
    'when', 'then', 'set', 'with', 'as',
]);

function aliasAfter(text: string, after: number): string | undefined {
    const found = /^\s*(?:as\s+)?([A-Za-z_]\w*)/i.exec(text.slice(after, after + 200));
    return found && !NOT_AN_ALIAS.has(found[1].toLowerCase()) ? found[1] : undefined;
}

function kindOf(name: string): JinjaCall['kind'] {
    return name === 'ref' || name === 'source' ? name : 'macro';
}

/** Every call in the text, in the order written. In a YAML file only `ref()` and `source()` */
export function jinjaCalls(text: string, yaml = false): JinjaCall[] {
    const calls: JinjaCall[] = [];
    for (const region of yaml ? yamlRegions(text) : jinjaRegions(text)) {
        const inside = text.slice(region.start, region.end);
        CALL.lastIndex = 0;
        for (let found = CALL.exec(inside); found; found = CALL.exec(inside)) {
            const kind = kindOf(found[1]);
            if (yaml && kind === 'macro') {
                continue;
            }
            const nameStart = region.start + found.index;
            const scan = scanArguments(text, nameStart + found[0].length, region.end);
            const call: JinjaCall = {
                kind, name: found[1], nameStart, nameEnd: nameStart + found[1].length,
                args: scan.args, start: nameStart, end: scan.end, closed: scan.closed,
            };
            if (scan.version !== undefined) {
                call.version = scan.version;
            }
            const alias = kind !== 'macro' && region.after !== undefined ? aliasAfter(text, region.after) : undefined;
            if (alias) {
                call.alias = alias;
            }
            calls.push(call);
        }
    }
    return calls;
}

/**
 * The call the offset is in: the innermost one, so in `star(from=ref('orders'))` an offset in `orders` gives the
 * `ref()`. An offset on a call's name gives that call.
 */
export function callAt(text: string, offset: number, yaml = false): JinjaCall | undefined {
    let innermost: JinjaCall | undefined;
    for (const call of jinjaCalls(text, yaml)) {
        if (offset >= call.start && offset <= call.end && (!innermost || call.start >= innermost.start)) {
            innermost = call;
        }
    }
    return innermost;
}

/** The argument of a `ref()` or `source()` whose quotes the offset is inside, while it is being typed or after */
export function typingArgument(text: string, offset: number): TypingArgument | undefined {
    for (const region of jinjaRegions(text)) {
        // A region left open runs to the end of the text, so the caret may be at its end
        if (offset < region.start || offset > region.end) {
            continue;
        }
        const inside = text.slice(region.start, offset);
        let typing: TypingArgument | undefined;
        CALL.lastIndex = 0;
        for (let found = CALL.exec(inside); found; found = CALL.exec(inside)) {
            const kind = kindOf(found[1]);
            if (kind === 'macro') {
                continue;
            }
            const scan = scanArguments(text, region.start + found.index + found[0].length, offset);
            if (scan.typing && scan.typing.index === scan.args.length) {
                typing = { kind, index: scan.typing.index, before: scan.args.map((argument) => argument.value), prefix: text.slice(scan.typing.start, offset), start: scan.typing.start };
            }
        }
        return typing;
    }
    return undefined;
}

/** The tables the file reads by a name of its own: each alias, with the `ref()` or `source()` call it is given to */
export function tableAliases(text: string): Map<string, JinjaCall> {
    const aliases = new Map<string, JinjaCall>();
    for (const call of jinjaCalls(text)) {
        if (call.alias && !aliases.has(call.alias)) {
            aliases.set(call.alias, call);
        }
    }
    return aliases;
}

function insideJinja(text: string, offset: number): boolean {
    const opener = /\{[{%#]/g;
    for (let found = opener.exec(text); found && found.index < offset; found = opener.exec(text)) {
        const close = text.indexOf(CLOSERS[found[0]], found.index + 2);
        if (close < 0 || offset < close + 2) {
            return true;
        }
        opener.lastIndex = close + 2;
    }
    return false;
}

/**
 * The column name at the offset in the SQL of a file, or the part of one typed up to the offset when `typing` is
 * set, which may be empty after a dot. Nothing inside Jinja, where a word is not a column.
 */
export function columnAt(text: string, offset: number, typing = false): ColumnWord | undefined {
    if (insideJinja(text, offset)) {
        return undefined;
    }
    let start = offset;
    while (start > 0 && /\w/.test(text[start - 1])) {
        start--;
    }
    let end = offset;
    while (!typing && end < text.length && /\w/.test(text[end])) {
        end++;
    }
    const word = text.slice(start, end);
    const qualifier = /([A-Za-z_]\w*)\.$/.exec(text.slice(0, start))?.[1];
    if (/^\d/.test(word) || (word === '' && !(typing && qualifier))) {
        return undefined;
    }
    return qualifier ? { qualifier, word, start, end } : { word, start, end };
}
