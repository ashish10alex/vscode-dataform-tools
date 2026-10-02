import { addHop, canExpand, expandDirection, focusNodeId, frontier, initialTraceState, removeUpstream, setNodeError, setNodeLoading } from './traceGraph';
import { ColumnChange, LineageDirection, TraceFocus, TraceSource, TraceState } from './types';

/** Hops loaded automatically on each side, so the list is readable without clicking through it */
export const AUTO_HOPS = 3;
/** A hop wider than this isn't loaded automatically; "load next hop" fetches it */
export const AUTO_FRONTIER_LIMIT = 25;
/** Lineage lookups in flight at once while loading a hop */
const HOP_CONCURRENCY = 6;

export async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) {
        await Promise.all(items.slice(i, i + size).map(run));
    }
}

/**
 * Drives a column trace: fetches hops from a {@link TraceSource} and reports each new state. Opening loads a
 * few hops downstream on its own; more come one level at a time. Has no VS Code dependency, so the extension
 * host and the webview's standalone preview share it.
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
        await this.autoExpand('downstream');
    }

    /** Loads the next hop on one side: every column on its outermost hop that hasn't been expanded */
    async expandLevel(direction: LineageDirection): Promise<void> {
        if (!this.state) {
            return;
        }
        const generation = this.generation;
        const ids = frontier(this.state, direction).map((node) => node.id);
        await inBatches(ids, HOP_CONCURRENCY, async (id) => {
            if (generation === this.generation) {
                await this.expand(id);
            }
        });
    }

    /** Loads up to {@link AUTO_HOPS} hops on a side, stopping at a hop wider than {@link AUTO_FRONTIER_LIMIT} */
    private async autoExpand(direction: LineageDirection) {
        const generation = this.generation;
        for (let hop = 1; hop < AUTO_HOPS && this.state && generation === this.generation; hop++) {
            const next = frontier(this.state, direction);
            if (next.length === 0 || next.length > AUTO_FRONTIER_LIMIT) {
                return;
            }
            await this.expandLevel(direction);
        }
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
        if (this.state?.upstreamShown) {
            await this.autoExpand('upstream');
        }
    }

    /** Updates the focus column's change against prod, e.g. after a new dry run */
    relabel(change: ColumnChange | undefined) {
        if (this.state) {
            this.set({ ...this.state, focus: { ...this.state.focus, change } });
        }
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
