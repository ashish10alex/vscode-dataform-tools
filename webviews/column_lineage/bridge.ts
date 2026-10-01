import type { WebviewApi } from 'vscode-webview';
import type { HostToViewMessage, ViewToHostMessage } from '../../src/shared/columnLineage/types';
import { TraceController } from '../../src/shared/columnLineage/traceController';
import { SAMPLE_FOCUS, SampleTraceSource, resolveSampleFile } from '../../src/shared/columnLineage/sampleSource';

declare function acquireVsCodeApi(): WebviewApi<unknown>;

export interface Bridge {
    readonly hosted: boolean;
    post(message: ViewToHostMessage): void;
    subscribe(listener: (message: HostToViewMessage) => void): () => void;
}

function vscodeBridge(api: WebviewApi<unknown>): Bridge {
    return {
        hosted: true,
        post: (message) => api.postMessage(message),
        subscribe(listener) {
            const handler = (event: MessageEvent<HostToViewMessage>) => listener(event.data);
            window.addEventListener('message', handler);
            return () => window.removeEventListener('message', handler);
        },
    };
}

/**
 * Outside VS Code (a plain browser, for previewing the UI) the trace runs in the page against the sample
 * source, through the same controller the extension host uses.
 */
function standaloneBridge(): Bridge {
    const listeners = new Set<(message: HostToViewMessage) => void>();
    const controller = new TraceController(
        new SampleTraceSource(),
        (state) => listeners.forEach((listener) => listener({ type: 'trace', state })),
        resolveSampleFile,
    );
    return {
        hosted: false,
        post(message) {
            switch (message.type) {
                case 'webviewReady': void controller.open(SAMPLE_FOCUS); break;
                case 'expand': void controller.expand(message.nodeId); break;
                case 'setUpstream': void controller.setUpstream(message.on); break;
                case 'refresh': void controller.refresh(); break;
                case 'openFile': console.log('Would open the file for', message.nodeId); break;
            }
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

export async function createBridge(): Promise<Bridge> {
    // Async so a real data source can be set up before the first message
    return typeof acquireVsCodeApi === 'function' ? vscodeBridge(acquireVsCodeApi()) : standaloneBridge();
}
