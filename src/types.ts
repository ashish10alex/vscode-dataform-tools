import { TextDocument } from "vscode";
import { protos } from '@google-cloud/dataform';
import type { ActionTypeCounts } from './shared/actionTypes';
import type { BuiltInDevEntry, DeferralEntry } from './defer/deferRules';

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
    incrementalPreOpsQuery: string
    preOpsQuery: string
    postOpsQuery: string
    assertionQuery: string
    assertionQueries: AssertionQueryEntry[]
    tableQueries: TableQueryEntry[]
    incrementalQueries: IncrementalQueryEntry[]
    operationQueries: OperationQueryEntry[]
    operationsQuery: string
    testQuery: string
    expectedOutputQuery: string
    testQueries: TestQueryEntry[]
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
    tags: string[]; // Declarations gained tag support in @dataform/core 3.0.52, so this is absent on older compiled output
    canonicalTarget: Target;
    dependencyTargets: Target[]; // WARN: This is not a valid object for Declarations adding this to avoid type errors when using abstractions
    fileName: string;
}

/**
 * PropertyGraph action, added to the compiled graph in @dataform/core 3.0.65.
 * Has no `type` field and no queries: it declares entities and relationships
 * over existing tables rather than producing a query of its own.
 */
export interface PropertyGraph {
    target: Target;
    canonicalTarget: Target;
    dependencyTargets: Target[];
    fileName: string;
    tags: string[];
    description?: string;
    graphBody?: string;
    disabled?: boolean;
    entities?: PropertyGraphEntity[];
    relationships?: PropertyGraphRelationship[];
}

/** A column of the backing table exposed as a graph property. */
export interface PropertyGraphFieldMapping {
    /** Property name as exposed to GQL. */
    name: string;
    /** Column (or expression) on the backing table it maps to. */
    expression: string;
}

export interface PropertyGraphLabel {
    name: string;
    description?: string;
    fields?: PropertyGraphFieldMapping[];
    /** True when the yaml used `fieldWildcard.importAll`, in which case `fields` is absent. */
    importAll?: boolean;
    isDefault?: boolean;
}

export interface PropertyGraphEntity {
    name: string;
    dataSource: Target;
    keys: string[];
    labels: PropertyGraphLabel[];
}

export interface PropertyGraphRelationshipEnd {
    entity: string;
    relationshipColumns: string[];
    entityColumns: string[];
}

export interface PropertyGraphRelationship {
    name: string;
    dataSource: Target;
    keys: string[];
    source: PropertyGraphRelationshipEnd;
    destination: PropertyGraphRelationshipEnd;
    labels: PropertyGraphLabel[];
}

/** Outcome of dry running the synthesised CREATE PROPERTY GRAPH statement. */
export interface PropertyGraphValidation {
    targetName: string;
    /** The exact SQL that was dry run, always surfaced so the check is never a black box. */
    statement: string;
    state: "ok" | "error" | "skipped";
    message?: string;
    /** Line within `graphBody` the error points at, when it could be attributed. */
    graphBodyLine?: number;
    /**
     * True when the failure looks like it is in the wrapper this extension synthesises
     * rather than in the user's graph body.
     */
    harnessError?: boolean;
}

/** Columns read back from BigQuery for an entity/relationship backing table. */
export interface PropertyGraphElementSchema {
    elementName: string;
    fullTableId: string;
    columns: { name: string; type: string; description?: string }[];
    error?: string;
}

