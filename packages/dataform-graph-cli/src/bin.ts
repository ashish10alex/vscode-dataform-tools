import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { DataformCompiledJson } from "../../../src/types";
import { buildDependencyGraph } from "../../../src/shared/buildDependencyGraph";
import { runDataformCompile } from "./compile";
import { openInBrowser } from "./openBrowser";
import { pickModel, pickTag } from "./picker";
import { GraphPayload, startServer } from "./server";
import { startSpinner } from "./spinner";

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
}

function parsePort(raw: string): number {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
        throw new Error(`Invalid port "${raw}" — must be an integer in [0, 65535].`);
    }
    return n;
}

async function loadCompiled(opts: CliOptions): Promise<DataformCompiledJson> {
    if (opts.input) {
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

    const stop = startSpinner("Compiling dataform project");
    try {
        const result = await runDataformCompile({ cwd, bin });
        stop({ success: true, successMessage: "Compiled dataform project" });
        return result as DataformCompiledJson;
    } catch (err) {
        // Clear the spinner without a success line so the error printed by the
        // top-level catch isn't obscured by leftover spinner characters.
        stop();
        throw err;
    }
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
    });

    const url = `http://${opts.host}:${port}`;
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
