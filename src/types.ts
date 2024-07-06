
export interface Table {
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
}

interface Assertion {
    tags: string[];
}

interface Target {
    database: string;
    schema: string;
    name: string;
}

export interface DataformCompiledJson {
    tables: Table[];
    assertions: Assertion[];
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

