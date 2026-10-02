import type { CardLink, TraceCard } from '../../src/shared/columnLineage/traceCards';

/** Narrowest and widest a lane's cards get; each lane is as wide as its longest table name needs */
const MIN_CARD_WIDTH = 288;
const MAX_CARD_WIDTH = 640;
/** Width of one character of the monospace table name, at the card title's font size */
const TITLE_CHAR_WIDTH = 7;
/** Card padding, chevron and border around the title */
const TITLE_CHROME = 46;
/** Horizontal space between lanes, where the edges and their labels go */
const LANE_GAP = 120;
/** Table name and summary line */
export const CARD_HEADER_HEIGHT = 52;
export const CARD_ROW_HEIGHT = 26;
const CARD_PADDING = 6;
const CARD_GAP = 16;

export interface Placed {
    x: number;
    y: number;
}

export interface Lane {
    hop: number;
    x: number;
    top: number;
    height: number;
    /** Width of the lane's cards */
    cardWidth: number;
}

/** `dataset.table`, as a card's title shows it */
export function cardTitle(card: TraceCard): string {
    if (!card.table) {
        return 'Assertions';
    }
    return card.table.split('.').slice(-2).join('.');
}

function laneWidth(cards: TraceCard[]): number {
    const longest = Math.max(0, ...cards.map((card) => cardTitle(card).length));
    return Math.min(MAX_CARD_WIDTH, Math.max(MIN_CARD_WIDTH, Math.ceil(longest * TITLE_CHAR_WIDTH + TITLE_CHROME)));
}

export function cardHeight(card: TraceCard, open: boolean): number {
    return CARD_HEADER_HEIGHT + (open ? card.rows.length * CARD_ROW_HEIGHT + CARD_PADDING : 0);
}

/**
 * Lays the cards out in vertical lanes, one per hop. Lanes fill outward from the focus so each card sits near
 * the cards it links to, which keeps edges short and mostly horizontal. Positions are top-left corners.
 */
export function layoutCards(cards: TraceCard[], links: CardLink[], isOpen: (cardId: string) => boolean): { positions: Map<string, Placed>; lanes: Lane[] } {
    const byHop = new Map<number, TraceCard[]>();
    for (const card of cards) {
        byHop.set(card.hop, [...(byHop.get(card.hop) ?? []), card]);
    }
    // Lanes sit side by side outward from the focus at x = 0, each as wide as its cards
    const widths = new Map([...byHop].map(([hop, lane]) => [hop, laneWidth(lane)]));
    const xs = new Map<number, number>([[0, 0]]);
    const hopList = [...byHop.keys()];
    for (let hop = 1; hop <= Math.max(0, ...hopList); hop++) {
        xs.set(hop, xs.get(hop - 1)! + (widths.get(hop - 1) ?? MIN_CARD_WIDTH) + LANE_GAP);
    }
    for (let hop = -1; hop >= Math.min(0, ...hopList); hop--) {
        xs.set(hop, xs.get(hop + 1)! - (widths.get(hop) ?? MIN_CARD_WIDTH) - LANE_GAP);
    }
    const centres = new Map<string, number>();
    const positions = new Map<string, Placed>();

    const neighboursTowardFocus = (card: TraceCard): string[] => card.hop > 0
        ? links.filter((link) => link.target === card.id).map((link) => link.source)
        : links.filter((link) => link.source === card.id).map((link) => link.target);

    const placeLane = (hop: number) => {
        const lane = byHop.get(hop);
        if (!lane) {
            return;
        }
        const anchor = (card: TraceCard) => {
            const ys = neighboursTowardFocus(card).map((id) => centres.get(id)).filter((y): y is number => y !== undefined);
            return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
        };
        const ordered = [...lane].sort((a, b) => Number(a.assertions) - Number(b.assertions)
            || anchor(a) - anchor(b)
            || (a.table ?? '').localeCompare(b.table ?? ''));
        const heights = ordered.map((card) => cardHeight(card, isOpen(card.id)));
        const span = heights.reduce((a, b) => a + b, 0) + (ordered.length - 1) * CARD_GAP;
        const centre = hop === 0 ? 0 : ordered.reduce((sum, card) => sum + anchor(card), 0) / ordered.length;
        let y = centre - span / 2;
        ordered.forEach((card, i) => {
            positions.set(card.id, { x: xs.get(hop)!, y });
            centres.set(card.id, y + heights[i] / 2);
            y += heights[i] + CARD_GAP;
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

    const tops = cards.map((card) => positions.get(card.id)!.y);
    const bottoms = cards.map((card) => positions.get(card.id)!.y + cardHeight(card, isOpen(card.id)));
    const top = Math.min(...tops) - 64;
    const bottom = Math.max(...bottoms) + 28;
    const lanes = hops.sort((a, b) => a - b).map((hop) => ({ hop, x: xs.get(hop)! - 26, top, height: bottom - top, cardWidth: widths.get(hop)! }));
    return { positions, lanes };
}

export function laneLabel(hop: number): string {
    if (hop === 0) {
        return 'Column';
    }
    const n = Math.abs(hop);
    return `${hop < 0 ? 'Upstream' : 'Downstream'} · ${n} hop${n === 1 ? '' : 's'}`;
}
