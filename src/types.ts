import { TextDocument } from "vscode";

export type Result<T, E> = { success: true; value: T } | { success: false; error: E };

export type FileNameResult = [string, string, string];

export interface Table {
    type: string;
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
    canonicalTarget: Target;
    incrementalQuery: string;
    preOps: string[];
    postOps: string[];
    incrementalPreOps: string[];
    dependencyTargets: Target[];
    bigquery: TableBigQueryConfig;
    actionDescriptor:ActionDescription;
}

export interface ActionDescription{
    description: string;
    columns: Column[]
}

export interface Column {
    path: string[];
    description: string;
}

export interface QueryMeta {
    type:string,
    tableOrViewQuery: string
    nonIncrementalQuery: string
    incrementalQuery: string
    incrementalPreOpsQuery: string
    preOpsQuery: string
    postOpsQuery: string
    assertionQuery: string
    operationsQuery: string
}

export interface TablesWtFullQuery {
    tables: Table[];
    queryMeta: QueryMeta
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
    _fileName: string;
    _schema: string;
    _schema_idx: number;
    _tags: string[];
    _deps?: string[];
}

export interface DeclarationsLegendMetadata {
    _schema: string;
    _schema_idx: number;
}

export interface Target {
    database: string; // projectId
    schema: string; // dataset
    name: string; // tableId
}

export interface Declarations {
    target: Target;
    tags: string[]; // WARN: This is not a valid object for Declarations adding this to avoid type errors when using abstractions
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

export interface ConfigBlockMetadata {
    startLine: number;
    endLine: number;
    exists: boolean;
}

interface BlockMeta{
    startLine: number;
    endLine: number;
    exists: boolean;
}

export interface PreOpsBlockMeta {
    preOpsList: BlockMeta[];
}

export interface PostOpsBlockMeta {
    postOpsList: BlockMeta[];
}

export interface SqlxBlockMetadata {
    configBlock: BlockMeta;
    preOpsBlock: PreOpsBlockMeta;
    postOpsBlock: PostOpsBlockMeta;
    sqlBlock: BlockMeta;
    jsBlock: BlockMeta;
}

export interface GitHubContentResponse {
    content: string;
    encoding: string;
}

export interface QueryWtType {
    query: string;
    type: string;
}

export interface TableBigQueryConfig {
    partitionBy: string;
    updatePartitionFilter: string;
    clusterBy: string[];
}

export type GraphError = {
  error: string;
  fileName: string;
};

export interface ColumnMetadata {
    name: string;
    type: string;
    mode?: string;
    description?:string;
};

export interface CompiledQuerySchema {
    fields: ColumnMetadata[]
};

export interface ErrorLocation {
        line: number;
        column: number;
};

export interface BigQueryDryRunResponse {
    schema: CompiledQuerySchema | undefined;
    location: string | undefined;
    statistics: {
        totalBytesProcessed: string; // e.g. "0 GB", "1.234 GB"
    };
    error: {
        hasError: boolean;
        message: string;
        location?: ErrorLocation;
    };
}

export interface CompiledQuerySchema {
    fields:  ColumnMetadata[];
}

export type Metadata = {
    type:string,
    description: string,
    fullTableId: string,
};

export type SchemaMetadata = {
    name: string, metadata: Metadata
};

export type CurrentFileMetadata = {
  isDataformWorkspace?: boolean;
  errors?: { errorGettingFileNameFromDocument:string }
  dataformCompilationErrors?: any[];
  fileMetadata?: TablesWtFullQuery;
  possibleResolutions?: any[];
  dependents?: any;
  lineageMetadata?: {
    dependencies: undefined;
    error: undefined;
  };
  pathMeta?: {
    filename: string;
    extension: string;
    relativeFilePath: string;
  };
  document?: TextDocument;
  fileNotFoundError?: boolean;
};
