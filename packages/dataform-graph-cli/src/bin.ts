import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { DataformCompiledJson } from "../../../src/types";
import { buildDependencyGraph } from "../../../src/shared/buildDependencyGraph";
import { runDataformCompile } from "./compile";
import { openInBrowser } from "./openBrowser";
import { pickModel, pickTag } from "./picker";
import { GraphPayload, SchemaField, SchemaResult, startServer } from "./server";
import { startSpinner } from "./spinner";
// `version` is inlined at build time by esbuild from the package manifest.
import pkg from "../package.json";
// Pulled in lazily inside fetchSchema so cold-start isn't impacted by the client's auth init.
type BigQueryCtor = typeof import("@google-cloud/bigquery").BigQuery;

interface CliOptions {
    // commander returns `true` for an option with optional arg when supplied with no value,
    // `string` when supplied with a value, `undefined` when not supplied.
    model?: string | boolean;
    tag?: string | boolean;
    input?: string;
    cwd?: string;
    dataformBin?: string;
    port?: number;
    host: string;
    open: boolean;
    // Pass-through overrides for `dataform compile`.
    databaseSuffix?: string;
    schemaSuffix?: string;
    tablePrefix?: string;
    defaultDatabase?: string;
    defaultSchema?: string;
    defaultLocation?: string;
    assertionSchema?: string;
    vars?: string;
}

const OVERRIDE_OPT_KEYS = [
    "databaseSuffix",
    "schemaSuffix",
    "tablePrefix",
    "defaultDatabase",
    "defaultSchema",
    "defaultLocation",
    "assertionSchema",
    "vars",
] as const;

function parsePort(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`Invalid port "${raw}" — must be an integer in [0, 65535].`);
    }
    return n;
}

async function loadCompiled(opts: CliOptions): Promise<DataformCompiledJson> {
    const activeOverrides = OVERRIDE_OPT_KEYS.filter((k) => typeof opts[k] === "string");

    if (opts.input) {
        if (activeOverrides.length > 0) {
            process.stderr.write(
                `[warn] --input bypasses compilation, so ${activeOverrides
                    .map((k) => `--${k.replace(/([A-Z])/g, "-$1").toLowerCase()}`)
                    .join(", ")} ` + "will be ignored.\n"
            );
        }
        const abs = path.resolve(opts.input);
        const raw = await fs.promises.readFile(abs, "utf8");
        try {
            return JSON.parse(raw) as DataformCompiledJson;
        } catch (err: any) {
            throw new Error(`Failed to parse ${abs} as JSON: ${err.message}`);
        }
    }
    const cwd = path.resolve(opts.cwd ?? process.cwd());
    if (!fs.existsSync(cwd)) {
        throw new Error(`--cwd directory does not exist: ${cwd}`);
    }
    const bin = opts.dataformBin ?? process.env.DATAFORM_BIN ?? "dataform";

    const overrides = {
        databaseSuffix: opts.databaseSuffix,
        schemaSuffix: opts.schemaSuffix,
        tablePrefix: opts.tablePrefix,
        defaultDatabase: opts.defaultDatabase,
        defaultSchema: opts.defaultSchema,
        defaultLocation: opts.defaultLocation,
        assertionSchema: opts.assertionSchema,
        vars: opts.vars,
    };

    const stop = startSpinner("Compiling dataform project");
    try {
        const result = await runDataformCompile({ cwd, bin, overrides });
        stop({ success: true, successMessage: "Compiled dataform project" });
        return result as DataformCompiledJson;
    } catch (err) {
        // Clear the spinner without a success line so the error printed by the
        // top-level catch isn't obscured by leftover spinner characters.
        stop();
        throw err;
    }
}

/**
 * Lazy-loaded BigQuery client cache, keyed by projectId. Application Default
 * Credentials only (v1) — `gcloud auth application-default login` or
 * `$GOOGLE_APPLICATION_CREDENTIALS` are honored automatically by the client.
 */
const bqClients = new Map<string, InstanceType<BigQueryCtor>>();
const schemaCache = new Map<string, Promise<SchemaResult>>();
let BigQueryCtorCached: BigQueryCtor | null = null;

async function loadBigQueryCtor(): Promise<BigQueryCtor> {
    if (BigQueryCtorCached) {return BigQueryCtorCached;}
    const mod = await import("@google-cloud/bigquery");
    BigQueryCtorCached = mod.BigQuery;
    return BigQueryCtorCached;
}

