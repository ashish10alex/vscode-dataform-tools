import type { CompileError } from '../backend';
import { slashPath } from '../../shared/compiledGraph';
import type { DbtInvocation } from './invoke';

/*
 * The errors of a dbt command, read from the JSON log it prints (`--log-format json`). Neither engine gives a
 * structured position, so the file and line are parsed out of the message text. A port of xf's
 * internal/backend/dbt/logs.go, with the line and the code kept apart from the message.
 *
 * dbt-core stops at the first error and reports it as one event with the text in `data.exc`. dbt v2 reports every
 * error, each as an event with everything in `info.msg`.
 */

/** Colours and other terminal escapes, which dbt-core puts in its messages even in a JSON log */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** What dbt puts before an error's text */
const PREFIX = /^(?:\[error\]\s*|\[ERROR\]:\s*Encountered an error:\s*)/;
/** dbt v2 ends an error with where it is: "  --> models/a.sql:4:6" */
const V2_LOCATION = /^[ \t]*--> (\S+?)(?::(\d+))?(?::\d+)?[ \t]*$/m;
/** dbt v2 starts an error with its name and code: "[DependencyNotFound (dbt1048)]:" */
const V2_CODE = /^\[\w+ \((dbt\d+)\)\]/;
/** dbt-core names the file in parentheses: "Model 'model.p.a' (models/a.sql)" */
const CORE_FILE = /\(([^()\s]+\.(?:sql|yml|yaml|csv|py|md))\)/;
/** dbt-core gives a Jinja error's line on a line of its own: "    line 2" */
const CORE_LINE = /^[ \t]+line (\d+)[ \t]*$/m;

export function stripAnsi(text: string): string {
    return text.replace(ANSI, '');
}

/**
 * One error from its text. A position in a form that is not known leaves the error without one: it is never
 * dropped. A line is given only with the file it is in.
 */
export function compileError(text: string): CompileError {
    let message = stripAnsi(text).trim().replace(PREFIX, '').trim();
    const error: CompileError = { message };
    const location = V2_LOCATION.exec(message);
    if (location) {
        error.fileName = slashPath(location[1]);
        if (location[2]) {
            error.line = Number(location[2]);
        }
        message = (message.slice(0, location.index) + message.slice(location.index + location[0].length)).trim();
    } else {
        const file = CORE_FILE.exec(message);
        if (file) {
            error.fileName = slashPath(file[1]);
            const line = CORE_LINE.exec(message);
            if (line) {
                error.line = Number(line[1]);
            }
        }
    }
    const code = V2_CODE.exec(message);
    if (code) {
        error.code = code[1];
    }
    error.message = message;
    return error;
}

/** The errors in dbt's JSON log, each once, in the order dbt logged them. A line that is not a log event is skipped */
export function logErrors(stdout: string): CompileError[] {
    const errors: CompileError[] = [];
    const seen = new Set<string>();
    for (const line of stdout.split('\n')) {
        if (!line.includes('"error"')) {
            continue;
        }
        let event: { info?: { level?: string; msg?: string }; data?: { exc?: string } };
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (event?.info?.level !== 'error') {
            continue;
        }
        const error = compileError(event.data?.exc || event.info.msg || '');
        const key = JSON.stringify(error);
        if (error.message && !seen.has(key)) {
            seen.add(key);
            errors.push(error);
        }
    }
    return errors;
}

/**
 * What dbt printed other than log events, for a command that failed without logging an error: a crash, or an
 * argument it does not know. The last 40 lines at most.
 */
export function outputDetail(stdout: string, stderr: string): string {
    const lines: string[] = [];
    for (const output of [stderr, stdout]) {
        for (const raw of output.split('\n')) {
            const line = stripAnsi(raw).trimEnd();
            if (line === '' || isJson(line)) {
                continue;
            }
            lines.push(line);
        }
    }
    return lines.slice(-40).join('\n');
}

function isJson(line: string): boolean {
    try {
        JSON.parse(line);
        return true;
    } catch {
        return false;
    }
}

/** The errors of a dbt command: those it logged, or, when it failed without logging one, what else it printed */
export function invocationErrors(invocation: Pick<DbtInvocation, 'stdout' | 'stderr' | 'exitCode'>): CompileError[] {
    const errors = logErrors(invocation.stdout);
    if (errors.length === 0 && invocation.exitCode !== 0) {
        const detail = outputDetail(invocation.stdout, invocation.stderr);
        if (detail) {
            return [{ message: detail }];
        }
    }
    return errors;
}
