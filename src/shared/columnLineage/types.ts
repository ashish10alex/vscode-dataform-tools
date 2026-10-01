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
}

export interface TraceSource {
    /** `sample`: a made-up project. `graph`: this project's dependency graph with guessed column links. */
    readonly kind: 'sample' | 'graph' | 'dataplex';
    links(table: string, column: string, direction: LineageDirection): Promise<ColumnLink[]>;
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
    /** The next hop away from the focus has been fetched. For the focus node this means downstream. */
    expanded: boolean;
    loading: boolean;
    /** Workspace-relative `.sqlx` path when the table is an action in this project */
    filePath?: string;
    error?: string;
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

/** One column that changed against prod, with what Dataplex shows still reads it */
export interface ImpactEntry {
    column: string;
    change: ColumnChange;
    /** Readers that copy the column */
    copies: number;
    /** Readers that use it in an expression, filter or join */
    derived: number;
    /** Readers known only at table level */
    mayRead: number;
}

export interface ImpactView {
    status: 'loading' | 'ready' | 'error';
    /** Prod Target the dry run was compared with */
    table?: string;
    entries: ImpactEntry[];
    selected?: string;
    /** Why there is nothing to list, or what went wrong */
    message?: string;
    checkedAt?: number;
}

export type HostToViewMessage =
    /** null clears the trace, e.g. while an impact check has nothing to trace */
    | { type: 'trace'; state: TraceState | null }
    | { type: 'impact'; impact: ImpactView | null };

export type ViewToHostMessage =
    | { type: 'webviewReady' }
    | { type: 'expand'; nodeId: string }
    | { type: 'setUpstream'; on: boolean }
    | { type: 'refresh' }
    | { type: 'openFile'; nodeId: string }
    | { type: 'selectImpact'; column: string }
    | { type: 'recheckImpact' };
