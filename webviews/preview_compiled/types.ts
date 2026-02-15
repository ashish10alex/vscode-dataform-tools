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
  modelsLastUpdateTimesMeta?: any[];
  declarationsHtml?: string;
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
}

export interface VSCodeMessage {
  command: string;
  value?: any;
}
