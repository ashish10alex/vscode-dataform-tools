import { SchemaField, columnEntries } from './impactRules';
import { TraceController, inBatches } from './traceController';
import { foldLinks } from './traceGraph';
import { ColumnEntry, ColumnLink, ColumnsView, ReaderCounts, TraceSource, TraceState } from './types';

/** Reader counts looked up at once for the changed columns */
const COUNT_CONCURRENCY = 4;

export interface ColumnsInput {
    /** Prod Target the columns and lineage come from */
    table: string;
    /** Prod's schema; undefined when there is no prod table yet */
    prod?: SchemaField[];
    /** The last dry run's schema; undefined when the file hasn't been dry run */
    dev?: SchemaField[];
    /** Shown above the list, e.g. why nothing can be traced */
    message?: string;
}

/** Readers by how they use the column, a dev run and the prod run of one action counted once (see {@link TraceSource.toProd}) */
export function countReaders(found: ColumnLink[], toProd?: (table: string) => string): ReaderCounts {
    const links = foldLinks(found, toProd);
    return {
        copies: links.filter((link) => link.dependencyType === 'EXACT_COPY').length,
        derived: links.filter((link) => link.dependencyType === 'OTHER').length,
        mayRead: links.filter((link) => link.dependencyType === 'TABLE_ONLY').length,
    };
}

/**
 * The column to open on: a changed column when there is one (the cursor's if it is on one, else the top one),
 * otherwise the cursor's column or the top row. Never a new column, which has no lineage.
 */
export function defaultColumn(entries: ColumnEntry[], preferred?: string): string | undefined {
    const traceable = entries.filter((entry) => !entry.isNew);
    const changed = traceable.filter((entry) => entry.change);
    const candidates = changed.length ? changed : traceable;
    return (candidates.find((entry) => entry.column.toLowerCase() === preferred?.toLowerCase()) ?? candidates[0])?.column;
}

/**
 * Drives the column picker above a trace: every column of a table, those changed against prod first with their
 * reader counts. The other columns get no counts; their readers show once one is picked. Keeps one {@link TraceController} per column picked, so
 * going back to a column shows its trace straight away, and carries "show upstream" from one to the next. Has
 * no VS Code dependency, so the extension host and the webview's standalone preview share it.
 */
export class ColumnsController {
    private input: ColumnsInput | undefined;
    private source: TraceSource | undefined;
    private resolveFile: (table: string) => string | undefined = () => undefined;
    private readonly counts = new Map<string, ReaderCounts>();
    private readonly countErrors = new Map<string, string>();
    private readonly traces = new Map<string, TraceController>();
    private selected: string | undefined;
    private upstream = false;
    private view: ColumnsView | null = null;
    private checkedAt: number | undefined;
    /** Bumped per load, so lookups started for an older list are dropped */
    private generation = 0;

    constructor(
        private readonly emitColumns: (view: ColumnsView) => void,
        private readonly emitTrace: (state: TraceState | null) => void,
    ) {}

    get columns(): ColumnsView | null {
        return this.view;
    }

    get trace(): TraceController | undefined {
        return this.selected === undefined ? undefined : this.traces.get(this.selected);
    }

    /** Clears the list while the host works out what to load */
    loading() {
        this.reset();
        this.setView({ status: 'loading', entries: [] });
    }

    fail(message: string) {
        this.reset();
        this.setView({ status: 'error', entries: [], message, checkedAt: Date.now() });
    }

    /**
     * Lists the columns, with counts for the changed ones, then selects one (see {@link defaultColumn}). With `keep`, `preferred` is selected even when other columns changed, e.g. when the
     * list is checked again. Pass a caching source: counts and traces ask the same questions.
     */
    async load(
        input: ColumnsInput,
        source: TraceSource,
        resolveFile: (table: string) => string | undefined = () => undefined,
        preferred?: string,
        keep = false,
    ): Promise<void> {
        const generation = this.reset();
        this.input = input;
        this.source = source;
        this.resolveFile = resolveFile;
        this.checkedAt = Date.now();
        this.setView({ status: 'loading', table: input.table, entries: [] });

        await this.fetchCounts(this.changedColumns(), generation);
        if (generation !== this.generation) {
            return;
        }
        this.publish();
        const entries = this.view?.entries ?? [];
        const kept = keep ? entries.find((entry) => !entry.isNew && entry.column === preferred)?.column : undefined;
        const pick = kept ?? defaultColumn(entries, preferred);
        if (pick) {
            this.select(pick);
        }
    }

