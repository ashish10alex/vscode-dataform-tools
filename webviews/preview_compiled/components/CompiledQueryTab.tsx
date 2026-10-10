import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { CompilationErrorType, ExecutionMode, Target, PanelState, WorkflowUrlEntry } from "../types";
import { previewSection, targetId } from "../../../src/shared/compiledGraph";
import { CodeBlock } from "../../components/CodeBlock";
import { vscode } from "../utils/vscode";
import { LatestRunBanner } from "./LatestRunBanner";
import { LastRunCard, formatAgo, useRerun } from "./LastRunCard";
import { CompilationInfoBadge, useNow } from "./CompilationInfoBadge";
import { CompilationError } from "./CompilationError";
import { CancelWorkflowButton } from "./CancelWorkflowButton";
import { SHOW_RUN_DETAILS_EVENT } from "./RunStatusPill";
import { clock, runVia } from "./RunStages";
import { workflowDurationMs, useTick } from "./WorkflowActionsTable";
import { ROW_BUTTON, ROW_PRIMARY_BUTTON, RowChip, RowTone, SummaryRow } from "./SummaryRow";
import { RunChangedButton } from "./RunChangedButton";
import { RunBackend, RunSplitButton } from "./RunSplitButton";
import { ApiRunGitChip } from "./ApiRunGitChip";
import { ModifierSwitch } from "./ModifierSwitch";
import { DeferralBanner, deferralSummary } from "./DeferralBanner";
import {
  Play,
  Network,
  GitCompareArrows,
  ListTree,
  Eye,
  ShieldCheck,
  Wand2,
  ExternalLink,
  RotateCcw,
  Copy,
  Check,
  Loader2,
  Clock,
  AlertCircle,
} from "lucide-react";
import clsx from "clsx";
import { tableActions } from "../../../src/shared/columnLineage/tableActions";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "../utils/constants";
import { describeBuiltInAssertion } from "../../../src/shared/builtInAssertions";
import { CompilerOverrides, overrideLabels } from "./CompilerOverrides";
import { PropertyGraphSection } from "./PropertyGraphSection";
import StyledMultiSelect from "../../dependancy_graph/components/StyledMultiSelect";
import { OptionType } from "../../dependancy_graph/components/StyledSelect";
import { MultiValue } from "react-select";
import { UNKNOWN_ACCURACY_CHIP_STYLE, UNKNOWN_ACCURACY_STAT, UNKNOWN_ACCURACY_TOOLTIP } from "../../utils/dryRunAccuracy";
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

const BUTTON_BASE = "py-1.5 rounded text-sm flex items-center disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]";
const PRIMARY_BUTTON = `${BUTTON_BASE} px-3 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]`;
const SECONDARY_BUTTON = `${BUTTON_BASE} px-3 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)]`;
// Full refresh rebuilds tables from scratch: the Run button takes the colour of its switch while it is on
const FULL_REFRESH_COLOR = "var(--vscode-charts-orange, #d18616)";

/**
 * A stat line ending in UNKNOWN_ACCURACY_STAT means BigQuery could not estimate the bytes.
 * Render it as a warning chip rather than plain text, so it is impossible to mistake for a
 * normal estimate at a glance; the tooltip explains what BigQuery actually reported.
 */
