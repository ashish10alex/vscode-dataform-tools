/**
 * Parses the raw stack string from a Dataform compilation error.
 *
 * The stack format produced by the Dataform CLI looks like:
 *
 *   /absolute/tmp/path/definitions/file.sqlx:10
 *     dependencies: ["MODEL_NAME],
 *                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^
 *
 *   SyntaxError: Invalid or unexpected token
 *       at new Script (node:vm:117:7)
 *       at VMScript._compile (.../node_modules/...)
 *       ...
 *
 * This function extracts:
 *  - `lineNumber`: the line number from the first line (`:10`)
 *  - `sourceContext`: the code snippet + caret pointer + error type label,
 *    stripping the absolute path line and all `    at ...` node stack frames.
 */
export function parseCompilationStack(stack: string | undefined): { lineNumber?: number; sourceContext?: string } {
    if (!stack) { return {}; }

    const lines = stack.split('\n');

    // First line is the absolute temp path with optional :line or :line:col suffix
    const firstLine = lines[0] || '';
    const lineNumMatch = firstLine.match(/:(\d+)(?::\d+)?\s*$/);
    const lineNumber = lineNumMatch ? parseInt(lineNumMatch[1], 10) : undefined;

    // Collect context lines: everything after the path line, stopping before node stack frames
    const contextLines: string[] = [];
    for (let i = 1; i < lines.length; i++) {
        if (/^\s{4}at /.test(lines[i])) { break; }
        contextLines.push(lines[i]);
    }

    // Trim trailing blank lines
    while (contextLines.length > 0 && contextLines[contextLines.length - 1].trim() === '') {
        contextLines.pop();
    }

    const sourceContext = contextLines.length > 0 ? contextLines.join('\n') : undefined;
    return { lineNumber, sourceContext };
}
