
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

export interface TablesWtFullQuery{
    tables: Table[];
    fullQuery: string;
}

interface Assertion {
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

interface Declarations{
    target: Target;
    fileName: string;
}

export interface DataformCompiledJson {
    tables: Table[];
    assertions: Assertion[];
    targets: Target[];
    declarations: Declarations[];
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

