import type { TraceState } from '../../src/shared/columnLineage/types';

export const NODE_WIDTH = 248;
export const NODE_HEIGHT = 74;
const ROW_GAP = 18;
const HOP_STEP = NODE_WIDTH + 104;

export interface Placed {
    x: number;
    y: number;
}

export interface Lane {
    hop: number;
    x: number;
    top: number;
    height: number;
}

/**
 * Lays the trace out in vertical lanes, one per hop. Lanes fill outward from the focus so each column sits
 * near the columns it links to, which keeps edges short and mostly horizontal.
 */
export function layoutTrace(state: TraceState): { positions: Map<string, Placed>; lanes: Lane[] } {
    const byHop = new Map<number, string[]>();
    for (const node of state.nodes) {
        byHop.set(node.hop, [...(byHop.get(node.hop) ?? []), node.id]);
    }
    const kindOf = new Map(state.nodes.map((node) => [node.id, node.kind]));
    const labelOf = new Map(state.nodes.map((node) => [node.id, `${node.table}.${node.column ?? ''}`]));
    const positions = new Map<string, Placed>();

    const neighboursTowardFocus = (id: string, hop: number): string[] => hop > 0
        ? state.edges.filter((edge) => edge.target === id).map((edge) => edge.source)
        : state.edges.filter((edge) => edge.source === id).map((edge) => edge.target);

    const placeLane = (hop: number) => {
        const ids = byHop.get(hop);
        if (!ids) {
            return;
        }
        const anchor = (id: string) => {
            const ys = neighboursTowardFocus(id, hop).map((n) => positions.get(n)?.y).filter((y): y is number => y !== undefined);
            return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
        };
        const ordered = [...ids].sort((a, b) =>
            anchor(a) - anchor(b)
            || Number(kindOf.get(a) === 'tableOnly') - Number(kindOf.get(b) === 'tableOnly')
            || labelOf.get(a)!.localeCompare(labelOf.get(b)!));
        const span = ordered.length * NODE_HEIGHT + (ordered.length - 1) * ROW_GAP;
        const centre = hop === 0 ? 0 : ordered.reduce((sum, id) => sum + anchor(id), 0) / ordered.length;
        ordered.forEach((id, i) => {
            positions.set(id, { x: hop * HOP_STEP, y: centre - span / 2 + i * (NODE_HEIGHT + ROW_GAP) + NODE_HEIGHT / 2 });
        });
    };

    const hops = [...byHop.keys()];
    placeLane(0);
    for (let hop = 1; hop <= Math.max(0, ...hops); hop++) {
        placeLane(hop);
    }
    for (let hop = -1; hop >= Math.min(0, ...hops); hop--) {
        placeLane(hop);
    }

    // Positions so far are node centres; convert to top-left corners for React Flow
    const ys = [...positions.values()].map((p) => p.y);
    const top = Math.min(...ys) - NODE_HEIGHT / 2 - 64;
    const bottom = Math.max(...ys) + NODE_HEIGHT / 2 + 28;
    positions.forEach((p, id) => positions.set(id, { x: p.x, y: p.y - NODE_HEIGHT / 2 }));

    const lanes = hops.sort((a, b) => a - b).map((hop) => ({
        hop,
        x: hop * HOP_STEP - 26,
        top,
        height: bottom - top,
    }));
    return { positions, lanes };
}

export function laneLabel(hop: number): string {
    if (hop === 0) {
        return 'Column';
    }
    const n = Math.abs(hop);
    return `${hop < 0 ? 'Upstream' : 'Downstream'} · ${n} hop${n === 1 ? '' : 's'}`;
}
