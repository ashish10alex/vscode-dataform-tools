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
}

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
            // saveGraphImage and nodeFileName have no meaningful behavior in CLI mode (v1).
            default:
                return;
        }
    }
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
