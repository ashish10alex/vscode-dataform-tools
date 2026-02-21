export interface LastModifiedTimeMetaItem {
  lastModifiedTime?: string;
  modelWasUpdatedToday?: boolean;
  error?: { message?: string };
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
  relativeFilePath?: string;
  errorMessage?: string;
  dryRunStat?: string;
  modelType?: string;
  workflowInvocationUrlGCP?: string;
  errorWorkflowInvocation?: string;
  apiUrlLoading?: boolean;
  recompiling?: boolean;
  dryRunning?: boolean;
  dataformTags?: string[];
  selectedTag?: string;
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
  workflowUrls?: {
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
  }[];
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
