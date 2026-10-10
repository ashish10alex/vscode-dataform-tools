import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { CompilationErrorType, ExecutionMode, Target, PanelState, WorkflowUrlEntry } from "../types";
import { previewSection, targetId } from "../../../src/shared/compiledGraph";
import { vscode } from "../utils/vscode";
import { LatestRunBanner } from "./LatestRunBanner";
import { LastRunCard, formatAgo, useRerun } from "./LastRunCard";
import { CompilationInfoBadge, CompileModeToken, useNow } from "./CompilationInfoBadge";
import { CompilationError } from "./CompilationError";
import { CancelWorkflowButton } from "./CancelWorkflowButton";
import { SHOW_RUN_DETAILS_EVENT } from "./RunStatusPill";
import { clock, runVia } from "./RunStages";
import { workflowDurationMs, useTick } from "./WorkflowActionsTable";
import { LineageColumns } from "./LineageColumns";
import { ROW_BUTTON, RowChip, RowTone, SummaryRow } from "./SummaryRow";
import { FULL_REFRESH_RING, RUN_GROUP, RUN_MAIN_PART, RUN_PART, RunModifiers, RunRow, TagRunPart } from "./RunParts";
import { SqlBlock, SqlTabs, shownSqlBlock, sqlTabLabels } from "./SqlTabs";
import { CopyTableIdButton, DryRunResult, KindBadge, TargetAction, TargetRow } from "./TargetRow";
import { RunChangedButton } from "./RunChangedButton";
import { API_COLOR, RunBackend, RunBackendSwitch } from "./RunBackendSwitch";
import { ApiRunGitChip } from "./ApiRunGitChip";
import { ModifierSwitch } from "./ModifierSwitch";
import { DeferralBanner, deferralSummary, SWITCH_TITLE as DEFER_SWITCH_TITLE } from "./DeferralBanner";
import {
  Play,
  Cloud,
  Network,
  GitCompareArrows,
  ListTree,
  Eye,
  ShieldCheck,
  Wand2,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { tableActions } from "../../../src/shared/columnLineage/tableActions";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import { describeBuiltInAssertion } from "../../../src/shared/builtInAssertions";
import { CompilerOverrides, overrideLabels } from "./CompilerOverrides";
import { PropertyGraphSection } from "./PropertyGraphSection";
import { panelProblem } from "../utils/panelProblem";
import { fileView } from "../utils/fileView";
import { onlyAvailable } from "../utils/runTags";
import { fileOnShow } from "../../../src/shared/panelState";
import { ProjectLabel } from "./ProjectLabel";
import { bigQueryView } from "../utils/bigQueryView";
import { compilationInfoParts, compilationInfoTooltip } from "../utils/compilationInfoFormat";
import { TERMINAL_WORKFLOW_STATES } from "../utils/workflowPolling";
import { describeApiRunGitState } from "../../../src/shared/apiRunGitState";
import { runProgress } from "../../../src/shared/cliRunJobs";
import { runStage } from "../../../src/shared/runStages";
import { formatDuration } from "../../../src/shared/jobTiming";

/**
 * The run buttons while their runs go through the Dataform API: in the colour the switch has for it, so where a run
 * goes is seen on the button that starts it. The solid one is darkened, for its text to be read on it in a dark theme.
 */
const API_RUN_COLORS = {
  "--run-tint": API_COLOR,
  "--run-solid": `color-mix(in srgb, ${API_COLOR} 70%, black)`,
  "--run-solid-hover": `color-mix(in srgb, ${API_COLOR} 84%, black)`,
} as React.CSSProperties;
/** The run buttons' own colours, for the one that does not follow the switch */
const CLI_RUN_COLORS = {
  "--run-tint": "var(--vscode-button-background)",
  "--run-solid": "var(--vscode-button-background)",
  "--run-solid-hover": "var(--vscode-button-hoverBackground)",
} as React.CSSProperties;
interface CompiledQueryTabProps {
  state: PanelState;
}

export const CompiledQueryTab: React.FC<CompiledQueryTabProps> = ({
  state,
}) => {
  const { compiling, message: problemMessage, type: problemType, compileErrors } = panelProblem(state);
  const view = fileView(state.file);
  const fileName = fileOnShow(state);
  const bq = bigQueryView(state);
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [runningModel, setRunningModel] = useState(false);
  const [submittingSince, setSubmittingSince] = useState<number | null>(null);

  useEffect(() => {
    if (submittingSince === null) { return; }
    const newer = (state.dataform.workflowUrls || []).some(i => i.timestamp > submittingSince);
    if (newer) { setSubmittingSince(null); return; }
    const timeoutId = setTimeout(() => setSubmittingSince(null), 30000);
    return () => clearTimeout(timeoutId);
  }, [state.dataform.workflowUrls, submittingSince]);
  // API reruns keep showing progress in the latest run banner until the workflow invocation appears.
  const handleRerunDispatched = useCallback((executionMode: ExecutionMode) => {
    if (executionMode !== "cli") { setSubmittingSince(Date.now()); }
  }, []);
  const [formatting, setFormatting] = useState(false);
  const [loadingLineage, setLoadingLineage] = useState(false);
  const [selectedTagsForRun, setSelectedTagsForRun] = useState<string[]>(state.dataform.tagCostEstimate?.tags || []);
  // The tags of a cost estimate become the tags chosen for a run
  const estimatedTags = state.dataform.tagCostEstimate?.tags;
  useEffect(() => {
    if (estimatedTags) {
      setSelectedTagsForRun(onlyAvailable(estimatedTags, state.project?.tags ?? []));
    }
  }, [estimatedTags]);

  // A tag the Project no longer has cannot be run. Keyed on the tags themselves: what was chosen stays through a
  // save that changes none of them
  const availableTags = (state.project?.tags ?? []).join("\n");
  useEffect(() => {
    setSelectedTagsForRun((chosen) => onlyAvailable(chosen, availableTags === "" ? [] : availableTags.split("\n")));
  }, [availableTags]);

  /** The query on show, by its key. The first one when none was chosen, or the one chosen is of another file */
  const [sqlTab, setSqlTab] = useState<string | null>(null);

  const localDependentIds = new Set(
    view.dependents?.map((d: any) =>
      typeof d === "string" ? d : `${d.database}.${d.schema}.${d.name}`
    ) || []
  );

  const handleRunModel = (api: boolean) => {
    setRunningModel(true);
    // The file's actions that have a Target: all but its unit tests, which a run does not execute
    const actions: Target[] = (view.models ?? []).map((action: { target?: Target }) => action.target).filter((target): target is Target => !!target);
    const scope = { includeDependents, includeDependencies, fullRefresh };
    vscode.postMessage(api ? { command: "dataform.runApi", actions, workspace: false, ...scope } : { command: "run", actions, ...scope });
    setTimeout(() => setRunningModel(false), api ? 3000 : 10000);
  };

  // Remote mode compiles and runs through the Dataform API, so CLI-only actions are hidden
  const isRemoteMode = state.dataform.compilationInfo?.mode === "api";
  // The Project's, kept by the host. It flips at once on click instead of waiting for the host to say it back
  const [preferredBackend, setPreferredBackendHere] = useState<RunBackend>(state.dataform.runBackend ?? "cli");
  useEffect(() => setPreferredBackendHere(state.dataform.runBackend ?? "cli"), [state.dataform.runBackend]);
  const setPreferredBackend = (backend: RunBackend) => {
    setPreferredBackendHere(backend);
    vscode.postMessage({ command: "dataform.setRunBackend", backend });
  };
  const runBackend: RunBackend = isRemoteMode ? "api" : preferredBackend;
  const hasRunnableActions = !!view.actionTypes?.some(t => t !== 'test');
  const hasTags = (state.project?.tags?.length ?? 0) > 0;
  const showTestRun = !!view.testQuery && !isRemoteMode;
  const hasRunControls = hasRunnableActions || hasTags || (!!state.dataform.changedActions && state.dataform.changedActions.status !== "unavailable");
  // Run and Run Tag both go through the backend the selector is set to
  const hasChangedActions = !!state.dataform.changedActions && state.dataform.changedActions.status !== "unavailable";
  // Run, Run Tag and Run Changed all go through the backend the switch is set to
  const runsViaApi = isRemoteMode || ((hasRunnableActions || hasTags || hasChangedActions) && runBackend === "api");

  const handleRunTag = () => {
    if (selectedTagsForRun.length === 0) { return; }
    const api = runBackend === "api";
    setRunningModel(true);
    if (api) { setSubmittingSince(Date.now()); }
    vscode.postMessage({
      command: api ? "dataform.runTagsApi" : "runTags",
      tags: selectedTagsForRun,
      includeDependencies,
      includeDependents,
      fullRefresh,
    });
    setTimeout(() => setRunningModel(false), api ? 3000 : 10000);
  };
  const latestApiRun = useMemo(
    () => (state.dataform.workflowUrls || []).reduce<WorkflowUrlEntry | undefined>((latest, entry) => (!latest || entry.timestamp > latest.timestamp ? entry : latest), undefined),
    [state.dataform.workflowUrls]
  );

  const latestRun = latestApiRun;
  const lastRun = state.dataform.lastRun;
  const { starting: rerunStarting, rerun } = useRerun(lastRun, handleRerunDispatched);
  const now = useNow(30_000);
  // Follows the setting, but flips at once on click instead of waiting for the panel to redraw
  const [deferOn, setDeferOn] = useState(!!state.dataform.deferToProd?.enabled);
  useEffect(() => setDeferOn(!!state.dataform.deferToProd?.enabled), [state.dataform.deferToProd?.enabled]);
  const toggleDefer = (checked: boolean) => {
    setDeferOn(checked);
    vscode.postMessage({ command: "dataform.toggleDeferToProd", on: checked });
  };
  /** The runs that were seen going while the panel was open, by when they started */
  const seenGoing = useRef<Set<number>>(new Set());
  const openedAt = useRef(Date.now());
  // The time a run has gone for is counted here, between what the host sends
  useTick(!!state.dataform.pendingRun || (!!latestRun && !(latestRun.state && TERMINAL_WORKFLOW_STATES.has(latestRun.state))));
  // The pill in the header asks for the run's details: the row that has them opens
  const [runDetailsRequests, setRunDetailsRequests] = useState(0);
  useEffect(() => {
    const show = () => setRunDetailsRequests((count) => count + 1);
    window.addEventListener(SHOW_RUN_DETAILS_EVENT, show);
    return () => window.removeEventListener(SHOW_RUN_DETAILS_EVENT, show);
  }, []);

  const isPropertyGraphFile = (state.dataform.propertyGraphs?.length ?? 0) > 0;
  const handleRun = (backend: RunBackend) => {
    if (backend === "api") { setSubmittingSince(Date.now()); }
    handleRunModel(backend === "api");
  };

  const handleFormat = () => {
    setFormatting(true);
    vscode.postMessage({ command: "formatFile" });
    setTimeout(() => setFormatting(false), 100);
  };

  const handleLint = () => {
    vscode.postMessage({ command: "lintFile" });
  };
  
  const handleRunTest = () => {
    if (state.project?.root) {
        vscode.postMessage({ command: "dataform.runTests" });
    }
  };

  const handlePreviewResults = () => {
    // The file's first action. A unit test builds nothing, so its Target is made up from its name, as in the Compiled
    // Graph. The section is the one whose rows are the action's: a table's query, the last statement of an operation.
    const first = view.models[0];
    const action: Target = first?.target ?? { database: "", schema: "unit test", name: first?.name ?? "" };
    const shown = state.file?.actions.find((candidate) => candidate.id === targetId(action));
    vscode.postMessage({ command: "preview", action, section: (shown && previewSection(shown)) ?? "query" });
  };

  // One table, view, incremental table or operation with hasOutput, ignoring built-in assertions: the action whose columns can be traced
  const canCheckColumnImpact = tableActions(view.models).length === 1;

  const handleColumnImpact = () => {
    vscode.postMessage({ command: "dataform.showColumnLineage" });
  };
  // From a schema diff after each dry run; no lineage is read until the panel opens
  const changedColumns = state.dataform.columnImpact?.file === fileName ? state.dataform.columnImpact?.changed ?? 0 : 0;

  const handleDependencyGraph = () => {
    vscode.postMessage({ command: "showDependencyGraph" });
  };

  const handleDependencyInspector = () => {
    vscode.postMessage({ command: "dataform.showDependencyInspector" });
  };

  const handleLineageNavigation = (id: string) => {
    // `id` is the action's Target written database.schema.name
    const [database, schema, name] = id.split(".");
    vscode.postMessage({ command: "openAction", action: { database, schema, name } });
  };

  // How many the closed section holds, a target that two of the file's actions read counted once. Dataplex's are loaded on request
  const dependencyCount = new Set((view.models ?? []).flatMap((model: any) => (model.dependencyTargets ?? []).map((target: any) => `${target.database}.${target.schema}.${target.name}`))).size;
  const lineageCounts = `reads from ${dependencyCount} · read by ${localDependentIds.size}`;

  const handleLineageMetadata = () => {
    setLoadingLineage(true);
    vscode.postMessage({ command: "dataform.loadLineage" });
    // Reset loading state after a timeout or when data triggers a re-render (handled via effect if strictly needed, but simple timeout/state update from parent is okay for now)
    // Actually, better to let the App's state update trigger a re-render. 
    // Since we don't have a direct "lineage loaded" event here easily without complex effect, 
    // we can rely on the fact that the state update will cause a re-render. 
    // However, if we want to turn off loading specifically when lineageMetadata arrives, we might need an effect.
    // For now, let's just set a timeout fallback or rely on state.dataform.lineage check.
    // But since `state` comes from prop, we can check if `state.dataform.lineage` changes.
  };

  useEffect(() => {
      if (state.dataform.lineage || problemMessage) {
          setLoadingLineage(false);
      }
  }, [state.dataform.lineage, problemMessage]);

  const queryLabelByType = (type: string) => {
    if (type === 'view') {return 'View';};
    if (type === 'table') {return 'Table';};
    if (type === 'assertion') {return 'Assertion';};
    if (type === 'operations') {return 'Operations';};
    return 'Query';
  };

  // Property graphs produce no query, so none of the toolbar below (format, lint, preview,
  // dry run stats) applies to them. They get their own section instead.
  if (isPropertyGraphFile) {
    return (
      <div className="space-y-6 pb-20">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-mono text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded">
            {fileName || " "}
          </span>
          <ProjectLabel project={state.project} />
          <CompilationInfoBadge info={state.dataform.compilationInfo} mode={state.dataform.compilationMode} recompiling={compiling} />
        </div>
        <LastRunCard lastRun={state.dataform.lastRun} latestApiRun={latestApiRun} disabled={compiling} onRerunDispatched={handleRerunDispatched} />
        <PropertyGraphSection state={state} />
      </div>
    );
  }

  // ---- What the rows say. Each is one line that names its value, and opens to the whole section

  const models: any[] = view.models ?? [];
  /** The name a dry-run result is found by: the action's ID, or a unit test's name */
  const nameKey = (model: any): string | null =>
    model.type === 'test' ? model.name : model.target ? `${model.target.database}.${model.target.schema}.${model.target.name}` : null;
  /** What the dry runs of a model's queries said was wrong, a line for each. Empty when nothing was */
  const dryRunErrorOf = (model: any): string => {
    const key = nameKey(model);
    const nonIncError = key ? bq.errors[key] : undefined;
    const incError = key ? bq.incrementalErrors[key] : undefined;
    const expectedOutputError = key ? bq.expectedOutputErrors[key] : undefined;
    return [
      incError ? `(Incremental): ${incError.message}` : '',
      nonIncError ? (
        model.type === 'incremental' ? `(Non incremental): ${nonIncError.message}` :
        model.type === 'test' && expectedOutputError ? `(Input): ${nonIncError.message}` : nonIncError.message
      ) : '',
      (model.type === 'test' && expectedOutputError) ? `(Expected output): ${expectedOutputError.message}` : '',
    ].filter(Boolean).join('\n');
  };
  const dryRunning = bq.dryRunning && !compiling;

  // Compile: how the SQL was made, and what changes what it says
  const compileFailed = problemType === CompilationErrorType.COMPILATION_ERROR;
  const compileMode = state.dataform.compilationMode ?? state.dataform.compilationInfo?.mode;
  const compileInfo = state.dataform.compilationInfo?.mode === compileMode ? state.dataform.compilationInfo : undefined;
  const deferral = deferralSummary(state.dataform.deferral, state.dataform.deferToProd, state.dataform.leftoverProxies);
  const overrides = overrideLabels(state.dataform.compilerOptions);
  const compileTone: RowTone = compiling ? "busy" : compileFailed ? "error" : compileInfo?.stale || deferral?.on || deferral?.attention || overrides.length > 0 ? "warning" : "calm";
  const compileSummary = compiling ? (
    <><Loader2 className="inline w-3.5 h-3.5 mr-1.5 align-middle animate-spin text-[var(--vscode-textLink-foreground)]" /><span className="align-middle">Compiling with the {compileMode === "api" ? "Dataform API" : "CLI"}…</span></>
  ) : compileFailed ? (
    compileErrors.length > 0 ? `Compilation failed · ${compileErrors.length} error${compileErrors.length === 1 ? "" : "s"}` : "Compilation failed"
  ) : (
    <>
      {compileInfo?.stale && <RowChip tone="warning" title={compileInfo.staleReason}>outdated</RowChip>}
      {deferral?.on && <RowChip tone="warning">defer to prod</RowChip>}
      {!deferral?.on && deferral?.attention && <RowChip tone="warning">{deferral.text}</RowChip>}
      {overrides.map((label) => <RowChip key={label} tone="warning">{label}</RowChip>)}
      <span className="align-middle" title={compileInfo ? compilationInfoTooltip(compileInfo) : undefined}>
        {[
          deferral?.on && deferral.text,
          compileInfo ? compilationInfoParts(compileInfo, now).join(" · ") : compileMode === "api" ? "API" : "CLI",
          deferral && !deferral.on && !deferral.attention && deferral.text,
          overrides.length === 0 && "no overrides",
        ].filter(Boolean).join(" · ")}
      </span>
    </>
  );

  // Lineage: what the file reads and what reads it
  const hasTargets = models.some((model) => model.target);
  const lineageTone: RowTone = !hasTargets ? "off" : changedColumns > 0 ? "warning" : "calm";
  const columnImpactTitle = changedColumns
    ? `This dry run drops or retypes ${changedColumns} column${changedColumns === 1 ? '' : 's'} against prod. Show every column's lineage, those first (Dataplex lineage)`
    : "Show the lineage of each of this table's columns, and which ones this dry run drops or retypes against prod (Dataplex lineage)";
  const graphButton = (
    <button onClick={handleDependencyGraph} disabled={compiling} className={ROW_BUTTON} title="Open the dependency graph">
      <Network className="w-3 h-3" /> Graph
    </button>
  );
  const previewButton = (
    <button onClick={handlePreviewResults} disabled={compiling} className={ROW_BUTTON} title="Preview the query results">
      <Eye className="w-3 h-3" /> Preview Data
    </button>
  );
  const columnImpactButton = (className: string) => (
    <button onClick={handleColumnImpact} disabled={compiling || bq.dryRunning} className={className} title={columnImpactTitle}>
      <GitCompareArrows className="w-3 h-3" /> Column impact
    </button>
  );

  // Run: there is something to run, and a compile to run it from
  const canRun = hasRunControls || showTestRun;
  const runOff = !canRun || (compileFailed && models.length === 0);

  // Last run: what the newest run did, and what it is doing while it goes
  const latestEnded = !!latestRun?.state && TERMINAL_WORKFLOW_STATES.has(latestRun.state);
  if (latestRun && !latestEnded) {
    seenGoing.current.add(latestRun.timestamp);
  }
  const invoked = state.dataform.pendingRun ?? undefined;
  const pendingRun = invoked && (!latestRun || invoked.stages.invokedAt >= (latestRun.stages?.invokedAt ?? latestRun.timestamp)) ? invoked : undefined;
  const submitting = submittingSince !== null && (!latestRun || latestRun.timestamp <= submittingSince);
  const runGoing = !!pendingRun || submitting || (!!latestRun && !latestEnded);
  const progress = latestRun ? runProgress(latestRun) : undefined;
  const runFailed = !!latestRun && latestEnded && (latestRun.state === "FAILED" || (progress?.failed ?? 0) > 0);
  // A run that had failed before the panel opened is old news: it is told, but does not open the row
  const freshRun = !!latestRun && (seenGoing.current.has(latestRun.timestamp) || latestRun.timestamp >= openedAt.current);
  const lastRunTone: RowTone = runGoing ? "busy" : runFailed && freshRun ? "error" : "calm";
  const runDuration = workflowDurationMs(latestRun);
  const spinner = <Loader2 className="inline w-3.5 h-3.5 mr-1.5 align-middle animate-spin text-[var(--vscode-textLink-foreground)]" />;
  // What the newest run was asked to run, in a few words: its tags, its one action, or the first of its actions and how many more
  const ranTargets = latestRun?.includedTargets ?? [];
  const whatRan = latestRun?.includedTags?.length
    ? `tag${latestRun.includedTags.length === 1 ? "" : "s"} ${latestRun.includedTags.join(", ")}`
    : ranTargets.length > 0
      ? `${ranTargets[0].name}${ranTargets.length > 1 ? ` +${ranTargets.length - 1}` : ""}`
      : "whole project";
  const lastRunSummary = pendingRun ? (
    <>{spinner}<span className="align-middle">{pendingRun.via === "cli" ? "CLI" : "API"} run {runStage(pendingRun.stages, pendingRun.via) ?? "starting"} · {clock(Date.now() - pendingRun.stages.invokedAt)}</span></>
  ) : submitting ? (
    <>{spinner}<span className="align-middle">Submitting workflow invocation… usually 2 to 10 seconds</span></>
  ) : latestRun && !latestEnded ? (
    <>
      {spinner}
      <span className="align-middle">
        <span className="font-mono">{whatRan}</span>
        {[
          "",
          latestRun.state === "CANCELING" ? "stopping" : (latestRun.stages && !(latestRun.actions?.length) && runStage(latestRun.stages, runVia(latestRun))) || "running",
          clock(Date.now() - (latestRun.stages?.invokedAt ?? latestRun.invocationStartTime ?? latestRun.timestamp)),
          progress && progress.total > 0 ? `${progress.succeeded} of ${progress.total} ${latestRun.executionMode === "cli" ? "BigQuery jobs" : "actions"} done` : null,
          progress && progress.failed > 0 ? `${progress.failed} failed` : null,
        ].filter((part) => part !== null && part !== undefined).join(" · ")}
      </span>
    </>
  ) : latestRun ? (
    <>
      {/* The dot says how it ended, so the line has room for what was run */}
      <span
        role="img"
        aria-label={runFailed ? "Failed" : latestRun.state === "CANCELLED" ? "Cancelled" : latestRun.state === "SUCCEEDED" ? "Succeeded" : latestRun.state ?? "Unknown"}
        title={runFailed ? "Failed" : latestRun.state === "CANCELLED" ? "Cancelled" : latestRun.state === "SUCCEEDED" ? "Succeeded" : latestRun.state ?? "Unknown"}
        className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full align-middle"
        style={{ background: runFailed || latestRun.state === "CANCELLED" ? "var(--vscode-errorForeground, #f14c4c)" : latestRun.state === "SUCCEEDED" ? "var(--vscode-testing-iconPassed, #4ec9b0)" : "var(--vscode-descriptionForeground)" }}
      />
      <span className="align-middle" title={lastRun?.detail}>
        <span className="font-mono">{whatRan}</span>
        {[
          "",
          latestRun.includeDependencies ? "+deps" : null,
          latestRun.includeDependents ? "+dependents" : null,
          latestRun.fullRefresh ? "full refresh" : null,
          runFailed ? (progress && progress.total > 0 ? `${progress.failed} of ${progress.total} failed` : "failed") : null,
          latestRun.state === "CANCELLED" ? "cancelled" : null,
          !runFailed && latestRun.state !== "CANCELLED" && latestRun.state !== "SUCCEEDED" ? (latestRun.state ?? "unknown").toLowerCase() : null,
          runDuration !== undefined ? formatDuration(runDuration) : null,
          latestRun.jobStatsSummary?.bytesBilledLabel ? `${latestRun.jobStatsSummary.bytesBilledLabel} billed` : null,
          latestRun.jobStatsSummary?.costLabel,
          formatAgo(latestRun.timestamp, now),
        ].filter((part) => part !== null && part !== undefined).join(" · ")}
      </span>
    </>
  ) : lastRun ? (
    <span title={lastRun.detail}>{formatAgo(lastRun.timestamp, now)} · <span className="font-mono">{lastRun.label}</span></span>
  ) : (
    <span className="text-[var(--vscode-descriptionForeground)]">No run yet</span>
  );

  // ---- The SQL: one tab for each query the file compiles to

  const annotationOf = (error: { message: string; location?: { line?: number | null } } | undefined) =>
    error?.location?.line !== null && error?.location?.line !== undefined ? [{ line: error.location.line, message: error.message }] : undefined;
  const blocks: SqlBlock[] = models.flatMap((model): SqlBlock[] => {
    const key = nameKey(model);
    const target = key ?? '';
    const id = `${model.type}_${target}`;
    const error = key ? bq.errors[key] : undefined;
    const incrementalError = key ? bq.incrementalErrors[key] : undefined;
    const expectedOutputError = key ? bq.expectedOutputErrors[key] : undefined;
    const block = (name: string, label: string, code: string, of?: typeof error, none = ''): SqlBlock =>
      ({ key: `${name}_${id}`, label, target, code, none, main: name !== 'preOps' && name !== 'postOps', annotations: annotationOf(of), failed: !!of });

    if (model.type === 'incremental') {
      const incPreOps = (model.incrementalPreOps || []).join('\n\n');
      const incQuery = model.incrementalQuery ?? '';
      const incFallback = [incPreOps, incPreOps && incQuery ? ';' : '', incQuery].filter(Boolean).join('\n');
      const nonIncFallback = [...(model.preOps || []), model.query ?? ''].filter(Boolean).join('\n\n');
      return [
        block('incremental', 'Incremental', (key && bq.incrementalQueries[key]) ?? incFallback, incrementalError, 'No incremental query.'),
        block('nonIncremental', 'Non-incremental', (key && bq.nonIncrementalQueries[key]) ?? nonIncFallback, error, 'No non-incremental query.'),
        ...(model.postOps?.length ? [block('postOps', 'Post-ops', model.postOps.join('\n'))] : []),
      ];
    }
    if (model.type === 'test') {
      return [
        block('input', 'Input', model.testQuery ?? '', error, 'No input query.'),
        block('expected', 'Expected output', model.expectedOutputQuery ?? '', expectedOutputError, 'No expected output query.'),
      ];
    }
    return [
      ...(model.preOps?.length ? [block('preOps', 'Pre-ops', model.preOps.join('\n'))] : []),
      ...(model.query ? [block('query', queryLabelByType(model.type), (key && bq.queries[key]) ?? model.query, error)] : []),
      ...(model.postOps?.length ? [block('postOps', 'Post-ops', model.postOps.join('\n'))] : []),
    ];
  });
  const tabLabel = sqlTabLabels(blocks);
  const shownBlock = shownSqlBlock(blocks, sqlTab);

  return (
    <div className="pb-20">
      {/* The panel's padding is taken back: the rows run from edge to edge */}
      <div className="-mx-4 -mt-4">
        <TargetRow>
          {models.map((model, index) => {
            const target = model.target;
            if (!target && model.type !== 'test') { return null; }
            const lastUpdateMeta = bq.lastUpdates[index];
            const key = nameKey(model);
            const dryRunStat = key ? bq.stats[key] : undefined;
            return (
              <TargetAction
                key={index}
                separated={index > 0}
                lastUpdated={lastUpdateMeta ? (lastUpdateMeta.error?.message ? { unknown: lastUpdateMeta.error.message } : { time: lastUpdateMeta.lastModifiedTime ?? "", today: !!lastUpdateMeta.modelWasUpdatedToday }) : undefined}
                dryRun={<DryRunResult running={dryRunning} stat={bq.dryRunning ? undefined : dryRunStat} />}
                error={dryRunErrorOf(model)}
                head={<>
                  <KindBadge kind={model.type} />
                  {model.type === 'assertion' && target && describeBuiltInAssertion(target.name, model.query).map(builtIn => (
                    <span
                      key={builtIn.kind}
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-badge-background)]/40"
                      title={builtIn.checks.length > 0 ? `${builtIn.label}:\n${builtIn.checks.join('\n')}` : builtIn.label}
                    >
                      {builtIn.label}
                    </span>
                  ))}
                  {model.type === 'test' ? (
                    <span className="font-mono font-semibold text-[var(--vscode-foreground)]">{model.name}</span>
                  ) : (
                    <>
                      <BigQueryTableLink
                        id={target}
                        showIcon={true}
                        className="flex items-center min-w-0 break-all font-mono text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-foreground)] hover:underline transition-colors"
                        fallbackClassName="flex items-center font-mono text-[var(--vscode-errorForeground)]"
                      />
                      {model.type === 'notebook' && model.fileName && (
                        <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-80">{model.fileName}</span>
                      )}
                      <CopyTableIdButton onCopy={() => navigator.clipboard.writeText(`\`${target.database}.${target.schema}.${target.name}\``)} />
                    </>
                  )}
                </>}
              />
            );
          })}
        </TargetRow>

        <SummaryRow
          label="Compile"
          tone={compileTone}
          summary={compileSummary}
          // Open, the tokens under the line say how it compiled: the line names the file they are of
          openSummary={compileFailed || compiling ? undefined : (
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate font-mono text-xs text-[var(--vscode-descriptionForeground)]" title={fileName}>{fileName || " "}</span>
              <ProjectLabel project={state.project} className="flex-shrink-0" />
            </span>
          )}
          actions={<>
            <button onClick={handleFormat} disabled={formatting || compiling} className={ROW_BUTTON} title="Format the file">
              <Wand2 className="w-3 h-3" /> Format
            </button>
            <button onClick={handleLint} disabled={formatting || compiling} className={ROW_BUTTON} title="Lint the file">
              <ShieldCheck className="w-3 h-3" /> Lint
            </button>
          </>}
        >
          {compileFailed ? (
            // It has the compile info, the switch of Compilation Mode and the compiler overrides of its own
            <CompilationError state={state} />
          ) : (
            <>
              {/* Every setting is a token of one line that wraps: what is set has the warning colour, what is not is an outline */}
              <div className="flex flex-wrap items-center gap-1.5">
                <CompileModeToken info={state.dataform.compilationInfo} mode={state.dataform.compilationMode} recompiling={compiling} />
                {state.dataform.deferToProd && <ModifierSwitch chip label="Defer to prod" checked={deferOn} onChange={toggleDefer} title={DEFER_SWITCH_TITLE} />}
                <CompilerOverrides initialCompilerOptions={state.dataform.compilerOptions} tokens />
              </div>
              <DeferralBanner bare on={deferOn} deferral={state.dataform.deferral} deferToProd={state.dataform.deferToProd} leftoverProxies={state.dataform.leftoverProxies} />
            </>
          )}
        </SummaryRow>

        <SummaryRow
          label="Lineage"
          tone={lineageTone}
          summary={!hasTargets ? (models.length > 0 ? "unit tests have no lineage" : "—") : (
            <>
              {changedColumns > 0 && <RowChip tone="warning" title={columnImpactTitle}>{changedColumns} column{changedColumns === 1 ? " changes" : "s change"}</RowChip>}
              <span className="align-middle">{lineageCounts}</span>
            </>
          )}
          actions={hasTargets && <>
            {canCheckColumnImpact && changedColumns > 0 && columnImpactButton(ROW_BUTTON)}
            {graphButton}
            {previewButton}
          </>}
          // Open, every way to look further is on the line: the lists under it are all there is to read
          openActions={hasTargets && <>
            <button onClick={handleDependencyInspector} disabled={compiling} className={ROW_BUTTON} title="Inspect upstream and downstream dependencies">
              <ListTree className="w-3 h-3" /> Inspector
            </button>
            {canCheckColumnImpact && columnImpactButton(ROW_BUTTON)}
            {graphButton}
            {previewButton}
          </>}
        >
          <LineageColumns
            reads={models.flatMap((model) => model.dependencyTargets ?? [])}
            readBy={view.dependents ?? []}
            own={models.map((model) => model.target).filter(Boolean)}
            dataplex={state.dataform.lineage}
            loadingDataplex={loadingLineage}
            onLoadDataplex={handleLineageMetadata}
            onOpen={handleLineageNavigation}
          />
        </SummaryRow>

        <RunRow off={runOff ? (canRun ? "needs a compile that succeeds" : "nothing to run in this file") : undefined}>
                {hasRunControls && (
                  <RunModifiers
                    includeDependencies={includeDependencies}
                    includeDependents={includeDependents}
                    fullRefresh={fullRefresh}
                    onIncludeDependencies={setIncludeDependencies}
                    onIncludeDependents={setIncludeDependents}
                    onFullRefresh={setFullRefresh}
                    titles={{ dependencies: "Include dependencies (--include-deps)", dependents: "Include dependents (--include-dependents)", fullRefresh: "Rebuild incremental tables from scratch (--full-refresh)" }}
                  />
                )}
                <div className="relative flex items-center gap-1.5 ml-auto">
                  {(hasRunnableActions || hasTags || hasChangedActions) && (
                    <RunBackendSwitch backend={runBackend} isRemoteMode={isRemoteMode} disabled={compiling} onChange={setPreferredBackend} />
                  )}
                  {/* Everything that starts a run is one group, each part with the arrow of a run and the name of what it
                      runs: they are told from the settings beside them, which have neither */}
                  <div role="group" aria-label="Run" style={runsViaApi ? API_RUN_COLORS : undefined} className={RUN_GROUP}>
                  {showTestRun && (
                    <button onClick={handleRunTest} disabled={compiling} title="Run the unit tests of this file, with the Dataform CLI" style={CLI_RUN_COLORS} className={hasRunnableActions ? RUN_PART : RUN_MAIN_PART}>
                      <Play className="w-3 h-3" /> Tests
                    </button>
                  )}
                  {hasTags && (
                    <TagRunPart
                      tags={state.project?.tags ?? []}
                      selected={selectedTagsForRun}
                      onSelect={setSelectedTagsForRun}
                      onRun={handleRunTag}
                      disabled={compiling}
                      title={`Pick tag(s) to run via the Dataform ${runBackend === "api" ? "API" : "CLI"}`}
                      via={`via the ${runBackend === "api" ? "API" : "CLI"}`}
                      className={hasRunnableActions || showTestRun ? RUN_PART : RUN_MAIN_PART}
                    />
                  )}
                  <RunChangedButton
                    compact
                    className={RUN_PART}
                    via={runBackend}
                    changedActions={state.dataform.changedActions}
                    isRemoteMode={isRemoteMode}
                    disabled={runningModel || compiling}
                    includeDependencies={includeDependencies}
                    includeDependents={includeDependents}
                    fullRefresh={fullRefresh}
                    onApiRunDispatched={() => setSubmittingSince(Date.now())}
                  />
                  {hasRunnableActions && (
                    <button
                      onClick={() => handleRun(runBackend)}
                      disabled={compiling || runningModel}
                      style={fullRefresh ? FULL_REFRESH_RING : undefined}
                      title={`Run this file's actions via the Dataform ${runBackend === "api" ? "API" : "CLI"}${[includeDependencies && ", with dependencies", includeDependents && ", with dependents", fullRefresh && ", full refresh"].filter(Boolean).join("")}`}
                      className={RUN_MAIN_PART}
                    >
                      {runningModel ? <Loader2 className="w-3 h-3 animate-spin" /> : runBackend === "api" ? <Cloud className="w-3 h-3" /> : <Play className="w-3 h-3" />} File
                    </button>
                  )}
                  </div>
                </div>
                {runsViaApi && describeApiRunGitState(state.dataform.apiRunGitState) && (
                  <div className="basis-full flex justify-end pb-0.5">
                    <ApiRunGitChip state={state.dataform.apiRunGitState} />
                  </div>
                )}
        </RunRow>

        <SummaryRow
          label="Last run"
          tone={lastRunTone}
          summary={lastRunSummary}
          openRequest={runDetailsRequests}
          wide
          actions={latestRun && !latestEnded ? (
            <CancelWorkflowButton entry={latestRun} />
          ) : lastRun && !runGoing ? (
            <button
              onClick={rerun}
              disabled={compiling || rerunStarting}
              className={ROW_BUTTON}
              title={lastRun.fullRefresh ? `Run again: ${lastRun.label} (asks for confirmation because of full refresh)` : `Run again with the same options: ${lastRun.label}`}
            >
              {rerunStarting ? <><Loader2 className="w-3 h-3 animate-spin" /> Starting…</> : <><RotateCcw className="w-3 h-3" /> Again</>}
            </button>
          ) : undefined}
        >
          {latestRun || submitting ? <LatestRunBanner state={state} submittingSince={submittingSince} /> : null}
        </SummaryRow>
      </div>

      {shownBlock && <SqlTabs blocks={blocks} shown={shownBlock} onShow={setSqlTab} labelOf={tabLabel} />}
    </div>
  );
};