export interface ProjectConfig {
    warehouse: string;
    defaultSchema: string;
    assertionSchema: string;
    defaultDatabase: string;
    tablePrefix: string;
    defaultLocation: string;
    vars: { [key: string]: string };
    databaseSuffix?: string;
    schemaSuffix?: string;
    builtinAssertionNamePrefix?: string;
    defaultNotebookRuntimeOptions?: {
        aiPlatformNotebookRuntimeTemplate?: string;
        outputBucket?: string;
    };
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

export type Notebook = {
    target: Target;
    fileName: string;
    canonicalTarget: Target;
    tags: string[];
    notebookContents: string;
    dependencyTargets: Target[]
};

export interface Test {
    name: string;
    testQuery: string;
    expectedOutputQuery: string;
    fileName: string;
}

export interface DataformCompiledJson {
    tables: Table[];
    assertions: Assertion[];
    operations: Operation[];
    targets: Target[];
    declarations: Declarations[];
    projectConfig: ProjectConfig;
    graphErrors: GraphErrors;
    notebooks: Notebook[];
    tests: Test[];
    /** Requires @dataform/core 3.0.65 or later, so absent on older compiled output. */
    propertyGraphs?: PropertyGraph[];
    dataformCoreVersion?: string;
}

export interface DryRunError {
    hasError: boolean;
    message: string;
    location?: {
        line: number;
        column: number;
    };
}

/** Slim error annotation stored on each query entry after dry runs complete. */
export interface DryRunAnnotation {
    message: string;
    location?: {
        line: number;
        column: number;
    };
}

export interface TableQueryEntry {
    targetName: string;
    query: string;
    preOpsQuery: string;
    dryRunQuery?: string;
    error?: DryRunAnnotation;
}

export interface IncrementalQueryEntry {
    targetName: string;
    incrementalQuery: string;
    nonIncrementalQuery: string;
    preOpsQuery: string;
    incrementalPreOpsQuery: string;
    dryRunIncrementalQuery?: string;
    dryRunNonIncrementalQuery?: string;
    incrementalError?: DryRunAnnotation;
    nonIncrementalError?: DryRunAnnotation;
}

export interface AssertionQueryEntry {
    targetName: string;
    query: string;
    dryRunQuery?: string;
    error?: DryRunAnnotation;
}

export interface OperationQueryEntry {
    targetName: string;
    query: string;
    preOpsQuery: string;
    dryRunQuery?: string;
    error?: DryRunAnnotation;
}

export interface TestQueryEntry {
    name: string;
    testQuery: string;
    expectedOutputQuery: string;
    testError?: DryRunAnnotation;
    expectedOutputError?: DryRunAnnotation;
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
    stack?: string;
};

export interface ColumnMetadata {
    name: string;
    type: string;
    mode?: string;
    description?: string;
    fields?: ColumnMetadata[]
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
    schema?: CompiledQuerySchema | undefined;
    location?: string | undefined;
    statistics?: {
        totalBytesProcessed: number;
        cost?: {
            currency: string
            value: number
        };
        statementType?: string;
        totalBytesProcessedAccuracy?: string;
        /**
         * BigQuery could not compute bytes statically (totalBytesProcessedAccuracy === "UNKNOWN"),
         * so it reports totalBytesProcessed as 0. The query still scans data when executed, so
         * treat 0 bytes / 0 cost as "no estimate available" rather than as a real zero.
         */
        bytesEstimateUnknown?: boolean;
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

/** Whether defer to prod is switched on for the workspace, and whether it can be applied */
export interface DeferToProdState {
    enabled: boolean;
    available: boolean;
    /** Why it cannot be applied, when it is not available */
    reason?: string;
}

/** What the compiled query panel shows about defer to prod for the current file: its upstream tables, or why looking them up failed */
export type DeferralView = {
    status: "ready";
    entries: {
        /** `database.schema.name` */
        dev: string;
        prod?: string;
        status: DeferralEntry["status"];
        stale?: boolean;
    }[];
    /** Upstream tables read from dev because they are built there */
    builtInDev?: {
        /** `database.schema.name` */
        dev: string;
        /** Epoch ms */
        lastModified?: number;
    }[];
} | {
    status: "error";
    message: string;
};

export type CurrentFileMetadata = {
    isDataformWorkspace?: boolean;
    errors?: { errorGettingFileNameFromDocument?: string, dataformCompilationErrors?: GraphError[]; fileNotFoundError?: boolean; queryMetaError?: string | undefined }
    fileMetadata?: TablesWtFullQuery;
    /** Set when defer to prod is on: which upstream actions the queries in `fileMetadata` read from prod */
    deferral?: { entries: DeferralEntry[], builtInDev?: BuiltInDevEntry[] };
    /** Set when defer to prod is on but looking up the upstream tables failed, e.g. the prod compile failed */
    deferralError?: string;
    /** With defer to prod off: upstream tables that are still Proxy Views, so they read prod anyway */
    leftoverProxies?: string[];
    /** The defer to prod lookup still running; `fileMetadata` has the deferral applied once it resolves */
    deferralPending?: Promise<Pick<CurrentFileMetadata, "deferral" | "deferralError" | "leftoverProxies">>;
    possibleResolutions?: any[];
    dependents?: any;
    lineageMetadata?: {
        dependencies: string[] | undefined;
        error: any;
    } | undefined | null;
    pathMeta?: {
        filename: string;
        extension: string;
        relativeFilePath: string;
    };
    document?: TextDocument;
    compilationTimeMs?: number;
    projectConfig?: ProjectConfig;
    dataformCoreVersion?: string;
    packageJsonContent?: {
        name?: string;
        dependencies?: { [key: string]: string };
        devDependencies?: { [key: string]: string };
    } | null;
};

export type TagDryRunStats = {
    type: string;
    targetName: string;
    schema: string;
    /** undefined when BigQuery could not estimate bytes (accuracy UNKNOWN). */
    costOfRunningModel: number | undefined;
    currency: SupportedCurrency;
    /** undefined when BigQuery could not estimate bytes (accuracy UNKNOWN). */
    totalGBProcessed: string | undefined;
    totalBytesProcessedAccuracy: string | undefined;
    statementType: string | undefined;
    bytesEstimateUnknown?: boolean;
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
  
export enum CompilationErrorType {
    NONE = "NONE",
    COMPILATION_ERROR = "COMPILATION_ERROR",
    MISSING_EXECUTABLE = "MISSING_EXECUTABLE",
    FILE_NOT_FOUND = "FILE_NOT_FOUND",
    NOT_A_DATAFORM_WORKSPACE = "NOT_A_DATAFORM_WORKSPACE",
    UNSUPPORTED_FILE_TYPE = "UNSUPPORTED_FILE_TYPE",
    QUERY_META_ERROR = "QUERY_META_ERROR"
}

export type LastModifiedTimeMeta = {
    lastModifiedTime: string | undefined;
    modelWasUpdatedToday: boolean | undefined;
    error: {
        message: string | undefined;
    }
}[];

export type DependancyModelMetadata = {
    id: string;
    type: string;
    data: { modelName: string, datasetId: string, projectId: string, tags: string[], fileName: string, datasetColor: string, type: string, isExternalSource: boolean, isAssertion: boolean, fullTableName: string };
};

export type ErrorMeta = {
    mainQueryError: DryRunError;
    preOpsError?: DryRunError;
    postOpsError?: DryRunError;
    nonIncrementalError?: DryRunError;
    incrementalError?: DryRunError;
    assertionError?: DryRunError;
    testError?: DryRunError;
    expectedOutputError?: DryRunError;
};

/** Which step of the lookup found an executable */
export type ExecutableSource = 'setting' | 'projectLocal' | 'path' | 'commonLocation';

export type ExecutablePathInfo = {
    path: string | null;
    /** Undefined when it was not found */
    foundBy?: ExecutableSource;
    timestamp: number;
};

export type ExecutablePathCache = Map<string, ExecutablePathInfo>;

export interface WorkflowUrlEntry {
    url: string;
    timestamp: number;
    workspace: string;
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
    executionMode?: 'api' | 'api_workspace';
    workflowInvocationId?: string;
    projectId?: string;
    location?: string;
    repositoryName?: string;
    state?: string;
    failedActions?: FailedAction[];
    actions?: WorkflowAction[];
    actionCounts?: ActionCounts;
    /** Totals over the actions' BigQuery jobs, once their stats have been loaded */
    jobStatsSummary?: WorkflowActionJobStats;
    /** Epoch ms bounds of the whole invocation, from the Dataform API; `invocationEndTime` is set once it finishes */
    invocationStartTime?: number;
    invocationEndTime?: number;
    includedTags?: string[];
    includedTargets?: Target[];
    /** `includedTargets` counted by action type when the run was dispatched; absent on older entries */
    includedTargetTypes?: ActionTypeCounts;
}

export interface FailedAction {
    target: string;
    failureReason: string;
}

export interface WorkflowAction {
    target: string;
    state: string;
    failureReason?: string;
    /** ID of the BigQuery job that ran the action, once it has started */
    jobId?: string;
    jobStats?: WorkflowActionJobStats;
    /** Epoch ms the Dataform action started, used for the elapsed time while it is running */
    startTime?: number;
}

/** Stats of the BigQuery job behind a workflow action; the labels are preformatted for the webview. */
export interface WorkflowActionJobStats {
    location?: string;
    totalBytesBilled?: number;
    totalBytesProcessed?: number;
    /** Epoch ms bounds of the job; a script job's cover its child jobs */
    startTime?: number;
    endTime?: number;
    durationMs?: number;
    /** Includes the slot time of a script job's child jobs */
    totalSlotMs?: number;
    cost?: number;
    bytesBilledLabel?: string;
    costLabel?: string;
    error?: string;
}

export interface ActionCounts {
    total: number;
    pending: number;
    running: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    skipped: number;
}

export interface WebviewMessage {
  snoozeEndTime?: number | null;
  tableOrViewQuery?: string;
  assertionQuery?: string;
  preOperations?: string;
  postOperations?: string;
  incrementalPreOpsQuery?: string;
  incrementalQuery?: string;
  nonIncrementalQuery?: string;
  operationsQuery?: string;
  testQuery?: string;
  expectedOutputQuery?: string;
  actionTypes?: string[];
  relativeFilePath?: string;
  errorMessage?: string | null;
  errorType?: CompilationErrorType;
  compilationErrors?: Array<{
    error: string;
    fileName: string;
    lineNumber?: number;
    sourceContext?: string;
  }> | null;
  possibleResolutions?: string[] | null;
  dryRunErrorsByNodeType?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunErrorsByNodeName?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunIncrementalErrorsByNodeName?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunIncrementalErrorsByNodeType?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunExpectedOutputErrorsByNodeName?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunExpectedOutputErrorsByNodeType?: Record<string, { message: string; location?: { line: number; column: number } }>;
  dryRunQueryByNodeName?: Record<string, string>;
  dryRunIncrementalQueryByNodeName?: Record<string, string>;
  dryRunNonIncrementalQueryByNodeName?: Record<string, string>;
  compiledQuerySchema?: any;
  targetTablesOrViews?: any;
  models?: any; 
  dependents?: any; 
  dataformTags?: string[]; 
  apiUrlLoading?: boolean;
  workflowInvocationUrlGCP?: string;
  errorWorkflowInvocation?: string;
  recompiling?: boolean;
  compilationBackend?: "cli" | "api";
  dryRunning?: boolean;
  modelsLastUpdateTimesMeta?: LastModifiedTimeMeta;
  declarations?: Declarations[] | null;
  compilerOptions?: string;
  workflowUrls?: WorkflowUrlEntry[];
  missingExecutables?: string[];
  projectConfig?: ProjectConfig;
  dataformCoreVersion?: string;
  packageJsonContent?: {
    name?: string;
    dependencies?: { [key: string]: string };
    devDependencies?: { [key: string]: string };
  };
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
    defaultNotebookRuntimeOptions?: {
        aiPlatformNotebookRuntimeTemplate?: string;
        outputBucket?: string;
    }
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

export type LastRunKind = 'currentFile' | 'files' | 'tags' | 'changed';

/** The selection and options of the most recent Dataform run, kept so it can be repeated. */
export interface LastRunRequest {
    kind: LastRunKind;
    /**
     * Workspace-relative .sqlx paths for `currentFile` / `files`, tag names for `tags`, and for `changed`
     * the actions that ran (informational only: a rerun recomputes them).
     */
    items: string[];
    /** `changed`: the files whose changes ran, when some changed files were left out; a rerun keeps to them. Absent when every changed file ran. */
    files?: string[];
    /** `changed` with `files`: how many files had changes when it ran. */
    changedFileCount?: number;
    /** `changed` with `files`: how many of `files` had changes when it ran; a rerun keeps `files` whole even after some lose their changes. Absent on runs recorded before it was kept. */
    selectedFileCount?: number;
    /** `changed`: the ref the changes were computed against, e.g. `origin/main`. */
    baseRef?: string;
    /** `changed`: the branch whose changes ran, e.g. `feat/orders`; absent on runs recorded before it was kept. */
    headRef?: string;
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
    executionMode: ExecutionMode;
    /** Upstream tables not built in dev were read from prod; a rerun does the same. Absent on runs recorded before defer to prod. */
    deferToProd?: boolean;
    /** Absolute path of the Dataform folder the run used; `items` are relative to it. */
    workspaceFolder: string;
    timestamp: number;
}

/** "Run changed" state rendered by the compiled query webview. */
export interface ChangedActionsView {
    /** idle: in a git repo but nothing computed yet; unavailable: not a git repo */
    status: 'idle' | 'computing' | 'ready' | 'error' | 'unavailable';
    /** e.g. `origin/main` */
    baseRef?: string;
    mergeBaseSha?: string;
    /** What the base was compared with: the working tree, or the pushed commit in remote mode */
    headLabel?: string;
    /** The branch being compared, e.g. `feat/orders` (its upstream in remote mode), or a short SHA on a detached HEAD */
    headRef?: string;
    /** The `defaultBranch` setting, e.g. `main` */
    defaultBranch?: string;
    /** The checked-out branch is the one being compared against, so only local edits can show up */
    onDefaultBranch?: boolean;
    changed?: { target: string; fileName: string; type: string; reasons: ('new' | 'sql' | 'config')[] }[];
    deleted?: { target: string; fileName: string; type: string }[];
    error?: string;
}

/** Summary of the last run as rendered by the compiled query webview. */
export interface LastRunView {
    label: string;
    detail: string;
    timestamp: number;
    fullRefresh: boolean;
    /** Mode a rerun would use, which can differ from the recorded one in remote mode. */
    executionMode: ExecutionMode;
}

export interface CachedResults {
    fileMetadata: any;
    curFileMeta: any;
    targetTablesOrViews: any;
    errorMessage: string | null;
    dryRunStatByNodeType: Record<string, string>;
    dryRunStatByNodeName: Record<string, string>;
    dryRunErrorsByNodeType: Record<string, { message: string; location?: ErrorLocation }>;
    dryRunIncrementalErrorsByNodeType: Record<string, { message: string; location?: ErrorLocation }>;
    dryRunExpectedOutputErrorsByNodeType: Record<string, { message: string; location?: ErrorLocation }>;
    dryRunExpectedOutputErrorsByNodeName?: Record<string, { message: string; location?: ErrorLocation }>;
    location: string | undefined;
    compilerOptions: string | undefined;
}