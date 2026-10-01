import { addHop, canExpand, expandDirection, focusNodeId, initialTraceState, removeUpstream, setNodeError, setNodeLoading } from './traceGraph';
import { TraceFocus, TraceSource, TraceState } from './types';

/**
 * Drives a column trace: fetches one hop at a time from a {@link TraceSource} and reports each new state.
 * Has no VS Code dependency, so the extension host and the webview's standalone preview share it.
 */
export class TraceController {
    private state: TraceState | undefined;
    /** Bumped on open and refresh, so lookups started for an older trace are dropped */
    private generation = 0;

    constructor(
        private readonly source: TraceSource,
        private readonly emit: (state: TraceState) => void,
        private readonly resolveFile: (table: string) => string | undefined = () => undefined,
    ) {}

    get current(): TraceState | undefined {
        return this.state;
    }

    async open(focus: TraceFocus): Promise<void> {
        this.generation++;
        const state = initialTraceState(focus, this.source.kind);
        state.nodes[0].filePath = this.resolveFile(focus.table);
        this.set(state);
        await this.fetch(focusNodeId(state), 'downstream');
    }

    async expand(nodeId: string): Promise<void> {
        const node = this.state?.nodes.find((candidate) => candidate.id === nodeId);
        if (!node || !canExpand(node)) {
            return;
        }
        await this.fetch(nodeId, expandDirection(node));
    }

    async setUpstream(on: boolean): Promise<void> {
        if (!this.state || on === this.state.upstreamShown) {
            return;
        }
        if (!on) {
            this.set(removeUpstream(this.state));
            return;
        }
        this.set({ ...this.state, upstreamShown: true });
        await this.fetch(focusNodeId(this.state), 'upstream');
    }

    async refresh(): Promise<void> {
        if (!this.state) {
            return;
        }
        const { focus, upstreamShown } = this.state;
        this.source.clearCache?.();
        await this.open(focus);
        if (upstreamShown) {
            await this.setUpstream(true);
        }
    }

    private set(state: TraceState) {
        this.state = state;
        this.emit(state);
    }

    private async fetch(nodeId: string, direction: 'upstream' | 'downstream') {
        const generation = this.generation;
        const node = this.state?.nodes.find((candidate) => candidate.id === nodeId);
        if (!this.state || !node?.column) {
            return;
        }
        this.set(setNodeLoading(this.state, nodeId, true));
        try {
            const links = await this.source.links(node.table, node.column, direction);
            if (generation !== this.generation || !this.state) {
                return;
            }
            if (node.hop === 0 && direction === 'upstream' && !this.state.upstreamShown) {
                // Upstream was switched off while this lookup ran
                this.set(setNodeLoading(this.state, nodeId, false));
            } else {
                this.set(addHop(this.state, nodeId, direction, links, this.resolveFile));
            }
        } catch (error: any) {
            if (generation === this.generation && this.state) {
                this.set(setNodeError(this.state, nodeId, error?.message ?? String(error)));
            }
        }
    }
}
