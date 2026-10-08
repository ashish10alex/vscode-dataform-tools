import type { CompileError } from '../backend';

/*
 * Where a dbt compile error is in its source file (xf#65). An error is placed only where the position is real: on
 * the line dbt gave, or on the `ref()` it names when that is in the file. There is no fallback to the first line: a
 * marker in the wrong place is worse than none, and the panel shows every error anyway.
 */

/** A range within one line of a file. `line` is 0-based; `start` and `end` are columns in it */
export interface ErrorPlace {
    line: number;
    start: number;
    end: number;
}

/**
 * Where a line of a compiled query is in the source it was compiled from: the one line of the source that reads the
 * same, indentation aside. Undefined when no line does or several do, as for a line that Jinja built: a marker is
 * then placed by other means (piece 7.9 of the build plan).
 */
export function placeCompiledLine(compiledLine: string | undefined, source: string): ErrorPlace | undefined {
    const wanted = compiledLine?.trim();
    if (!wanted) {
        return undefined;
    }
    let place: ErrorPlace | undefined;
    const lines = source.split('\n');
    for (let line = 0; line < lines.length; line++) {
        const text = lines[line].replace(/\r$/, '');
        if (text.trim() !== wanted) {
            continue;
        }
        if (place) {
            return undefined;
        }
        place = { line, start: text.length - text.trimStart().length, end: text.trimEnd().length };
    }
    return place;
}

/** The name in "depends on a node named 'x'", which both engines say of a `ref()` to nothing */
const MISSING_REF = /depends on a node named '([^']+)'/;

/** Whether the error names a `ref()` that could be looked for in its file */
export function namesMissingRef(error: Pick<CompileError, 'message'>): boolean {
    return MISSING_REF.test(error.message);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where `error` is in `source`, the text of the file it names. Undefined when dbt gave no line and names no `ref()`
 * that is in the file, or gave a line the file does not have.
 */
export function placeDbtError(error: Pick<CompileError, 'message' | 'line'>, source: string): ErrorPlace | undefined {
    const lines = source.split('\n');
    if (error.line !== undefined) {
        const text = lines[error.line - 1];
        if (text === undefined) {
            return undefined;
        }
        const trimmed = text.replace(/\r$/, '');
        return { line: error.line - 1, start: trimmed.length - trimmed.trimStart().length, end: trimmed.length };
    }
    const name = MISSING_REF.exec(error.message)?.[1];
    if (!name) {
        return undefined;
    }
    // The name as an argument of ref(): the last one, after a package or before a version
    const found = new RegExp(`\\bref\\s*\\([^)]*?["'](${escapeRegExp(name)})["']`).exec(source);
    if (!found) {
        return undefined;
    }
    const offset = found.index + found[0].lastIndexOf(name);
    const before = source.slice(0, offset).split('\n');
    const start = before[before.length - 1].length;
    return { line: before.length - 1, start, end: start + name.length };
}
