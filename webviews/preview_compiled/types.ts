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

import type { PanelSlices } from "../../src/shared/panelState";

/** What the panel knows: the slices the host has sent (see src/shared/panelState.ts) */
export type PanelState = PanelSlices;

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
