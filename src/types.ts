
export interface Table {
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
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
}

interface Target {
    database: string;
    schema: string;
    name: string;
}

interface Declarations{
    target: Target
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

