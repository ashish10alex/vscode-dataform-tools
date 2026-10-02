import { otherProject } from './impactSummary';
import { traceRows } from './traceGraph';
import { DependencyType, TraceNode, TraceState } from './types';

// Groups a trace's columns into one card per table per hop, for the graph view. A collapsed card stands for all
// its columns, so the links into and out of it are bundled into one edge per card pair.

/** A card with this many columns or fewer starts expanded */
export const OPEN_UP_TO = 3;

export interface TraceCard {
    id: string;
    hop: number;
    /** Undefined for a hop's assertions card, which holds every assertion on that hop */
    table?: string;
    filePath?: string;
    /** Shown before the table name: see {@link shownProject} */
    project?: string;
    assertions: boolean;
    /** The card's columns: copies first, then derived, then table-level ("may read") ones */
    rows: TraceNode[];
    /** How each row links toward the focus: the strongest link when there are several */
    relation: Map<string, DependencyType>;
}

/** An edge as drawn: between two rows when both cards are open, otherwise to or from a collapsed card */
export interface CardLink {
    id: string;
    source: string;
    target: string;
    /** The source row's node id, when its card is open */
    sourceRow?: string;
    targetRow?: string;
    counts: Record<DependencyType, number>;
    /** The trace edges it stands for, to highlight it with any of them */
    edgeIds: string[];
}

const STRENGTH: Record<DependencyType, number> = { EXACT_COPY: 0, OTHER: 1, TABLE_ONLY: 2 };

/**
 * The project of a table that matches no action in this project and is in another GCP project than the focus, e.g. a
 * dev run of another repository's table: without it, it would look like the prod table of the same name
 */
export function shownProject(node: Pick<TraceNode, 'table' | 'filePath'>, focusTable: string): string | undefined {
    return node.filePath ? undefined : otherProject(node.table, focusTable);
}

export function cardIdOf(node: Pick<TraceNode, 'hop' | 'table' | 'assertion'>): string {
    return node.assertion ? `card:${node.hop}:assertions` : `card:${node.hop}:${node.table}`;
}

export function traceCards(state: TraceState): TraceCard[] {
    const relation = new Map<string, DependencyType>();
    for (const row of [...traceRows(state, 'downstream'), ...traceRows(state, 'upstream')]) {
        relation.set(row.node.id, row.dependencyType);
    }
    const cards = new Map<string, TraceCard>();
    for (const node of state.nodes) {
        const id = cardIdOf(node);
        let card = cards.get(id);
        if (!card) {
            const project = node.assertion ? undefined : shownProject(node, state.focus.table);
            card = {
                id,
                hop: node.hop,
                table: node.assertion ? undefined : node.table,
                filePath: node.assertion ? undefined : node.filePath,
                ...(project ? { project } : {}),
                assertions: !!node.assertion,
                rows: [],
                relation: new Map(),
            };
            cards.set(id, card);
        }
        card.rows.push(node);
        const type = relation.get(node.id);
        if (type) {
            card.relation.set(node.id, type);
        }
    }
    for (const card of cards.values()) {
        const strength = (node: TraceNode) => STRENGTH[card.relation.get(node.id) ?? 'OTHER'];
        card.rows.sort((a, b) => strength(a) - strength(b)
            || `${a.table}.${a.column ?? ''}`.localeCompare(`${b.table}.${b.column ?? ''}`));
    }
    return [...cards.values()];
}

/** Where a card starts: open for the focus and for small tables, collapsed for wide ones and for assertions */
export function opensByDefault(card: TraceCard): boolean {
    return card.hop === 0 || (!card.assertions && card.rows.length <= OPEN_UP_TO);
}

/** The edges to draw, bundling trace edges that meet a collapsed card */
export function cardLinks(state: TraceState, isOpen: (cardId: string) => boolean): CardLink[] {
    const cardOf = new Map(state.nodes.map((node) => [node.id, cardIdOf(node)]));
    const links = new Map<string, CardLink>();
    for (const edge of state.edges) {
        const source = cardOf.get(edge.source);
        const target = cardOf.get(edge.target);
        if (!source || !target) {
            continue;
        }
        const sourceRow = isOpen(source) ? edge.source : undefined;
        const targetRow = isOpen(target) ? edge.target : undefined;
        const id = `${sourceRow ?? source}->${targetRow ?? target}`;
        let link = links.get(id);
        if (!link) {
            link = { id, source, target, sourceRow, targetRow, counts: { EXACT_COPY: 0, OTHER: 0, TABLE_ONLY: 0 }, edgeIds: [] };
            links.set(id, link);
        }
        link.counts[edge.dependencyType]++;
        link.edgeIds.push(edge.id);
    }
    return [...links.values()];
}

/** e.g. "14 columns · 2 copies, 12 derived" */
export function cardSummary(card: TraceCard): string {
    const count = (type: DependencyType) => card.rows.filter((row) => card.relation.get(row.id) === type).length;
    const columns = card.rows.filter((row) => row.column).length;
    const copies = count('EXACT_COPY');
    const derived = count('OTHER');
    const parts = [
        copies && `${copies} cop${copies === 1 ? 'y' : 'ies'}`,
        derived && `${derived} derived`,
        count('TABLE_ONLY') && 'may read',
    ].filter(Boolean).join(', ');
    const tables = card.assertions ? new Set(card.rows.map((row) => row.table)).size : 0;
    return [
        card.assertions ? `${tables} assertion${tables === 1 ? '' : 's'}` : '',
        columns ? `${columns} column${columns === 1 ? '' : 's'}` : '',
        parts,
    ].filter(Boolean).join(' · ');
}

/** e.g. "12 derived · 2 copies" for a bundled edge, or the single link's type */
export function linkLabel(link: CardLink): string | undefined {
    const { EXACT_COPY: copies, OTHER: derived, TABLE_ONLY: mayRead } = link.counts;
    if (copies + derived + mayRead === 1) {
        return copies ? 'copy' : derived ? 'derived or filtered' : undefined;
    }
    return [
        derived && `${derived} derived`,
        copies && `${copies} cop${copies === 1 ? 'y' : 'ies'}`,
        mayRead && `${mayRead} may read`,
    ].filter(Boolean).join(' · ');
}

/** The colour an edge takes: a copy only when every link it stands for is one, table-level only when all are */
export function linkKind(link: CardLink): DependencyType {
    const { EXACT_COPY: copies, OTHER: derived, TABLE_ONLY: mayRead } = link.counts;
    if (derived > 0 || (copies > 0 && mayRead > 0)) {
        return 'OTHER';
    }
    return copies > 0 ? 'EXACT_COPY' : 'TABLE_ONLY';
}
