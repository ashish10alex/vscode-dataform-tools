import { CompilationErrorType } from "../../src/types";
import type { ColumnMetadata, WorkflowUrlEntry, FailedAction, WorkflowAction, ActionCounts, ProjectConfig, BigQueryDryRunResponse, LastRunView, ExecutionMode, ChangedActionsView, DeferralView, DeferToProdState } from "../../src/types";
import type { PropertyGraph, PropertyGraphValidation, PropertyGraphElementSchema } from "../../src/types";
export { CompilationErrorType };
export type { ColumnMetadata, WorkflowUrlEntry, FailedAction, WorkflowAction, ActionCounts, ProjectConfig, BigQueryDryRunResponse, LastRunView, ExecutionMode, ChangedActionsView, DeferralView, DeferToProdState };
export type { PropertyGraph, PropertyGraphValidation, PropertyGraphElementSchema };
import type { CompilationInfo } from "../../src/utils/compilationInfo";
export type { CompilationInfo };
import type { ApiRunGitState } from "../../src/shared/apiRunGitState";
export type { ApiRunGitState };

export interface LastModifiedTimeMetaItem {
  lastModifiedTime: string | undefined;
  modelWasUpdatedToday: boolean | undefined;
  error: { message: string | undefined };
}

export interface DryRunErrorAnnotation {
  message: string;
  location?: { line: number; column: number };
}

export interface WebviewState {
  snoozeEndTime?: number | null;
  /** Null when defer to prod is off */
  deferral?: DeferralView | null;
  deferToProd?: DeferToProdState;
  /** With defer to prod off: upstream tables still read from prod through leftover proxy views */
  leftoverProxies?: string[] | null;
  preOperations?: string;
  postOperations?: string;
  tableOrViewQuery?: string;
  assertionQuery?: string;
  incrementalPreOpsQuery?: string;
  incrementalQuery?: string;
  nonIncrementalQuery?: string;
  operationsQuery?: string;
  testQuery?: string;
  expectedOutputQuery?: string;
  testDryRunResult?: BigQueryDryRunResponse;
  expectedOutputDryRunResult?: BigQueryDryRunResponse;
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
  workspaceFolder?: string;
  dryRunStatByNodeType?: Record<string, string>;
  dryRunStatByNodeName?: Record<string, string>;
  dryRunErrorsByNodeType?: Record<string, DryRunErrorAnnotation>;
  dryRunErrorsByNodeName?: Record<string, DryRunErrorAnnotation>;
  dryRunIncrementalErrorsByNodeName?: Record<string, DryRunErrorAnnotation>;
  dryRunIncrementalErrorsByNodeType?: Record<string, DryRunErrorAnnotation>;
  dryRunExpectedOutputErrorsByNodeName?: Record<string, DryRunErrorAnnotation>;
  dryRunExpectedOutputErrorsByNodeType?: Record<string, DryRunErrorAnnotation>;
  dryRunQueryByNodeName?: Record<string, string>;
  dryRunIncrementalQueryByNodeName?: Record<string, string>;
  dryRunNonIncrementalQueryByNodeName?: Record<string, string>;
  modelType?: string;
  actionTypes?: string[];
  workflowInvocationUrlGCP?: string;
  errorWorkflowInvocation?: string;
  apiUrlLoading?: boolean;
  recompiling?: boolean;
  compilationBackend?: "cli" | "api";
  dryRunning?: boolean;
  compilationTimeMs?: number;
  compilationInfo?: CompilationInfo;
  dataformTags?: string[];
  selectedTags?: string[];
  currencySymbol?: string;
  dependents?: any[]; // Replace with specific type if available
  models?: any[]; // Replace with specific type
  lineageMetadata?: any;
  modelsLastUpdateTimesMeta?: LastModifiedTimeMetaItem[];
  declarations?: Declarations[] | null;
  targetTablesOrViews?: any[];
  compiledQuerySchema?: {
    fields: ColumnMetadata[];
  };
  tagDryRunStatsMeta?: {
      tagDryRunStatsList?: any[];
      error?: string;
  };
  compilerOptions?: string;
  workflowUrls?: WorkflowUrlEntry[];
  lastRun?: LastRunView | null;
  /** Columns the last dry run drops or retypes against prod, for the column lineage button */
  columnImpact?: { relativeFilePath: string; changed?: number };
  changedActions?: ChangedActionsView;
  /** What a run through the Dataform API leaves out, since it runs the branch as pushed */
  apiRunGitState?: ApiRunGitState;
  missingExecutables?: string[];
  dataformCoreVersion?: string;
  projectConfig?: ProjectConfig;
  packageJsonContent?: {
    name?: string;
    dependencies?: { [key: string]: string };
    devDependencies?: { [key: string]: string };
  };
  isHelperFile?: boolean;
  propertyGraphs?: PropertyGraph[] | null;
  propertyGraphValidations?: PropertyGraphValidation[] | null;
  /** Keyed by `<graph target>::<element name>`, filled in lazily as elements are expanded. */
  propertyGraphElementSchemas?: Record<string, PropertyGraphElementSchema>;
}

export interface Target {
    database: string;
    schema: string;
    name: string;
}

export interface Declarations {
    target: Target;
    tags: string[];
    canonicalTarget: Target;
    dependencyTargets: Target[];
    fileName: string;
}

export interface VSCodeMessage {
  command: string;
  value?: any;
}