function normalizeSchemaFields(raw: any[]): SchemaField[] {
    if (!Array.isArray(raw)) {return [];}
    return raw.map((f) => ({
        name: String(f?.name ?? ""),
        type: String(f?.type ?? ""),
        mode: f?.mode ? String(f.mode) : undefined,
        description: f?.description ? String(f.description) : undefined,
        fields: Array.isArray(f?.fields) ? normalizeSchemaFields(f.fields) : undefined,
    }));
}

/** Extract the most informative message we can from a thrown BigQuery / gax error. */
function describeBqError(err: any): string {
    if (!err) {return "unknown error";}
    const parts: string[] = [];
    if (typeof err.code === "number" || typeof err.code === "string") {
        parts.push(`[${err.code}]`);
    }
    if (typeof err.message === "string" && err.message) {
        parts.push(err.message);
    }
    // BigQuery REST errors often carry an `errors` array with finer-grained reasons.
    if (Array.isArray(err.errors) && err.errors.length > 0) {
        const details = err.errors
            .map((e: any) => {
                const segs: string[] = [];
                if (e?.reason) {segs.push(String(e.reason));}
                if (e?.message) {segs.push(String(e.message));}
                if (e?.location) {segs.push(`(${e.location})`);}
                return segs.join(" ");
            })
            .filter(Boolean)
            .join("; ");
        if (details) {parts.push(`— ${details}`);}
    }
    if (parts.length === 0) {
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }
    return parts.join(" ");
}

async function fetchSchema(projectId: string, datasetId: string, tableId: string): Promise<SchemaResult> {
    const cacheKey = `${projectId}.${datasetId}.${tableId}`;
    const cached = schemaCache.get(cacheKey);
    if (cached) {return cached;}

    const promise = (async (): Promise<SchemaResult> => {
        const BigQuery = await loadBigQueryCtor();
        let client = bqClients.get(projectId);
        if (!client) {
            client = new BigQuery({ projectId });
            bqClients.set(projectId, client);
        }
        try {
            const [metadata] = await client.dataset(datasetId, { projectId }).table(tableId).getMetadata();
            const lastModifiedTime =
                typeof metadata?.lastModifiedTime === "string" ? metadata.lastModifiedTime : undefined;
            return {
                fields: normalizeSchemaFields(metadata?.schema?.fields ?? []),
                lastModifiedTime,
            };
        } catch (err: any) {
            // Print the raw error so the user can see the full stack in their terminal,
            // then re-throw with a clean message that surfaces all useful fields to the UI.
            process.stderr.write(`schema lookup failed for ${projectId}.${datasetId}.${tableId}:\n${err?.stack ?? err}\n`);
            throw new Error(describeBqError(err));
        }
    })();

    schemaCache.set(cacheKey, promise);
    // Don't poison the cache on failure — let the user retry.
    promise.catch(() => schemaCache.delete(cacheKey));
    return promise;
}

function requireTty(flag: string): void {
    if (!process.stdin.isTTY) {
        throw new Error(
            `Interactive ${flag} requires an interactive terminal. ` +
                `Pass a value (e.g. ${flag} my_value) or omit the flag.`
        );
    }
}

