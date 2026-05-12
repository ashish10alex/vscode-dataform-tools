/**
 * Transport seam for the dependency-graph webview.
 *
 * The same bundle runs in two host environments:
 *  - VS Code webview:  messages tunnel through `acquireVsCodeApi()` and `window.addEventListener('message')`.
 *  - Standalone browser (CLI): there is no host extension, so the transport
 *    fulfills `webviewReady` by fetching `/api/graph` and dispatching a synthetic
 *    `nodeMetadata` event. Other outbound messages are handled locally where
 *    sensible (e.g. `goToBigQuery` → `window.open`) and otherwise ignored.
 *
 * Detection is runtime: we probe for `acquireVsCodeApi`. This keeps the build
 * single-target — no separate vscode/cli bundles needed.
 */

export type HostMode = "vscode" | "cli";

export interface Transport {
    readonly mode: HostMode;
    onMessage(handler: (msg: any) => void): () => void;
    postMessage(msg: any): void;
    /**
     * Round-trip request. Posts `{ type, requestId, value }` and resolves with
     * the host's matching `{ type: "response", requestId, ok, value | error }`.
     * Rejects on `ok: false`, on transport error, or after `timeoutMs` (default 30s).
     */
    request<T = any>(type: string, value?: any, timeoutMs?: number): Promise<T>;
}

let nextRequestId = 0;

class VsCodeTransport implements Transport {
    readonly mode: HostMode = "vscode";
    private vscode: any;

    constructor(api: any) {
        this.vscode = api;
    }

    onMessage(handler: (msg: any) => void): () => void {
        const listener = (event: MessageEvent) => handler(event.data);
        window.addEventListener("message", listener);
        return () => window.removeEventListener("message", listener);
    }

    postMessage(msg: any): void {
        this.vscode.postMessage(msg);
    }

    request<T>(type: string, value?: any, timeoutMs = 30000): Promise<T> {
        return requestVia(this, type, value, timeoutMs);
    }
}

class CliTransport implements Transport {
    readonly mode: HostMode = "cli";
    private handlers: Array<(msg: any) => void> = [];

    onMessage(handler: (msg: any) => void): () => void {
        this.handlers.push(handler);
        return () => {
            this.handlers = this.handlers.filter((h) => h !== handler);
        };
    }

    private emit(msg: any) {
        // Copy first so handlers unsubscribing during dispatch don't skip siblings.
        for (const h of this.handlers.slice()) {
            h(msg);
        }
    }

    postMessage(msg: any): void {
        switch (msg?.type) {
            case "webviewReady":
                fetch("/api/graph")
                    .then((r) => r.json())
                    .then((value) => this.emit({ type: "nodeMetadata", value }))
                    .catch((err) => {
                        // eslint-disable-next-line no-console
                        console.error("Failed to fetch /api/graph", err);
                    });
                return;
            case "goToBigQuery":
                if (msg.value?.url) {
                    window.open(msg.value.url, "_blank", "noopener,noreferrer");
                }
                return;
            case "getSchema": {
                const v = msg.value ?? {};
                const qs = new URLSearchParams({
                    project: String(v.projectId ?? ""),
                    dataset: String(v.datasetId ?? ""),
                    table: String(v.tableId ?? ""),
                });
                fetch(`/api/schema?${qs.toString()}`)
                    .then(async (r) => {
                        const body = await r.json().catch(() => ({}));
                        if (!r.ok) {
                            const errMessage = (body && body.error) || `HTTP ${r.status}`;
                            this.emit({ type: "response", requestId: msg.requestId, ok: false, error: errMessage });
                            return;
                        }
                        this.emit({ type: "response", requestId: msg.requestId, ok: true, value: body });
                    })
                    .catch((err) => {
                        // A rejected fetch (vs. an HTTP error) means the server is unreachable —
                        // typically because the user shut the dataform-graph CLI down. Browsers
                        // surface this as "TypeError: Failed to fetch" / "NetworkError ..." which
                        // is too cryptic to show as-is.
                        const raw = err?.message ?? String(err);
                        const looksLikeNetworkError =
                            err instanceof TypeError ||
                            /failed to fetch|networkerror|load failed/i.test(raw);
                        const message = looksLikeNetworkError
                            ? "Could not reach the dataform-graph server (was it stopped?). " +
                              "Restart it with `dataform-graph` and reload this page."
                            : raw;
                        this.emit({
                            type: "response",
                            requestId: msg.requestId,
                            ok: false,
                            error: message,
                        });
                    });
                return;
            }
            // saveGraphImage and nodeFileName have no meaningful behavior in CLI mode (v1).
            default:
                return;
        }
    }

    request<T>(type: string, value?: any, timeoutMs = 30000): Promise<T> {
        return requestVia(this, type, value, timeoutMs);
    }
}

function requestVia<T>(transport: Transport, type: string, value: any, timeoutMs: number): Promise<T> {
    const requestId = String(++nextRequestId);
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) {return;}
            settled = true;
            unsubscribe();
            clearTimeout(timer);
            fn();
        };
        const unsubscribe = transport.onMessage((msg) => {
            if (!msg || msg.type !== "response" || msg.requestId !== requestId) {return;}
            if (msg.ok) {
                finish(() => resolve(msg.value as T));
            } else {
                finish(() => reject(new Error(msg.error ?? "request failed")));
            }
        });
        const timer = setTimeout(() => {
            finish(() => reject(new Error(`request "${type}" timed out after ${timeoutMs}ms`)));
        }, timeoutMs);
        try {
            transport.postMessage({ type, requestId, value });
        } catch (err) {
            finish(() => reject(err as Error));
        }
    });
}

let cached: Transport | null = null;

function detectVsCodeApi(): any | null {
    // `acquireVsCodeApi` is injected by the VS Code webview host. May only be called once per session.
    // @ts-ignore
    if (typeof acquireVsCodeApi === "function") {
        try {
            // @ts-ignore
            return acquireVsCodeApi();
        } catch {
            return null;
        }
    }
    return null;
}

export function getTransport(): Transport {
    if (!cached) {
        const api = detectVsCodeApi();
        cached = api ? new VsCodeTransport(api) : new CliTransport();
    }
    return cached;
}
