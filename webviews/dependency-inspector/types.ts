export interface ModelInfo {
    fullId: string;  // "project.dataset.name"
    name: string;
    type: string;
}

export interface DependencyInfo {
    fullId: string;
    name: string;
    type: string;
    depth: number;  // 1 = direct dependency, 2 = dep-of-dep, etc.
}

export interface GraphEdge {
    source: string;  // parent fullId
    target: string;  // dependency fullId
}

export interface DependencyRow {
    id: string;           // same as fullTableId, used as React key
    fullTableId: string;
    filterCondition: string;
    enabled: boolean;           // whether this row is included in bulk runs
    isSelectedModel?: boolean;  // true for the model itself (first row)
    depth: number;              // 0 for selected model, 1+ for dependencies
}

export type ResultStatus =
    | 'idle'
    | 'dry-run-loading'
    | 'dry-run-success'
    | 'dry-run-error'
    | 'query-loading'
    | 'query-success'
    | 'query-error';

export interface ModelResult {
    status: ResultStatus;
    query?: string;
    // Dry run stats
    bytes?: string;
    cost?: string;
    // Query results
    results?: any[];
    columns?: any[];
    jobStats?: any;
    error?: string;
}
