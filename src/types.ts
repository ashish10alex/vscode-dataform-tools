
export interface Table {
    type: string;
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
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
    dependencyTargets: Target[];
}

interface Target {
    database: string;
    schema: string;
    name: string;
}

export interface Declarations {
    target: Target;
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

export interface Operation{
    target: Target;
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

