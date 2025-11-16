import { TextDocument } from "vscode";
import { protos } from '@google-cloud/dataform';

export type FileNameMetadataResult<T, E> = { success: true; value: T } | { success: false; error: E };

export type FileNameMetadata = [string, string, string];

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
    actionDescriptor: ActionDescription;
}

export interface ActionDescription {
    description: string;
    columns: Column[]
}

export interface Column {
    path: string[];
    description: string;
}

export interface QueryMeta {
    type: string,
    tableOrViewQuery: string
    nonIncrementalQuery: string
    incrementalQuery: string
    incrementalPreOpsQuery: string
    preOpsQuery: string
    postOpsQuery: string
    assertionQuery: string
    operationsQuery: string
    error: string
}

export interface TablesWtFullQuery {
    tables: Table[];
    queryMeta: QueryMeta
}

export interface Assertion {
    type: string;
    tags: string[];
    fileName: string;
    query: string;
    target: Target;
    canonicalTarget: Target;
    dependencyTargets: Target[];
    preOps?: string[];
    postOps?: string[];
    incrementalQuery?: string;
    incrementalPreOps?: string[];
    bigquery?: TableBigQueryConfig;
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
    defaultLocation: string;
}

export interface Operation {
    type: string;
    query?: string //WARN: this does not adding this to avoid type error :)
    target: Target;
    canonicalTarget: Target;
    queries: string[];
    fileName: string;
    hasOutput: boolean;
    tags: string[];
    dependencyTargets: Target[];
    preOps?: string[];
    postOps?: string[];
    incrementalQuery?: string;
    incrementalPreOps?: string[];
    bigquery?: TableBigQueryConfig;
}

type GraphErrors = {
    compilationErrors: {
        fileName: string,
        message: string,
        stack: string,
    }[]
};

export interface DataformCompiledJson {
    tables: Table[];
    assertions: Assertion[];
    operations: Operation[];
    targets: Target[];
    declarations: Declarations[];
    projectConfig: ProjectConfig;
    graphErrors: GraphErrors;
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

interface BlockMeta {
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

interface ColumnMetadataCore {
    name: string;
    type: string;
    mode?: string;
    description?: string;
}

export interface ColumnMetadata {
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: ColumnMetadataCore[]
};

export interface ErrorLocation {
    line: number;
    column: number;
};

interface DryRunErorr {
    hasError: boolean;
    message: string;
    location?: ErrorLocation;
}

export interface BigQueryDryRunResponse {
    schema: CompiledQuerySchema | undefined;
    location: string | undefined;
    statistics: {
        totalBytesProcessed: number;
        cost?: {
            currency: string
            value: number
        };
        statementType?: string;
        totalBytesProcessedAccuracy?: string;
    };
    error: DryRunErorr
}

export interface CompiledQuerySchema {
    fields: ColumnMetadata[];
}

export type Metadata = {
    type: string,
    description: string,
    fullTableId: string,
};

export type SchemaMetadata = {
    name: string, metadata: Metadata
};

export type CurrentFileMetadata = {
    isDataformWorkspace?: boolean;
    errors?: { errorGettingFileNameFromDocument?: string, dataformCompilationErrors?: GraphError[]; fileNotFoundError?: boolean; queryMetaError?: string | undefined }
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
};

export type TagDryRunStats = {
    type: string;
    targetName: string;
    costOfRunningModel: number;
    currency: SupportedCurrency;
    totalGBProcessed: string;
    totalBytesProcessedAccuracy: string | undefined;
    statementType: string | undefined;
    error: string
};

export type TagDryRunStatsMeta = {
    tagDryRunStatsList?: TagDryRunStats[];
    error?: string;
};

export const supportedCurrencies = {
    USD: "USD",
    EUR: "EUR",
    GBP: "GBP",
    JPY: "JPY",
    CAD: "CAD",
    AUD: "AUD",
    INR: "INR",
} as const;

export type SupportedCurrency = keyof typeof supportedCurrencies;

export type LastModifiedTimeMeta = {
    lastModifiedTime: any,
    modelWasUpdatedToday: boolean | undefined,
    error: {
        message: string | undefined,
    }
}[];


export type DependancyModelMetadata = {
    id: string;
    type: string;
    data: { modelName: string, datasetId: string, projectId: string, tags: string[], fileName: string, datasetColor: string, type: string, isExternalSource: boolean, fullTableName: string };
};

export type ErrorMeta = {
    mainQueryError: DryRunError;
    preOpsError?: DryRunError;
    postOpsError?: DryRunError;
    nonIncrementalError?: DryRunError;
    incrementalError?: DryRunError;
    assertionError?: DryRunError;
};

export type ExecutablePathInfo = {
    path: string | null;
    timestamp: number;
};

export type ExecutablePathCache = Map<string, ExecutablePathInfo>;


export interface WebviewMessage {
}
export interface WebviewMessage {
  tableOrViewQuery?: string;
  assertionQuery?: string;
  preOperations?: string;
  postOperations?: string;
  incrementalPreOpsQuery?: string;
  incrementalQuery?: string;
  nonIncrementalQuery?: string;
  operationsQuery?: string;
  relativeFilePath?: string;
  errorMessage?: string;
  dryRunStat?: any; 
  compiledQuerySchema?: any;
  targetTablesOrViews?: any;
  models?: any; 
  dependents?: any; 
  dataformTags?: string[]; 
  apiUrlLoading?: boolean;
  workflowInvocationUrlGCP?: string;
  errorWorkflowInvocation?: string;
}

export type CreateCompilationResultResponse = Promise<
[
    protos.google.cloud.dataform.v1beta1.ICompilationResult,
    protos.google.cloud.dataform.v1beta1.ICreateCompilationResultRequest | undefined,
    {} | undefined
]
>;


export type InvocationConfig = {
    includedTargets?: Target[];
    includedTags?: string[];
    transitiveDependenciesIncluded: boolean;
    transitiveDependentsIncluded: boolean;
    fullyRefreshIncrementalTablesEnabled: boolean;
    serviceAccount?: string;
};


export type CodeCompilationConfig = {
    assertionSchema: string,  
    databaseSuffix: string,            
    builtinAssertionNamePrefix: string,
    defaultLocation: string,           
    tablePrefix: string,               
    vars: { [k: string]: string; },                      
    schemaSuffix: string,              
    defaultSchema: string,             
    defaultDatabase: string,           
    defaultNotebookRuntimeOption:string
} | {};

export type ICompilationResult  = protos.google.cloud.dataform.v1beta1.ICompilationResult;

export type CompilationType  = "gitBranch" | "workspace";
export type GitStatusCode = "M" | "A" | "??" | "D";
export type GitStatusCodeHumanReadable = "MODIFIED" | "ADDED" | "DELETED";

export interface GitFileChange {
    state: GitStatusCodeHumanReadable;
    path: string;
    fullPath: string;
    commitIndex: number;
}

export interface GitFileChangeRaw {
    state: GitStatusCode;
    path: string;
    fullPath?: string;
    commitIndex: number;
}

export type DataformApiOptions = {gitMeta?:{gitRepoName: string, gitBranch:string}, clientOptions:any};

export type ExecutionMode = "cli" | "api" | "api_workspace";