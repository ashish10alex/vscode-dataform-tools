import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { indexHtml } from "./template";

export interface GraphPayload {
    initialNodesStatic: unknown[];
    initialEdgesStatic: unknown[];
    datasetColorMap: Record<string, string>;
    currentActiveEditorIdx: string;
    /** When set, the webview pre-applies this tag filter on first render. */
    initialTag?: string;
}

export interface SchemaField {
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: SchemaField[];
}

export interface SchemaResult {
    fields: SchemaField[];
    /** Epoch milliseconds (as a string, matching BigQuery's REST payload). */
    lastModifiedTime?: string;
}

export interface ServerOptions {
    port: number;
    host?: string;
    webviewDir: string;
    getGraph: () => GraphPayload;
    /** Optional BigQuery schema fetcher. If absent, /api/schema returns 501. */
    getSchema?: (project: string, dataset: string, table: string) => Promise<SchemaResult>;
}

const mimeTypes: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".html": "text/html; charset=utf-8",
};

function serveAsset(webviewDir: string, urlPath: string, res: http.ServerResponse): void {
    // Strip the leading "/assets/" and refuse anything that tries to escape.
    const rel = urlPath.replace(/^\/assets\//, "");
    if (rel.includes("..") || rel.startsWith("/")) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
    }
    const filePath = path.join(webviewDir, rel);
    if (!filePath.startsWith(webviewDir + path.sep) && filePath !== webviewDir) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end("Not found");
            return;
        }
        const ext = path.extname(filePath);
        res.statusCode = 200;
        res.setHeader("Content-Type", mimeTypes[ext] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.end(data);
    });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
}

export function createServer(options: ServerOptions): http.Server {
    const { webviewDir, getGraph, getSchema } = options;

    return http.createServer((req, res) => {
        const url = req.url || "/";

        if (url === "/" || url === "/index.html") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(indexHtml);
            return;
        }

        if (url === "/api/graph") {
            try {
                writeJson(res, 200, getGraph());
            } catch (err) {
                const details = err instanceof Error ? err.message : String(err);
                process.stderr.write(`/api/graph failed: ${details}\n`);
                writeJson(res, 500, { error: "Failed to generate graph", details });
            }
            return;
        }

        if (url.startsWith("/api/schema")) {
            if (!getSchema) {
                writeJson(res, 501, { error: "schema lookup not configured on this server" });
                return;
            }
            const parsed = new URL(url, "http://localhost");
            const project = parsed.searchParams.get("project");
            const dataset = parsed.searchParams.get("dataset");
            const table = parsed.searchParams.get("table");
            if (!project || !dataset || !table) {
                writeJson(res, 400, { error: "project, dataset, and table query params required" });
                return;
            }
            getSchema(project, dataset, table)
                .then((result) => writeJson(res, 200, result))
                .catch((err: Error) => writeJson(res, 500, { error: err.message ?? String(err) }));
            return;
        }

        if (url.startsWith("/assets/")) {
            serveAsset(webviewDir, url, res);
            return;
        }

        res.statusCode = 404;
        res.end("Not found");
    });
}

export function startServer(options: ServerOptions): Promise<{ port: number; close: () => Promise<void> }> {
    const server = createServer(options);
    const host = options.host ?? "127.0.0.1";
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, host, () => {
            const address = server.address();
            const port = typeof address === "object" && address ? address.port : options.port;
            resolve({
                port,
                close: () =>
                    new Promise<void>((res2, rej2) => server.close((err) => (err ? rej2(err) : res2()))),
            });
        });
    });
}
