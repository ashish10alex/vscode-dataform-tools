import { ColumnLink, LineageDirection, TraceSource } from './types';

/** Remembers each lookup, so a column's reader counts and its trace share one call */
export class CachedTraceSource implements TraceSource {
    private readonly cache = new Map<string, Promise<ColumnLink[]>>();

    constructor(private readonly inner: TraceSource) {}

    get kind(): TraceSource['kind'] {
        return this.inner.kind;
    }

    links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]> {
        const key = `${table}#${column.toLowerCase()}#${direction}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.inner.links(table, column, direction);
            const stored = pending;
            // A failed lookup is tried again next time
            stored.catch(() => {
                if (this.cache.get(key) === stored) {
                    this.cache.delete(key);
                }
            });
            this.cache.set(key, pending);
        }
        return pending;
    }

    clearCache() {
        this.cache.clear();
        this.inner.clearCache?.();
    }
}
