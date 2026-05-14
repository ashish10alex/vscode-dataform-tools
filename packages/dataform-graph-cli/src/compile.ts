import { spawn } from "node:child_process";

/**
 * Heuristic to recognize a dataform compile result. The shape always has at
 * least one of these top-level keys (even when empty arrays).
 */
function looksLikeCompileResult(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") {return false;}
    const o = obj as Record<string, unknown>;
    return (
        "tables" in o ||
        "operations" in o ||
        "assertions" in o ||
        "declarations" in o ||
        "graphErrors" in o ||
        "projectConfig" in o
    );
}

/**
 * Scan `s` for balanced top-level `{...}` objects, ignoring braces inside
 * JSON string literals. Yields each object's substring.
 */
function* iterTopLevelObjects(s: string): Generator<string> {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (c === "\\") {
                escape = true;
            } else if (c === '"') {
                inString = false;
            }
            continue;
        }
        if (c === '"') {
            inString = true;
            continue;
        }
        if (c === "{") {
            if (depth === 0) {start = i;}
            depth++;
        } else if (c === "}") {
            // Ignore stray closers so they can't push depth negative and desync
            // the next top-level object's start position.
            if (depth === 0) {continue;}
            depth--;
            if (depth === 0 && start !== -1) {
                yield s.slice(start, i + 1);
                start = -1;
            }
        }
    }
}

/**
 * Older dataform versions (e.g. 2.9) emit a logger-init JSON line before the
 * actual compile JSON, so the combined stdout is two JSON values concatenated.
 * Parse out the one that matches a compile result; fall back to direct parse.
 */
export function extractCompileJson(stdout: string): unknown {
    try {
        const direct = JSON.parse(stdout);
        if (looksLikeCompileResult(direct)) {return direct;}
    } catch {
        // fall through to the multi-object path
    }

    let lastCompileResult: unknown = null;
    for (const chunk of iterTopLevelObjects(stdout)) {
        try {
            const parsed = JSON.parse(chunk);
            if (looksLikeCompileResult(parsed)) {
                // Keep the last one in case there are multiple (defensive: future
                // dataform versions might still print logger lines).
                lastCompileResult = parsed;
            }
        } catch {
            // ignore non-JSON chunks
        }
    }
    if (lastCompileResult !== null) {return lastCompileResult;}
    // Re-raise a clean parse error against the whole stdout so the message is informative.
    JSON.parse(stdout);
    // unreachable
    throw new Error("no compile result found in stdout");
}

/**
 * Subset of `dataform compile` flags we pass through. Each is wired 1:1 to
 * the underlying CLI flag (kebab-case on the command line). Absent values are
 * not forwarded — the dataform CLI falls back to workflow_settings.yaml.
 */
export interface CompileOverrides {
    databaseSuffix?: string;
    schemaSuffix?: string;
    tablePrefix?: string;
    defaultDatabase?: string;
    defaultSchema?: string;
    defaultLocation?: string;
    assertionSchema?: string;
    vars?: string;
}

export interface CompileOptions {
    cwd: string;
    /** Override the binary (default: "dataform"). Useful for tests. */
    bin?: string;
    overrides?: CompileOverrides;
}

const OVERRIDE_FLAG_NAMES: Array<[keyof CompileOverrides, string]> = [
    ["databaseSuffix", "--database-suffix"],
    ["schemaSuffix", "--schema-suffix"],
    ["tablePrefix", "--table-prefix"],
    ["defaultDatabase", "--default-database"],
    ["defaultSchema", "--default-schema"],
    ["defaultLocation", "--default-location"],
    ["assertionSchema", "--assertion-schema"],
    ["vars", "--vars"],
];

function buildOverrideArgs(overrides: CompileOverrides | undefined): string[] {
    if (!overrides) {return [];}
    const args: string[] = [];
    for (const [key, flag] of OVERRIDE_FLAG_NAMES) {
        const value = overrides[key];
        if (typeof value === "string" && value.length > 0) {
            // Use `--flag=value` form so values that look like flags (e.g. starting
            // with `-`) aren't accidentally parsed as the next option.
            args.push(`${flag}=${value}`);
        }
    }
    return args;
}

/**
 * Spawns `dataform compile --json` in the given cwd and returns the parsed JSON.
 * Rejects with a descriptive Error if the binary is missing, exits non-zero,
 * or emits unparseable output.
 */
export function runDataformCompile(options: CompileOptions): Promise<unknown> {
    const bin = options.bin ?? "dataform";

    const args = ["compile", "--json", ...buildOverrideArgs(options.overrides)];

    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, {
            cwd: options.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            // Windows resolves `.cmd` shims through the shell.
            shell: process.platform === "win32",
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        child.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
                const looksLikePath = bin.includes("/") || bin.includes("\\");
                const hint = looksLikePath
                    ? `Could not find a dataform binary at "${bin}".`
                    : `Could not find "${bin}" on PATH.`;
                reject(
                    new Error(
                        `${hint} Install dataform-cli (e.g. \`npm i -g @dataform/cli\`) ` +
                            `or set --dataform-bin / $DATAFORM_BIN to its location.`
                    )
                );
                return;
            }
            reject(new Error(`Failed to run "${bin} compile --json": ${err.message}`));
        });

        child.on("close", (code) => {
            if (code !== 0) {
                const detail = stderr.trim() || stdout.trim() || "(no output)";
                reject(new Error(`"${bin} compile --json" exited with code ${code}:\n${detail}`));
                return;
            }
            try {
                resolve(extractCompileJson(stdout));
            } catch (err: any) {
                reject(
                    new Error(
                        `Failed to parse "${bin} compile --json" output as JSON: ${err.message}`
                    )
                );
            }
        });
    });
}