export const renderDryRunStatLine = (line: string) => {
  if (!line.endsWith(UNKNOWN_ACCURACY_STAT)) {
    return line;
  }
  const label = line.slice(0, -UNKNOWN_ACCURACY_STAT.length);
  return (
    <span title={UNKNOWN_ACCURACY_TOOLTIP}>
      {label}
      <span className="px-1.5 py-0.5 rounded font-semibold" style={UNKNOWN_ACCURACY_CHIP_STYLE}>
        {UNKNOWN_ACCURACY_STAT}
      </span>
    </span>
  );
};

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
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagPopoverRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!tagPopoverOpen) { return; }
    const onDocMouseDown = (e: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target as Node)) {
        setTagPopoverOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTagPopoverOpen(false); }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [tagPopoverOpen]);

  const tagOptions: OptionType[] = useMemo(
    () => (state.project?.tags || []).map(tag => ({ value: tag, label: tag })),
    [state.project?.tags]
  );
  const selectedTagRunOptions: OptionType[] = useMemo(
    () => selectedTagsForRun.map(tag => ({ value: tag, label: tag })),
    [selectedTagsForRun]
  );
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
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
  const [preferredBackend, setPreferredBackend] = useState<RunBackend>("cli");
  const runBackend: RunBackend = isRemoteMode ? "api" : preferredBackend;
  const hasRunnableActions = !!view.actionTypes?.some(t => t !== 'test');
  const hasTags = (state.project?.tags?.length ?? 0) > 0;
  const showTestRun = !!view.testQuery && !isRemoteMode;
  const hasRunControls = hasRunnableActions || hasTags || (!!state.dataform.changedActions && state.dataform.changedActions.status !== "unavailable");
  // Run and Run Tag both go through the backend the selector is set to
  const runsViaApi = isRemoteMode || ((hasRunnableActions || hasTags) && runBackend === "api");

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

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const runTagShortcutHint = isMac ? "⌘↵" : "Ctrl+↵";
  const runTagLabel = selectedTagsForRun.length === 0
    ? "Run"
    : `Run ${selectedTagsForRun.length} tag${selectedTagsForRun.length === 1 ? "" : "s"}`;

  const handleTagPopoverKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || selectedTagsForRun.length === 0) { return; }
    // Cmd/Ctrl+Enter always runs. Plain Enter runs only when the react-select
    // menu is closed, otherwise react-select owns Enter to toggle the focused option.
    if (e.metaKey || e.ctrlKey || !tagMenuOpen) {
      e.preventDefault();
      handleRunTag();
      setTagPopoverOpen(false);
    }
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
  const lineageCounts = `${dependencyCount} ${dependencyCount === 1 ? "dependency" : "dependencies"} · ${localDependentIds.size} ${localDependentIds.size === 1 ? "dependent" : "dependents"}`;

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
  const shortName = (model: any): string => model.type === 'test' ? model.name : model.target ? `${model.target.schema}.${model.target.name}` : '';
  const typeBadge = (type: string) => {
    const style = ACTION_TYPE_BADGE_STYLES[type] || DEFAULT_BADGE_STYLE;
    return <span className={`inline-block align-middle mr-1.5 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}>{type}</span>;
  };

  // Target: what the file builds, and what its dry run said
  const first = models[0];
  const firstKey = first ? nameKey(first) : null;
  const firstStat = firstKey ? bq.stats[firstKey] : undefined;
  const failedModels = models.filter((model) => dryRunErrorOf(model));
  const dryRunning = bq.dryRunning && !compiling;
  const notUpdatedToday = bq.lastUpdates.some((times) => !!times && !times.error?.message && times.modelWasUpdatedToday === false);
  const targetTone: RowTone = models.length === 0 ? "off" : failedModels.length > 0 ? "error" : dryRunning ? "busy" : notUpdatedToday ? "warning" : "calm";
  const targetSummary = !first ? "—" : (
    <>
      {typeBadge(first.type)}
      <span className="font-mono align-middle mr-1.5" title={firstKey ?? undefined}>{shortName(first)}</span>
      {failedModels.length > 0 ? (
        <RowChip tone="error">{models.length > 1 ? `${failedModels.length} of ${models.length} failed dry run` : "dry run failed"}</RowChip>
      ) : dryRunning ? (
        <RowChip tone="busy"><Loader2 className="w-2.5 h-2.5 animate-spin" /> dry run…</RowChip>
      ) : firstStat ? (
        <RowChip title={firstStat.split("<br>").join("\n")}>{renderDryRunStatLine(firstStat.split("<br>")[0])}</RowChip>
      ) : null}
      {notUpdatedToday && failedModels.length === 0 && <RowChip tone="warning">not updated today</RowChip>}
      {models.length > 1 && <RowChip>+{models.length - 1} {models.length === 2 ? models[1].type : "more"}</RowChip>}
      {failedModels.length > 0 && <span className="align-middle">{dryRunErrorOf(failedModels[0]).split("\n")[0]}</span>}
    </>
  );

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
  const columnImpactButton = (className: string) => (
    <button onClick={handleColumnImpact} disabled={compiling || bq.dryRunning} className={className} title={columnImpactTitle}>
      <GitCompareArrows className="w-3 h-3" /> Column impact
    </button>
  );

  // Run: what Run will do
  const canRun = hasRunControls || showTestRun;
  const gitSummary = runsViaApi ? describeApiRunGitState(state.dataform.apiRunGitState) : undefined;
  const changedCount = state.dataform.changedActions?.status === "ready" ? state.dataform.changedActions.changed?.length ?? 0 : undefined;
  const runTone: RowTone = !canRun || (compileFailed && models.length === 0) ? "off" : fullRefresh || (gitSummary && gitSummary.tone !== "muted") ? "warning" : "calm";
  const runScope = [includeDependencies && "+deps", includeDependents && "+dependents"].filter(Boolean).join(" · ");
  const runSummary = !canRun ? "nothing to run in this file" : runTone === "off" ? "needs a compile that succeeds" : (
    <>
      {fullRefresh && <RowChip tone="warning">full refresh</RowChip>}
      <span className="align-middle" title={gitSummary?.tooltip}>
        {[
          hasRunnableActions || hasTags ? (runBackend === "api" ? "API" : "CLI") : null,
          hasRunnableActions ? (runScope || "this file only") : runScope || null,
          !hasRunnableActions && showTestRun ? "unit tests" : null,
          gitSummary && gitSummary.tone !== "muted" ? gitSummary.label : null,
          changedCount !== undefined ? `${changedCount} changed` : null,
        ].filter(Boolean).join(" · ")}
      </span>
    </>
  );

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
  const lastRunSummary = pendingRun ? (
    <>{spinner}<span className="align-middle">{pendingRun.via === "cli" ? "CLI" : "API"} run {runStage(pendingRun.stages, pendingRun.via) ?? "starting"} · {clock(Date.now() - pendingRun.stages.invokedAt)}</span></>
  ) : submitting ? (
    <>{spinner}<span className="align-middle">Submitting workflow invocation… usually 2 to 10 seconds</span></>
  ) : latestRun && !latestEnded ? (
    <>
      {spinner}
      <span className="align-middle">
        {[
          latestRun.state === "CANCELING" ? "Stopping" : (latestRun.stages && !(latestRun.actions?.length) && runStage(latestRun.stages, runVia(latestRun))) || "Running",
          clock(Date.now() - (latestRun.stages?.invokedAt ?? latestRun.invocationStartTime ?? latestRun.timestamp)),
          progress && progress.total > 0 ? `${progress.succeeded} of ${progress.total} ${latestRun.executionMode === "cli" ? "BigQuery jobs" : "actions"} done` : null,
          progress && progress.failed > 0 ? `${progress.failed} failed` : null,
        ].filter(Boolean).join(" · ")}
      </span>
    </>
  ) : latestRun ? (
    <>
      <span className="inline-block w-1.5 h-1.5 mr-1.5 rounded-full align-middle" style={{ background: runFailed || latestRun.state === "CANCELLED" ? "var(--vscode-errorForeground)" : "var(--vscode-testing-iconPassed, #4ec9b0)" }} />
      <span className="align-middle" title={lastRun?.detail}>
        {[
          runFailed ? "Failed" : latestRun.state === "CANCELLED" ? "Cancelled" : latestRun.state === "SUCCEEDED" ? "Succeeded" : (latestRun.state ?? "Unknown").toLowerCase(),
          runFailed && progress && progress.total > 0 ? `${progress.failed} of ${progress.total} failed` : null,
          runDuration !== undefined ? formatDuration(runDuration) : null,
          latestRun.jobStatsSummary?.bytesBilledLabel ? `${latestRun.jobStatsSummary.bytesBilledLabel} billed` : null,
          latestRun.jobStatsSummary?.costLabel,
          formatAgo(latestRun.timestamp, now),
        ].filter(Boolean).join(" · ")}
      </span>
    </>
  ) : lastRun ? (
    <span title={lastRun.detail}>{formatAgo(lastRun.timestamp, now)} · <span className="font-mono">{lastRun.label}</span></span>
  ) : (
    <span className="text-[var(--vscode-descriptionForeground)]">No run yet</span>
  );

  // ---- The SQL: one tab for each query the file compiles to

  interface SqlBlock {
    key: string;
    label: string;
    /** What the SQL builds, for the tab's tooltip */
    target: string;
    code: string;
    /** The query the action is for, which is the one shown first: not what runs before or after it */
    main: boolean;
    /** What is said where there is no SQL */
    none: string;
    annotations?: { line: number; message: string }[];
    failed: boolean;
  }
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
  // Two actions of a kind are told apart by what they build
  const labelCounts = blocks.reduce<Record<string, number>>((counts, block) => ({ ...counts, [block.label]: (counts[block.label] ?? 0) + 1 }), {});
  const tabLabel = (block: SqlBlock) => labelCounts[block.label] > 1 ? `${block.target.slice(block.target.lastIndexOf('.') + 1)} · ${block.label}` : block.label;
  const shownBlock = blocks.find((block) => block.key === sqlTab) ?? blocks.find((block) => block.main) ?? blocks[0];

  return (
    <div className="pb-20">
      {/* The panel's padding is taken back: the rows run from edge to edge */}
      <div className="-mx-4 -mt-4">
        <SummaryRow
          label="Target"
          tone={targetTone}
          summary={targetSummary}
          // Open, each action is named under the line, with its own copy button
          openSummary={<span className="text-[var(--vscode-descriptionForeground)]">{models.length === 1 ? "1 action" : `${models.length} actions`}{failedModels.length > 0 ? ` · ${failedModels.length} failed the dry run` : ""}</span>}
          openActions={null}
          actions={first?.target && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(`\`${first.target.database}.${first.target.schema}.${first.target.name}\``);
                setCopiedIndex(0);
                setTimeout(() => setCopiedIndex(null), 2000);
              }}
              className="p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded"
              title="Copy table ID with backticks"
              aria-label="Copy table ID with backticks"
            >
              {copiedIndex === 0 ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        >
          {models.map((model, index) => {
            const target = model.target;
            if (!target && model.type !== 'test') { return null; }
            const lastUpdateMeta = bq.lastUpdates[index];
            const key = nameKey(model);
            const dryRunStat = key ? bq.stats[key] : undefined;
            const errorDisplay = dryRunErrorOf(model);
            return (
              // Each action is set apart, so it is plain which one an error is of
              <div key={index} className={clsx("space-y-1.5 group", index > 0 && "!mt-2.5 pt-2.5 border-t border-[var(--vscode-widget-border)]")}>
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
                  {typeBadge(model.type)}
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
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`\`${target.database}.${target.schema}.${target.name}\``);
                          setCopiedIndex(index);
                          setTimeout(() => setCopiedIndex(null), 2000);
                        }}
                        className="p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                        title="Copy table ID with backticks"
                      >
                        {copiedIndex === index ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  )}
                  {dryRunStat && !bq.dryRunning && (
                    <span className="ml-auto text-xs font-mono font-medium text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] px-2 py-0.5 rounded">
                      {dryRunStat.split("<br>").map((line, i) => (
                        <React.Fragment key={i}>{i > 0 && <br />}{renderDryRunStatLine(line)}</React.Fragment>
                      ))}
                    </span>
                  )}
                </div>

                {lastUpdateMeta && (
                  <div className="flex items-center space-x-2 text-xs text-[var(--vscode-descriptionForeground)]">
                    <Clock className="w-3 h-3" />
                    <span>Last updated:</span>
                    {lastUpdateMeta.error?.message ? (
                      <span
                        className="font-mono text-[var(--vscode-descriptionForeground)] opacity-70 cursor-help border-b border-dotted border-[var(--vscode-widget-border)]"
                        title={lastUpdateMeta.error.message}
                      >
                        N/A
                      </span>
                    ) : (
                      <span className={clsx("font-mono", !lastUpdateMeta.modelWasUpdatedToday ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-foreground)]")}>
                        {lastUpdateMeta.lastModifiedTime}
                      </span>
                    )}
                  </div>
                )}

                {errorDisplay && (
                  <div className="bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] px-3 py-2 rounded text-xs text-[var(--vscode-inputValidation-errorForeground)] flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div className="overflow-auto whitespace-pre-wrap">{errorDisplay}</div>
                  </div>
                )}
              </div>
            );
          })}
        </SummaryRow>

        <SummaryRow
          label="Compile"
          tone={compileTone}
          summary={compileSummary}
          actions={<>
            <button onClick={handleFormat} disabled={formatting || compiling} className={ROW_BUTTON} title="Format the file">
              <Wand2 className="w-3 h-3" /> Format
            </button>
            <button onClick={handleLint} disabled={formatting || compiling} className={ROW_BUTTON} title="Lint the file">
              <ShieldCheck className="w-3 h-3" /> Lint
            </button>
          </>}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-0.5 rounded">
              {fileName || " "}
            </span>
            <ProjectLabel project={state.project} />
          </div>
          {compileFailed ? (
            // It has the compile info, the switch of Compilation Mode and the compiler overrides of its own
            <CompilationError state={state} />
          ) : (
            <>
              <CompilationInfoBadge info={state.dataform.compilationInfo} mode={state.dataform.compilationMode} recompiling={compiling} />
              <DeferralBanner deferral={state.dataform.deferral} deferToProd={state.dataform.deferToProd} leftoverProxies={state.dataform.leftoverProxies} />
              <CompilerOverrides initialCompilerOptions={state.dataform.compilerOptions} embedded />
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
            <button onClick={handleDependencyGraph} disabled={compiling} className={ROW_BUTTON} title="Open the dependency graph">
              <Network className="w-3 h-3" /> Graph
            </button>
            <button onClick={handlePreviewResults} disabled={compiling} className={ROW_BUTTON} title="Preview the query results">
              <Eye className="w-3 h-3" /> Preview Data
            </button>
          </>}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <button onClick={handleDependencyInspector} disabled={compiling} className={ROW_BUTTON} title="Inspect upstream and downstream dependencies">
              <ListTree className="w-3 h-3" /> Inspector
            </button>
            {canCheckColumnImpact && columnImpactButton(ROW_BUTTON)}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] mb-1 uppercase tracking-wider">Dependencies</h4>
            {!models[0]?.dependencyTargets?.length && <span className="text-sm text-[var(--vscode-descriptionForeground)] italic">No dependencies</span>}
            <ul className="space-y-1">
              {models.map((model, idx) => (
                model.dependencyTargets?.map((target: any, tIdx: number) => {
                  const id = `${target.database}.${target.schema}.${target.name}`;
                  return (
                    <li key={`${idx}-${tIdx}`} className="flex items-center text-sm group">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-functionForeground)] opacity-70 mr-2"></span>
                      <BigQueryTableLink id={target} label={id} />
                      <button
                        onClick={() => handleLineageNavigation(id)}
                        className="ml-2 p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-textLink-foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Go to definition"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] mb-1 uppercase tracking-wider">Dependents · local project</h4>
            {(!view.dependents || view.dependents.length === 0) ? (
              <span className="text-sm text-[var(--vscode-descriptionForeground)] italic">No local dependents found.</span>
            ) : (
              <ul className="space-y-1">
                {view.dependents.map((dependent: any, idx: number) => {
                  const id = typeof dependent === 'string' ? dependent : `${dependent.database}.${dependent.schema}.${dependent.name}`;
                  return (
                    <li key={idx} className="flex items-center text-sm group">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-stringForeground)] opacity-70 mr-2"></span>
                      <BigQueryTableLink id={dependent} label={id} />
                      <button
                        onClick={() => handleLineageNavigation(id)}
                        className="ml-2 p-1 text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-textLink-foreground)] opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Go to definition"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div>
            <h4 className="text-xs font-semibold text-[var(--vscode-descriptionForeground)] mb-1 uppercase tracking-wider">Dependents · Dataplex (downstream)</h4>
            {!state.dataform.lineage ? (
              <button onClick={handleLineageMetadata} disabled={loadingLineage} className={ROW_BUTTON}>
                {loadingLineage ? <Loader2 className="w-3 h-3 animate-spin" /> : <Network className="w-3 h-3" />}
                Load Dataplex Dependencies
              </button>
            ) : state.dataform.lineage.error ? (
              <div className="text-red-500 dark:text-red-400 text-sm">
                Error: {state.dataform.lineage.error.message || "Unknown error"}
              </div>
            ) : (!state.dataform.lineage.dependencies || state.dataform.lineage.dependencies.length === 0) ? (
              <span className="text-sm text-zinc-500 italic">No Dataplex dependents found.</span>
            ) : (
              <ul className="space-y-1">
                {state.dataform.lineage.dependencies.map((item: string, idx: number) => (
                  <li key={idx} className="flex items-center text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-2"></span>
                    <BigQueryTableLink id={item} />
                    {!localDependentIds.has(item) && (
                      <span className="ml-2 text-[10px] uppercase font-bold tracking-wider bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                        External
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SummaryRow>

        <SummaryRow
          label="Run"
          tone={runTone}
          summary={runSummary}
          actions={hasRunnableActions ? (
            <button
              onClick={() => handleRun(runBackend)}
              disabled={compiling || runningModel}
              className={ROW_PRIMARY_BUTTON}
              style={fullRefresh ? { background: FULL_REFRESH_COLOR, color: "var(--vscode-editor-background)" } : undefined}
              title={`Run this file's actions via the Dataform ${runBackend === "api" ? "API" : "CLI"}${[includeDependencies && ", with dependencies", includeDependents && ", with dependents", fullRefresh && ", full refresh"].filter(Boolean).join("")}`}
            >
              {runningModel ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run
            </button>
          ) : showTestRun ? (
            <button onClick={handleRunTest} disabled={compiling} className={ROW_PRIMARY_BUTTON}>
              <Play className="w-3 h-3" /> Run Tests
            </button>
          ) : undefined}
        >
          {canRun ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              {showTestRun && (
                <button onClick={handleRunTest} disabled={compiling} className={hasRunnableActions ? SECONDARY_BUTTON : PRIMARY_BUTTON}>
                  <Play className="w-4 h-4 mr-1.5" /> Run Tests
                </button>
              )}
              {(hasRunnableActions || hasTags) && (
                <div ref={tagPopoverRef} className="relative">
                  <RunSplitButton
                    backend={runBackend}
                    isRemoteMode={isRemoteMode}
                    hasTags={hasTags}
                    tagsOnly={!hasRunnableActions}
                    running={runningModel}
                    disabled={compiling}
                    onRun={handleRun}
                    onBackendChange={setPreferredBackend}
                    onRunTag={() => setTagPopoverOpen(true)}
                  />
                  {tagPopoverOpen && (
                    <div
                      role="dialog"
                      aria-label="Run by tag"
                      onKeyDown={handleTagPopoverKeyDown}
                      className="absolute top-full left-0 mt-1 z-20 w-[min(320px,calc(100vw-2rem))] p-3 rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] shadow-lg"
                    >
                      <p className="text-xs text-[var(--vscode-descriptionForeground)] mb-2">Select tag(s) to run via the Dataform {runBackend === "api" ? "API" : "CLI"}:</p>
                      <StyledMultiSelect
                        options={tagOptions}
                        value={selectedTagRunOptions}
                        onChange={(opts: MultiValue<OptionType>) => setSelectedTagsForRun(opts.map(o => o.value))}
                        onMenuOpen={() => setTagMenuOpen(true)}
                        onMenuClose={() => setTagMenuOpen(false)}
                        placeholder="Search and select tags..."
                        isSearchable
                        closeMenuOnSelect
                        blurInputOnSelect={false}
                        autoFocus
                      />
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--vscode-widget-border)]">
                        <button
                          onClick={() => setTagPopoverOpen(false)}
                          className="px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => { handleRunTag(); setTagPopoverOpen(false); }}
                          disabled={selectedTagsForRun.length === 0}
                          className="flex-1 justify-center px-3 py-1.5 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded flex items-center disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 mr-1.5" /> {runTagLabel}
                          <span className="ml-2 text-[10px] font-mono opacity-70">{runTagShortcutHint}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <RunChangedButton
                changedActions={state.dataform.changedActions}
                isRemoteMode={isRemoteMode}
                disabled={runningModel || compiling}
                includeDependencies={includeDependencies}
                includeDependents={includeDependents}
                fullRefresh={fullRefresh}
                onApiRunDispatched={() => setSubmittingSince(Date.now())}
              />
              {hasRunControls && (
                <div role="group" aria-label="Run modifiers" className="flex flex-wrap items-center gap-1.5">
                  <ModifierSwitch label="+Deps" checked={includeDependencies} onChange={setIncludeDependencies} title="Include dependencies (--include-deps)" />
                  <ModifierSwitch label="+Dependents" checked={includeDependents} onChange={setIncludeDependents} title="Include dependents (--include-dependents)" />
                  <ModifierSwitch label="Full Refresh" checked={fullRefresh} onChange={setFullRefresh} title="Rebuild incremental tables from scratch (--full-refresh)" warning />
                </div>
              )}
              {runsViaApi && (
                <div className="basis-full">
                  <ApiRunGitChip state={state.dataform.apiRunGitState} />
                </div>
              )}
            </div>
          ) : null}
        </SummaryRow>

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

      {shownBlock && (
        <>
          <div role="tablist" aria-label="Compiled SQL" className="sticky top-0 z-10 -mx-4 px-2 flex items-center gap-1 h-9 overflow-x-auto scrollbar-thin border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">
            {blocks.map((block) => (
              <button
                key={block.key}
                role="tab"
                aria-selected={block === shownBlock}
                onClick={() => setSqlTab(block.key)}
                title={block.failed ? `${block.target}: its dry run failed` : block.target}
                className={clsx(
                  "flex items-center gap-1.5 flex-shrink-0 h-6 px-2 rounded text-[12.5px] whitespace-nowrap border-0 transition-colors",
                  block === shownBlock
                    ? "bg-[var(--vscode-list-inactiveSelectionBackground,var(--vscode-toolbar-hoverBackground))] text-[var(--vscode-foreground)]"
                    : "bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
                )}
              >
                {block.failed && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-errorForeground,#f14c4c)]" />}
                {tabLabel(block)}
              </button>
            ))}
            <span className="ml-2 min-w-0 truncate text-[11px] font-mono text-[var(--vscode-descriptionForeground)] opacity-60">{shownBlock.target}</span>
          </div>
          <div role="tabpanel" className="-mx-4">
            {shownBlock.code ? (
              <CodeBlock key={shownBlock.key} code={shownBlock.code} language="sql" showLineNumbers errorAnnotations={shownBlock.annotations} />
            ) : (
              <p className="px-4 py-3 text-sm text-[var(--vscode-descriptionForeground)] italic">{shownBlock.none}</p>
            )}
          </div>
        </>
      )}
    </div>
  );
};
