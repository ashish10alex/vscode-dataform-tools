import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { DataformCompiledJson } from "../../src/types";
import { buildDependencyGraph } from "../../src/shared/buildDependencyGraph";
import { runDataformCompile } from "./compile";
import { openInBrowser } from "./openBrowser";
import { pickModel } from "./picker";
import { GraphPayload, startServer } from "./server";

interface CliOptions {
    // commander returns `true` when `--focus` is supplied with no value, `string` when supplied with a value.
    focus?: string | boolean;
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
    return (await runDataformCompile({ cwd, bin })) as DataformCompiledJson;
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
            "-f, --focus [model]",
            "Focus the initial view on a specific model. " +
                "Matches against the file name, fully-qualified `database.schema.name`, or short `target.name`. " +
                "If no match is found, the full graph is shown and a warning is printed. " +
                "Pass --focus with no value to pick a model interactively."
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

    const compiled = await loadCompiled(opts);

    // A bare `--focus` (no value) triggers the interactive picker; a string value
    // goes through the same matching path as before; absent means no focus.
    const interactive = opts.focus === true;
    const focusString = typeof opts.focus === "string" ? opts.focus : undefined;

    const { nodes, edges, datasetColorMap, focusNodeId } = buildDependencyGraph(compiled, {
        focusIdentifier: focusString,
    });

    let resolvedFocusId: string | null = focusNodeId;

    if (interactive) {
        if (!process.stdin.isTTY) {
            throw new Error(
                "Interactive --focus requires an interactive terminal. " +
                    "Pass a value (e.g. --focus my_model) or run without --focus."
            );
        }
        const picked = await pickModel(nodes);
        if (picked === null) {
            process.stderr.write("Cancelled.\n");
            process.exit(130);
        }
        resolvedFocusId = picked;
    } else if (focusString && !focusNodeId) {
        process.stderr.write(
            `[warn] --focus "${focusString}" matched no model — showing full graph.\n`
        );
    }

    const payload: GraphPayload = {
        initialNodesStatic: nodes,
        initialEdgesStatic: edges,
        datasetColorMap: Object.fromEntries(datasetColorMap),
        currentActiveEditorIdx: resolvedFocusId ?? "",
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
