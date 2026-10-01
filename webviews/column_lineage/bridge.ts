import type { WebviewApi } from 'vscode-webview';
import type { HostToViewMessage, ViewToHostMessage } from '../../src/shared/columnLineage/types';
import { TraceController } from '../../src/shared/columnLineage/traceController';
import { SAMPLE_FOCUS, SAMPLE_IMPACT, SampleTraceSource, resolveSampleFile } from '../../src/shared/columnLineage/sampleSource';
import type { ImpactView } from '../../src/shared/columnLineage/types';

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
    const emit = (message: HostToViewMessage) => listeners.forEach((listener) => listener(message));
    // `#impact` previews impact mode: a short "checking" state, then the sample changes with the first one traced
    let impact: ImpactView | null = null;
    const select = (column: string) => {
        const entry = SAMPLE_IMPACT.entries.find((candidate) => candidate.column === column);
        if (!entry || !impact) {
            return;
        }
        impact = { ...impact, selected: column };
        emit({ type: 'impact', impact });
        void controller.open({ table: SAMPLE_IMPACT.table, column, change: entry.change });
    };
    const checkImpact = () => {
        impact = { status: 'loading', entries: [] };
        emit({ type: 'trace', state: null });
        emit({ type: 'impact', impact });
        setTimeout(() => {
            impact = { status: 'ready', table: SAMPLE_IMPACT.table, entries: SAMPLE_IMPACT.entries, checkedAt: Date.now() };
            emit({ type: 'impact', impact });
            select(SAMPLE_IMPACT.entries[0].column);
        }, 700);
    };
    return {
        hosted: false,
        post(message) {
            switch (message.type) {
                case 'webviewReady': location.hash === '#impact' ? checkImpact() : void controller.open(SAMPLE_FOCUS); break;
                case 'selectImpact': select(message.column); break;
                case 'recheckImpact': checkImpact(); break;
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
