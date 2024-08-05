
export interface Table {
    type: string;
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
    canonicalTarget: Target;
    incrementalQuery: string;
    incrementalPreOps: string[];
    dependencyTargets: Target[];
}

export interface TablesWtFullQuery {
    tables: Table[];
    fullQuery: string;
}

export interface Assertion {
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
    canonicalTarget: Target;
    dependencyTargets: Target[];
}

export interface DependancyTreeMetadata {
    _name: string;
    _schema: string;
    _schema_idx: number;
    _deps?: string[];
}


export interface DeclarationsLegendMetadata {
    _schema: string;
    _schema_idx: number;
}


export interface Target {
    database: string;
    schema: string;
    name: string;
}

export interface Declarations {
    target: Target;
    canonicalTarget: Target;
    dependencyTargets: Target[]; // WARN: This is not a valid object for Declarations adding this to avoid type errors when using abstractions
    fileName: string;
}

interface ProjectConfig {
    warehouse: string;
    defaultSchema: string;
    assertionSchema: string;
    defaultDatabase: string;
    tablePrefix: string;
    defualtLocation: string;
}

export interface Operation {
    target: Target;
    canonicalTarget: Target;
    queries: string[];
    fileName: string;
    hasOutput: boolean;
    tags: string[];
    dependencyTargets: Target[];
}

export interface DataformCompiledJson {
    tables: Table[];
    assertions: Assertion[];
    operations: Operation[];
    targets: Target[];
    declarations: Declarations[];
    projectConfig: ProjectConfig;
}

export interface DryRunError {
    hasError: boolean;
    message: string;
    location?: {
        line: number;
        column: number;
    };
}


export interface BigQueryDryRunResponse {
    statistics: {
        totalBytesProcessed: string;
    };
    error: DryRunError;
}

export interface ConfigBlockMetadata {
    startLine: number;
    endLine: number;
}