    /**
     * Labels the columns against a new dry run, keeping the selection, counts and traces. The first dry run after
     * the list opened unlabelled moves the selection to a changed column, as opening with it would have. With no
     * `dev`, e.g. after a failed dry run, the list goes back to unchecked rather than keeping stale labels.
     */
    async relabel(dev: SchemaField[] | undefined): Promise<void> {
        if (!this.input || this.view?.status !== 'ready') {
            return;
        }
        const generation = this.generation;
        const wasUnchecked = !this.input.dev;
        this.input = { ...this.input, dev };
        this.checkedAt = Date.now();
        await this.fetchCounts(this.changedColumns().filter((column) => !this.counts.has(column)), generation);
        if (generation !== this.generation) {
            return;
        }
        this.publish();
        this.view?.entries.forEach((entry) => this.traces.get(entry.column)?.relabel(entry.change));
        const pick = wasUnchecked && this.view ? defaultColumn(this.view.entries, this.selected) : undefined;
        if (pick && pick !== this.selected) {
            this.select(pick);
        }
    }

    /** Stops every count and trace lookup, e.g. when the panel closes */
    stop() {
        this.reset();
    }

    /** Selects the column the list would open on, for when the panel is shown again for the same file */
    selectDefault(preferred?: string) {
        const pick = this.view?.status === 'ready' ? defaultColumn(this.view.entries, preferred) : undefined;
        if (pick && pick !== this.selected) {
            this.select(pick);
        }
    }

    select(column: string) {
        const entry = this.view?.entries.find((candidate) => candidate.column === column);
        if (!entry || entry.isNew || !this.input || !this.source || !this.view) {
            return;
        }
        if (this.selected !== column) {
            // The column no longer shown stops starting lookups, so they don't queue ahead of this one's
            this.trace?.pause();
        }
        this.selected = column;
        this.setView({ ...this.view, selected: column });

        const cached = this.traces.get(column);
        if (cached?.current) {
            this.emitTrace(cached.current);
            void cached.resume();
            if (cached.current.upstreamShown !== this.upstream) {
                void cached.setUpstream(this.upstream);
            }
            return;
        }
        const trace: TraceController = new TraceController(
            this.source,
            (state) => {
                if (this.traces.get(column) === trace && this.selected === column) {
                    this.emitTrace(state);
                }
            },
            this.resolveFile,
        );
        this.traces.set(column, trace);
        void trace.open({ table: this.input.table, column, change: entry.change });
        if (this.upstream) {
            void trace.setUpstream(true);
        }
    }

    async setUpstream(on: boolean): Promise<void> {
        this.upstream = on;
        await this.trace?.setUpstream(on);
    }

    private reset(): number {
        this.input = undefined;
        this.counts.clear();
        this.countErrors.clear();
        this.traces.forEach((trace) => trace.pause());
        this.traces.clear();
        this.selected = undefined;
        this.emitTrace(null);
        return ++this.generation;
    }

    private get toProd(): ((table: string) => string) | undefined {
        return this.source?.toProd?.bind(this.source);
    }

    private setView(view: ColumnsView) {
        this.view = view;
        this.emitColumns(view);
    }

    private publish() {
        if (!this.input) {
            return;
        }
        const { table, prod, dev, message } = this.input;
        const entries = columnEntries(prod, dev, this.counts).map((entry) => {
            const error = this.countErrors.get(entry.column);
            return error ? { ...entry, countsError: error } : entry;
        });
        this.setView({ status: 'ready', table, entries, selected: this.selected, unchecked: !!prod && !dev, message, checkedAt: this.checkedAt });
    }

    private changedColumns(): string[] {
        return columnEntries(this.input?.prod, this.input?.dev, this.counts).filter((entry) => entry.change).map((entry) => entry.column);
    }

    private async fetchCounts(columns: string[], generation: number): Promise<void> {
        await inBatches(columns, COUNT_CONCURRENCY, async (column) => {
            if (generation !== this.generation || !this.input || !this.source) {
                return;
            }
            try {
                const links = await this.source.links(this.input.table, column, 'downstream');
                if (generation === this.generation) {
                    this.countErrors.delete(column);
                    const counts = countReaders(links, this.toProd);
                    this.counts.set(column, this.source.tableOnlyReaders ? { ...counts, mayRead: undefined } : counts);
                    void this.fetchMayRead(column, links, generation);
                }
            } catch (error: any) {
                if (generation === this.generation) {
                    this.countErrors.set(column, error?.message ?? String(error));
                }
            }
        });
    }

    /** Adds the readers known only at table level to a column's counts once they're found */
    private async fetchMayRead(column: string, links: ColumnLink[], generation: number): Promise<void> {
        const table = this.input?.table;
        if (!table || !this.source?.tableOnlyReaders) {
            return;
        }
        let update: Partial<ReaderCounts>;
        try {
            const readers = await this.source.tableOnlyReaders(table, new Set(links.map((link) => link.table)));
            update = { mayRead: countReaders([...links, ...readers], this.toProd).mayRead };
        } catch (error: any) {
            update = { mayReadError: error?.message ?? String(error) };
        }
        const counts = this.counts.get(column);
        if (generation === this.generation && counts) {
            this.counts.set(column, { ...counts, ...update });
            if (this.view?.status === 'ready') {
                this.publish();
            }
        }
    }
}
