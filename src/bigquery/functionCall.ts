import type { FunctionParam } from './functionCatalog';

/*
 * Which function call the cursor is in, and which of its arguments, read from the SQL before the cursor. Strings,
 * comments and the brackets of other calls are stepped over, so a comma in them is not taken for the call's own.
 * Nothing here needs VS Code.
 */

/** A call the cursor is in */
export interface CallAt {
    /** As written, e.g. `date_trunc` or `SAFE.SUBSTR` */
    name: string;
    /** Each comma and each word at the call's own level, in order and in upper case: what tells its arguments apart */
    separators: string[];
}

interface Frame {
    /** The name before the bracket; empty for a bracket that groups or makes an array, which is looked through */
    name: string;
    separators: string[];
}

/** Each bracket open at the end of the text, and whether the end is in code rather than in a string or a comment */
export function scan(text: string): { frames: Frame[]; inCode: boolean } {
    const frames: Frame[] = [];
    let i = 0;
    const skipTo = (end: string, from: number): boolean => {
        const at = text.indexOf(end, from);
        i = at < 0 ? text.length : at + end.length;
        return at >= 0;
    };
    while (i < text.length) {
        const char = text[i];
        const two = text.slice(i, i + 2);
        if (two === '--' || two === '//' || char === '#') {
            if (!skipTo('\n', i)) {
                return { frames, inCode: false };
            }
            continue;
        }
        if (two === '/*' || two === '{#') {
            if (!skipTo(two === '/*' ? '*/' : '#}', i + 2)) {
                return { frames, inCode: false };
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            const quote = char !== '`' && text.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
            let j = i + quote.length;
            while (j < text.length && !text.startsWith(quote, j)) {
                j += text[j] === '\\' ? 2 : 1;
            }
            if (j >= text.length) {
                return { frames, inCode: false };
            }
            i = j + quote.length;
            continue;
        }
        if (char === '(') {
            frames.push({ name: nameBefore(text, i), separators: [] });
        } else if (char === '[') {
            frames.push({ name: '', separators: [] });
        } else if (char === ')' || char === ']') {
            frames.pop();
        } else if (char === ',') {
            frames.at(-1)?.separators.push(',');
        } else if (/[A-Za-z_]/.test(char) && !/[\w.]/.test(text[i - 1] ?? '')) {
            const word = /^\w+/.exec(text.slice(i, i + 200))![0];
            frames.at(-1)?.separators.push(word.toUpperCase());
            i += word.length;
            continue;
        } else if (/\d/.test(char)) {
            i += /^[\w.]+/.exec(text.slice(i, i + 200))![0].length;
            continue;
        }
        i += 1;
    }
    return { frames, inCode: true };
}

/** The name a bracket at `at` follows: a word, a dotted name, or a quoted one (`?`, which matches no function) */
function nameBefore(text: string, at: number): string {
    let end = at;
    while (end > 0 && /\s/.test(text[end - 1])) {
        end -= 1;
    }
    if (text[end - 1] === '`') {
        return '?';
    }
    let start = end;
    while (start > 0 && /[\w.]/.test(text[start - 1])) {
        start -= 1;
    }
    const name = text.slice(start, end).replace(/^\.+/, '');
    return /^[A-Za-z_]/.test(name) ? name : '';
}

/** The call the end of the text is in: the innermost named bracket, looking through ones that only group */
export function callAt(text: string): CallAt | undefined {
    const { frames, inCode } = scan(text);
    if (!inCode) {
        return undefined;
    }
    const frame = [...frames].reverse().find((each) => each.name !== '');
    return frame ? { name: frame.name, separators: frame.separators } : undefined;
}

/** The word, or what follows a keyword, that comes before a param */
function separatorOf(param: FunctionParam): string {
    return param.before ? param.before.split(' ')[0].toUpperCase() : ',';
}

/** Which param of a signature the cursor is at, and whether the call so far fits the signature at all */
export function activeParameter(params: FunctionParam[], separators: string[]): { index: number; fits: boolean } {
    let index = 0;
    let fits = true;
    for (const separator of separators) {
        const next = params[index + 1];
        if (next && separator === separatorOf(next)) {
            index += 1;
        } else if (separator === ',' && !params[index]?.repeated) {
            fits = false;
        }
    }
    return { index, fits };
}

/** The function name at a character of a line, when a `(` follows it: the hover is for calls, not for a column called `date` */
export function functionNameAt(line: string, character: number): { name: string; start: number; end: number } | undefined {
    let start = character;
    let end = character;
    while (start > 0 && /[\w.]/.test(line[start - 1])) {
        start -= 1;
    }
    while (end < line.length && /[\w.]/.test(line[end])) {
        end += 1;
    }
    const name = line.slice(start, end);
    if (!/^[A-Za-z_][\w.]*$/.test(name) || !/^\s*\(/.test(line.slice(end))) {
        return undefined;
    }
    return { name, start, end };
}

/** Whether the end of a dbt file's text is inside `{{ ... }}` or `{% ... %}`, where Jinja is written and not SQL */
export function insideJinja(text: string): boolean {
    return text.lastIndexOf('{{') > text.lastIndexOf('}}') || text.lastIndexOf('{%') > text.lastIndexOf('%}');
}
