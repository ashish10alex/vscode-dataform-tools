// Types shared by the column lineage trace panel's host (extension) and webview.

export type LineageDirection = 'upstream' | 'downstream';

/** How a column was derived from the one it links to. TABLE_ONLY marks a table-level link with no column detail. */
export type DependencyType = 'EXACT_COPY' | 'OTHER' | 'TABLE_ONLY';

/** One hop of lineage as a {@link TraceSource} returns it, seen from the column it was asked about */
export interface ColumnLink {
    /** `project.dataset.table` of the other end */
    table: string;
    /** Undefined when only a table-level link exists, e.g. the reader is an incremental table */
    column?: string;
    dependencyType: DependencyType;
    /** The other end is an assertion, e.g. a built-in uniqueKey or nonNull check */
    assertion?: boolean;
}

export interface TraceSource {
    /** `sample`: a made-up project. `graph`: this project's dependency graph with guessed column links. */
    readonly kind: 'sample' | 'graph' | 'dataplex';
    links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]>;
    /**
     * Readers of `table` known only at table level, leaving out the tables in `linked` (those with a column
     * link). Slower than {@link links}, so asked for after it; sources without it return them from `links`.
     */
    tableOnlyReaders?(table: string, linked: Set<string>): Promise<ColumnLink[]>;
    /**
     * Every reader of `table`, as table-level links: the next hop from a reader known only at table level, which
     * has no column to follow. Sources whose traces never hold such readers can leave it out.
     */
    tableReaders?(table: string): Promise<ColumnLink[]>;
    clearCache?(): void;
}

export type ColumnChange =
    | { kind: 'dropped' }
    | { kind: 'typeChanged'; from: string; to: string };

export interface TraceFocus {
    table: string;
    column: string;
    change?: ColumnChange;
}

export type TraceNodeKind = 'focus' | 'column' | 'tableOnly';

export interface TraceNode {
    id: string;
    table: string;
    column?: string;
    /** 0 for the focus column, negative upstream, positive downstream */
    hop: number;
    kind: TraceNodeKind;
    /**
     * The next hop away from the focus has been fetched. For the focus node this means downstream; for a
     * table-level reader, the tables that read it.
     */
    expanded: boolean;
    loading: boolean;
    /** Workspace-relative `.sqlx` path when the table is an action in this project */
    filePath?: string;
    assertion?: boolean;
    error?: string;
    /** Readers known only at table level are still being looked up, after the column links came in */
    checkingReaders?: boolean;
    /** Looking up the readers known only at table level failed */
    readersError?: string;
}

/** Always points downstream: `source` is read by `target` */
export interface TraceEdge {
    id: string;
    source: string;
    target: string;
    dependencyType: DependencyType;
}

export interface TraceState {
    focus: TraceFocus;
    nodes: TraceNode[];
    edges: TraceEdge[];
    upstreamShown: boolean;
    sourceKind: TraceSource['kind'];
    /** Lineage lookups made since the trace was opened or refreshed */
    lookups: number;
    fetchedAt?: number;
}

/** Readers Dataplex shows for a column, by how they use it */
export interface ReaderCounts {
    /** Readers that copy the column */
    copies: number;
    /** Readers that use it in an expression, filter or join */
    derived: number;
    /** Readers known only at table level. Undefined while they're still being looked up, or when that failed. */
    mayRead?: number;
    /** Looking up the readers known only at table level failed */
    mayReadError?: string;
}

/** One row of the column list */
export interface ColumnEntry {
    /** As prod spells it, or as the dry run does for a new column */
    column: string;
    type?: string;
    /** Set when the dry run drops or retypes the column against prod */
    change?: ColumnChange;
    /** Only the dry run has it, so there is no prod lineage to trace */
    isNew?: boolean;
    /** Undefined until looked up */
    counts?: ReaderCounts;
    /** The lookup for counts failed */
    countsError?: string;
}

export interface ColumnsView {
    status: 'loading' | 'ready' | 'error';
    /** Prod Target the columns and lineage come from */
    table?: string;
    entries: ColumnEntry[];
    selected?: string;
    /** No dry run of the file yet, so changes against prod aren't labelled */
    unchecked?: boolean;
    /** Why there is nothing to trace, or what went wrong */
    message?: string;
    checkedAt?: number;
}

export type HostToViewMessage =
    /** null clears the trace, e.g. while the column list is loading */
    | { type: 'trace'; state: TraceState | null }
    | { type: 'columns'; columns: ColumnsView | null };

export type ViewToHostMessage =
    | { type: 'webviewReady' }
    | { type: 'expand'; nodeId: string }
    | { type: 'setUpstream'; on: boolean }
    | { type: 'refresh' }
    | { type: 'openFile'; nodeId: string }
    | { type: 'expandLevel'; direction: LineageDirection }
    | { type: 'selectColumn'; column: string }
    | { type: 'recheckColumns' };
