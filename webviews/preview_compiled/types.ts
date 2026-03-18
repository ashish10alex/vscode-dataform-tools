import { CompilationErrorType } from "../../src/types";
import type { WorkflowUrlEntry, ProjectConfig, BigQueryDryRunResponse } from "../../src/types";
export { CompilationErrorType };
export type { WorkflowUrlEntry, ProjectConfig, BigQueryDryRunResponse };

export interface LastModifiedTimeMetaItem {
  lastModifiedTime: string | undefined;
  modelWasUpdatedToday: boolean | undefined;
  error: { message: string | undefined };
}

export interface WebviewState {
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
  errorMessage?: string;
  errorType?: CompilationErrorType;
  workspaceFolder?: string;
  dryRunStat?: string;
  modelType?: string;
  actionTypes?: string[];
  workflowInvocationUrlGCP?: string;
  errorWorkflowInvocation?: string;
  apiUrlLoading?: boolean;
  recompiling?: boolean;
  dryRunning?: boolean;
  compilationTimeMs?: number;
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
    fields: {
      name: string;
      type: string;
      description?: string;
      mode?: string;
    }[];
  };
  tagDryRunStatsMeta?: {
      tagDryRunStatsList?: any[];
      error?: { message: string };
  };
  compilerOptions?: string;
  workflowUrls?: WorkflowUrlEntry[];
  missingExecutables?: string[];
  dataformCoreVersion?: string;
  projectConfig?: ProjectConfig;
  packageJsonContent?: {
    name?: string;
    dependencies?: { [key: string]: string };
    devDependencies?: { [key: string]: string };
  };
  isHelperFile?: boolean;
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