async function main() {
    const program = new Command();
    program
        .name("dataform-graph")
        .version(pkg.version, "-v, --version", "Output the current version.")
        .description(
            "Serve the dataform-tools dependency graph in your browser. " +
                "By default runs `dataform compile --json` in the current directory."
        )
        .option(
            "-m, --model [model]",
            "Filter the initial view to a specific model. " +
                "Matches against the file name, fully-qualified `database.schema.name`, or short `target.name`. " +
                "If no match is found, the full graph is shown and a warning is printed. " +
                "Pass --model with no value to pick interactively (file → model)."
        )
        .option(
            "-t, --tag [tag]",
            "Filter the initial view to a specific tag (shows all models carrying it plus their immediate upstream sources). " +
                "If no match is found, the full graph is shown and a warning is printed. " +
                "Pass --tag with no value to pick a tag interactively."
        )
        .option(
            "-i, --input <path>",
            "Use a pre-compiled dataform JSON file instead of running `dataform compile --json`."
        )
        .option(
            "-c, --cwd <path>",
            "Directory to run `dataform compile --json` from (default: current directory)."
        )
        .option(
            "--dataform-bin <path>",
            "Path or name of the dataform binary to invoke (default: `dataform` on PATH, or $DATAFORM_BIN if set)."
        )
        // Pass-through overrides for `dataform compile`. Each is forwarded as
        // --<flag>=<value> when set; otherwise the value from workflow_settings.yaml wins.
        .option("--database-suffix <suffix>", "Suffix appended to the default database.")
        .option("--schema-suffix <suffix>", "Suffix appended to output schema names.")
        .option("--table-prefix <prefix>", "Prefix prepended to all table names.")
        .option("--default-database <project>", "Default database (Google Cloud project ID).")
        .option("--default-schema <schema>", "Default schema name.")
        .option("--default-location <location>", "Default BigQuery location.")
        .option("--assertion-schema <schema>", "Default assertion schema.")
        .option(
            "--vars <pairs>",
            "Variables for the compile, e.g. --vars=someKey=someValue,a=b (referenced as dataform.projectConfig.vars.someKey)."
        )
        .option("-p, --port <n>", "Port to listen on (default: random ephemeral).", parsePort)
        .option("-H, --host <host>", "Host interface to bind to.", "127.0.0.1")
        .option("--no-open", "Do not auto-launch the default browser.")
        .showHelpAfterError()
        .parse();

    const opts = program.opts<CliOptions>();

    // Filters are mutually exclusive (the UI treats them mutually exclusive too).
    if (opts.model !== undefined && opts.tag !== undefined) {
        throw new Error("--model and --tag are mutually exclusive; pick one filter.");
    }

    const compiled = await loadCompiled(opts);

    // --model: bare (true) → interactive; string → match identifier; undefined → no focus.
    const modelInteractive = opts.model === true;
    const modelString = typeof opts.model === "string" ? opts.model : undefined;

    const { nodes, edges, datasetColorMap, focusNodeId } = buildDependencyGraph(compiled, {
        focusIdentifier: modelString,
    });

    let resolvedFocusId: string | null = focusNodeId;

    if (modelInteractive) {
        requireTty("--model");
        const picked = await pickModel(nodes);
        if (picked === null) {
            process.stderr.write("Cancelled.\n");
            process.exit(130);
        }
        resolvedFocusId = picked;
    } else if (modelString && !focusNodeId) {
        process.stderr.write(
            `[warn] --model "${modelString}" matched no model — showing full graph.\n`
        );
    }

    // --tag: bare → interactive picker; string → validate and apply; undefined → no tag filter.
    let initialTag: string | undefined;
    if (opts.tag !== undefined) {
        // Collect tags actually present on any node.
        const allTags = Array.from(
            new Set(nodes.flatMap((n) => (n.data.tags as string[] | undefined) ?? []))
        ).sort();

        if (typeof opts.tag === "string") {
            if (allTags.includes(opts.tag)) {
                initialTag = opts.tag;
            } else {
                process.stderr.write(
                    `[warn] --tag "${opts.tag}" matched no tag — showing full graph.\n`
                );
            }
        } else {
            // bare `--tag` (commander gives `true`) → interactive picker
            requireTty("--tag");
            const picked = await pickTag(allTags);
            if (picked === null) {
                process.stderr.write("Cancelled.\n");
                process.exit(130);
            }
            initialTag = picked;
        }
    }

    const payload: GraphPayload = {
        initialNodesStatic: nodes,
        initialEdgesStatic: edges,
        datasetColorMap: Object.fromEntries(datasetColorMap),
        currentActiveEditorIdx: resolvedFocusId ?? "",
        initialTag,
    };

    const webviewDir = path.resolve(__dirname, "..", "webview-dist");
    const { port } = await startServer({
        port: opts.port ?? 0,
        host: opts.host,
        webviewDir,
        getGraph: () => payload,
        getSchema: fetchSchema,
    });

    // Listen host (e.g. "0.0.0.0", "::") isn't necessarily a valid *client* host.
    // Wildcards become "localhost"; bare IPv6 literals need bracketing.
    const clientHost = (() => {
        const h = opts.host;
        if (h === "0.0.0.0" || h === "::") {return "localhost";}
        if (h.includes(":")) {return `[${h}]`;}
        return h;
    })();
    const url = `http://${clientHost}:${port}`;
    process.stdout.write(`dataform-graph → ${url}  (${nodes.length} nodes, ${edges.length} edges)\n`);
    process.stdout.write("Press Ctrl+C to stop.\n");

    if (opts.open) {
        openInBrowser(url);
    }
}

main().catch((err: Error) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
});
