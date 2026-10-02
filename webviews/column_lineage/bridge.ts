import type { WebviewApi } from 'vscode-webview';
import type { HostToViewMessage, ViewToHostMessage } from '../../src/shared/columnLineage/types';
import { TraceController } from '../../src/shared/columnLineage/traceController';
import { ColumnsController } from '../../src/shared/columnLineage/columnsController';
import { CachedTraceSource } from '../../src/shared/columnLineage/cachedSource';
import { SAMPLE_COLUMNS, SAMPLE_FOCUS, SAMPLE_IMPACT, SampleTraceSource, resolveSampleFile } from '../../src/shared/columnLineage/sampleSource';
import { ImpactView, buildImpactSummary, impactMarkdown } from '../../src/shared/columnLineage/impactSummary';

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
 * Outside VS Code (a plain browser, for previewing the UI) the panel runs in the page against the sample
 * source, through the same controllers the extension host uses. `#trace` previews a single trace with no
 * column list; `#unchecked` a column list with no dry run to label it; `#many` one where most columns changed;
 * `#impact` the column impact summary of a sample branch.
 */
function standaloneBridge(): Bridge {
    const listeners = new Set<(message: HostToViewMessage) => void>();
    const emit = (message: HostToViewMessage) => listeners.forEach((listener) => listener(message));
    const trace = new TraceController(new SampleTraceSource(), (state) => emit({ type: 'trace', state }), resolveSampleFile);
    const columns = new ColumnsController(
        (view) => emit({ type: 'columns', columns: view }),
        (state) => emit({ type: 'trace', state }),
    );
    const traceOnly = location.hash === '#trace';
    const active = () => (traceOnly ? trace : columns.trace);
    const load = () => {
        columns.loading();
        // A short pause, as reading the schemas would take
        setTimeout(() => {
            const input = location.hash === '#unchecked'
                ? { ...SAMPLE_COLUMNS, dev: undefined }
                : location.hash === '#many'
                    ? { ...SAMPLE_COLUMNS, dev: [{ name: 'region', type: 'INT64' }, { name: 'revenue_eur', type: 'NUMERIC' }] }
                    : SAMPLE_COLUMNS;
            void columns.load(input, new CachedTraceSource(new SampleTraceSource()), resolveSampleFile);
        }, 500);
    };
    // The column impact summary of the sample branch, through the same pipeline the extension host uses
    const impactMode = location.hash === '#impact';
    const impactSource = new CachedTraceSource(new SampleTraceSource());
    let impact: ImpactView | null = null;
    let impactTrace: TraceController | undefined;
    let impactRun = 0;
    const setImpact = (view: ImpactView) => {
        impact = view;
        emit({ type: 'impact', impact: view });
    };
    const runImpact = async () => {
        const run = ++impactRun;
        const { candidates, changed, sql } = SAMPLE_IMPACT;
        const base = {
            comparison: { headRef: 'feat/revenue-eur', baseRef: 'origin/main', mergeBaseSha: '52863aa0c1d2', headLabel: 'working tree' },
            changedCount: candidates.length,
            atRisk: [],
            safe: [],
            unchecked: [],
        };
        const summary = await buildImpactSummary(
            candidates,
            impactSource,
            { resolveFile: resolveSampleFile, changed, sqlOf: (table) => sql[table] },
            (done, total) => run === impactRun && setImpact({ ...base, status: 'running', progress: { phase: 'Looking up readers', done, total } }),
            () => run !== impactRun,
        );
        if (summary && run === impactRun) {
            setImpact({ ...base, ...summary, status: 'ready', checkedAt: Date.now() });
        }
    };
    const impactActive = () => impactTrace;

    return {
        hosted: false,
        post(message) {
            if (impactMode) {
                switch (message.type) {
                    case 'webviewReady': void runImpact(); return;
                    case 'refreshImpact': void runImpact(); return;
                    case 'cancelImpact':
                        impactRun++;
                        if (impact) {
                            setImpact({ ...impact, status: 'cancelled', progress: undefined });
                        }
                        return;
                    case 'copyImpactMarkdown': if (impact) { console.log(impactMarkdown(impact)); } return;
                    case 'traceImpactColumn': {
                        const change = impact?.atRisk.find((entry) => entry.table === message.table)?.columns.find((entry) => entry.column === message.column)?.change;
                        impactTrace?.pause();
                        impactTrace = new TraceController(impactSource, (state) => emit({ type: 'trace', state }), resolveSampleFile);
                        void impactTrace.open({ table: message.table, column: message.column, change });
                        return;
                    }
                    case 'closeImpactTrace':
                        impactTrace?.pause();
                        impactTrace = undefined;
                        emit({ type: 'trace', state: null });
                        return;
                    case 'openTableFile': console.log('Would open the file of', message.table); return;
                    case 'expand': void impactActive()?.expand(message.nodeId); return;
                    case 'expandLevel': void impactActive()?.expandLevel(message.direction); return;
                    case 'setUpstream': void impactActive()?.setUpstream(message.on); return;
                    case 'refresh': void impactActive()?.refresh(); return;
                    default: return;
                }
            }
            switch (message.type) {
                case 'webviewReady': traceOnly ? void trace.open(SAMPLE_FOCUS) : load(); break;
                case 'selectColumn': columns.select(message.column); break;
                case 'recheckColumns': load(); break;
                case 'showImpact':
                    location.hash = '#impact';
                    location.reload();
                    break;
                case 'expand': void active()?.expand(message.nodeId); break;
                case 'expandLevel': void active()?.expandLevel(message.direction); break;
                case 'setUpstream': void (traceOnly ? trace.setUpstream(message.on) : columns.setUpstream(message.on)); break;
                case 'refresh': void active()?.refresh(); break;
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
