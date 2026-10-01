import { logger } from './logger';

// Lightweight timings and call counts for the hot paths (activation, save -> preview, editor switch).
// Spans are kept in a ring buffer and logged at debug level; `just bench` reads them through the
// extension's exports to report before/after numbers.

export interface PerfSpan {
    name: string;
    start: number;
    ms: number;
    attrs?: Record<string, string | number | boolean>;
}

export interface PerfSnapshot {
    spans: PerfSpan[];
    counters: Record<string, number>;
}

export const MAX_PERF_SPANS = 500;

let spans: PerfSpan[] = [];
let counters: Record<string, number> = {};

function record(span: PerfSpan) {
    spans.push(span);
    if (spans.length > MAX_PERF_SPANS) {
        spans.splice(0, spans.length - MAX_PERF_SPANS);
    }
    const attrs = span.attrs ? ' ' + Object.entries(span.attrs).map(([key, value]) => `${key}=${value}`).join(' ') : '';
    logger.debug(`[perf] ${span.name} ${span.ms.toFixed(1)}ms${attrs}`);
}

/** Starts a span; call the returned function once to end it. Later calls are ignored. */
export function perfStart(name: string, attrs?: PerfSpan['attrs']): (extraAttrs?: PerfSpan['attrs']) => void {
    const start = performance.now();
    let ended = false;
    return (extraAttrs) => {
        if (ended) {
            return;
        }
        ended = true;
        const merged = attrs || extraAttrs ? { ...attrs, ...extraAttrs } : undefined;
        record({ name, start, ms: performance.now() - start, attrs: merged });
    };
}

export async function perfTimed<T>(name: string, fn: () => Promise<T>, attrs?: PerfSpan['attrs']): Promise<T> {
    const end = perfStart(name, attrs);
    try {
        return await fn();
    } finally {
        end();
    }
}

export function perfCount(name: string, n: number = 1) {
    counters[name] = (counters[name] ?? 0) + n;
}

export function getPerfSnapshot(): PerfSnapshot {
    return { spans: spans.slice(), counters: { ...counters } };
}

export function resetPerf() {
    spans = [];
    counters = {};
}
