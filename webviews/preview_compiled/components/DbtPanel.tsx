import React, { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, ChevronRight, Copy, Eye, Loader2, Network, Play, RotateCcw } from "lucide-react";
import { HeaderTab, PanelHeader, ReportIssueLink } from "./PanelHeader";
import { ProjectInfoTab, useProjectInfoRequest } from "./ProjectInfoTab";
import { ProjectLabel } from "./ProjectLabel";
import { RunChangedButton } from "./RunChangedButton";
import type { CompileError } from "../../../src/backend/backend";
import type { DbtBlock, PanelAction } from "../../../src/shared/panelContract";
import { DbtCard, DbtStatusLine, DbtTab, DbtView, LineageRow, dbtDryRunOf, dbtErrorFoot, dbtNameOf, dbtView, incrementalCase, targetText, testedBy } from "../../../src/shared/panelDbtView";
import { isMadeUpTarget, targetId } from "../../../src/shared/compiledGraph";
import { dryRunCostSummary } from "../../../src/shared/panelBigQueryView";
import { CopyTableIdButton, DryRunResult, KindBadge, LastUpdated, TargetAction, TargetRow } from "./TargetRow";
import { FULL_REFRESH_RING, RUN_GROUP, RUN_MAIN_PART, RUN_PART, RunModifiers, RunRow, TagRunPart } from "./RunParts";
import { ROW_BUTTON, ROW_TOKEN, ROW_TOKEN_SET, RowChip, RowTone, SummaryRow } from "./SummaryRow";
import { SqlBlock, SqlTabs, shownSqlBlock, sqlTabLabels } from "./SqlTabs";
import { LineageEntry, LineageLists } from "./LineageColumns";
import { formatAgo } from "./LastRunCard";
import { RunHistory, runFacts } from "./RunHistory";
import { RunStartSummary } from "./RunStages";
import { RunStatusPill, SHOW_RUN_DETAILS_EVENT } from "./RunStatusPill";
import { CancelWorkflowButton } from "./CancelWorkflowButton";
import { WorkflowActionsTable, getStatusIcon, useTick } from "./WorkflowActionsTable";
import { TERMINAL_WORKFLOW_STATES } from "../utils/workflowPolling";
import { BigQueryTableLink } from "../../components/BigQueryTableLink";
import { useNow } from "./CompilationInfoBadge";
import { formatRelativeTime } from "../utils/compilationInfoFormat";
import type { ColumnMetadata, WorkflowUrlEntry } from "../../../src/types";
import type { PanelSlices } from "../../../src/shared/panelState";
import { SchemaTable } from "./SchemaTab";
import { getUrlToNavigateToTableInBigQuery } from "../../utils/bigquery";
import { vscode } from "../utils/vscode";
import { DBT_SWITCH_TITLE, DeferralBanner } from "./DeferralBanner";
import { ModifierSwitch } from "./ModifierSwitch";

/*
 * The compiled-query panel of a dbt Project (decided in xf#52). What is drawn, and when, is worked out by `dbtView`
 * in src/shared/panelDbtView.ts; the components here only draw it. Nothing here reads the `dataform` block.
 */

const TAB_LABEL: Record<DbtTab, string> = { compiled: "Compiled query", schema: "Schema", runs: "Runs", project: "Project" };
const TAB_KEY: Record<string, DbtTab> = { c: "compiled", s: "schema", r: "runs", p: "project" };

const PRIMARY_BUTTON = "px-3 py-1.5 rounded text-sm bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]";
const SECONDARY_BUTTON = "px-3 py-1.5 rounded text-sm bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] border border-[var(--vscode-widget-border)]";
const BOX = "rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]";
const MUTED = "text-[var(--vscode-descriptionForeground)]";
const WARNING = "text-[var(--vscode-editorWarning-foreground,#cca700)]";
const ERROR = "text-[var(--vscode-errorForeground)]";

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** How long ago `startedAt` was, kept current while it is on show */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (startedAt === undefined) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, now - startedAt);
}

const engineLabel = (dbt: DbtBlock["dbt"]) => (dbt ? [dbt.flavour, dbt.version].filter(Boolean).join(" ") : "");

/** The name of the file on show, as a Dataform file's (CompiledQueryTab.tsx) */
function FileChip({ file }: { file: string }) {
  return (
    <span data-dbt="file" className={clsx("text-sm font-mono bg-[var(--vscode-editor-background)] border border-[var(--vscode-widget-border)] px-2 py-1 rounded break-all", MUTED)}>
      {file || " "}
    </span>
  );
}

function ToolMissing({ view, looking }: { view: DbtView; looking: boolean }) {
  return (
    <div className="p-4 space-y-4">
      <div><FileChip file={view.file} /></div>
      <h2 className="text-lg font-semibold m-0">dbt was not found for this Project</h2>
      {view.lookedIn.length > 0 && (
        <div>
          <div className="text-sm mb-1.5">Looked in, in this order:</div>
          <ol className={clsx("text-xs font-mono space-y-1 list-none p-0 m-0", MUTED)}>
            {view.lookedIn.map((place, index) => (
              <li key={index}>✕&nbsp;&nbsp;{place}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className={clsx(BOX, "p-3")}>
          <div className={clsx("text-xs mb-1", MUTED)}>dbt-core with BigQuery</div>
          <pre className="m-0 text-xs font-mono whitespace-pre-wrap">pip install dbt-core dbt-bigquery</pre>
        </div>
        <div className={clsx(BOX, "p-3")}>
          <div className={clsx("text-xs mb-1", MUTED)}>dbt v2</div>
          <pre className="m-0 text-xs font-mono whitespace-pre-wrap">brew install dbt-labs/dbt/dbt</pre>
        </div>
      </div>
      <ToolButtons looking={looking} />
    </div>
  );
}

function ToolButtons({ looking }: { looking: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={PRIMARY_BUTTON} onClick={() => vscode.postMessage({ command: "dbt.chooseExecutable" })}>
        Choose a dbt executable…
      </button>
      <button className={SECONDARY_BUTTON} disabled={looking} onClick={() => vscode.postMessage({ command: "dbt.lookForDbtAgain" })}>
        Look again
      </button>
      {looking && <span className={clsx("text-xs", MUTED)}>Looking for dbt…</span>}
    </div>
  );
}

/**
 * The dbt target in use, and the way to choose another (xf#50): a name of the Project's profile, or a typed one when
 * the profile could not be read. The choice is the user's own for this workspace; the way back is to the default.
 */
function TargetControl({ block }: { block: DbtBlock }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const { target } = block;
  const choose = (name: string | null) => {
    setOpen(false);
    setTyped("");
    vscode.postMessage({ command: "dbt.setTarget", name });
  };
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const backTo = target.setting ?? target.profileDefault;
  return (
    <div data-dbt="target" className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={target.overridden ? "Your own choice for this workspace. It overrides the dbtTarget setting" : "Choose the dbt target to compile and run with"}
        className={clsx(ROW_TOKEN, "cursor-pointer")}
        style={target.overridden ? ROW_TOKEN_SET : undefined}
      >
        <span className={MUTED}>dbt target</span>
        <span className="font-mono">{target.name ?? "dbt's default"}</span>
        {target.overridden && <span className={clsx("text-[10px] uppercase tracking-wider", WARNING)}>override</span>}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute left-0 mt-1 w-64 z-20 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-sideBar-background))] shadow-lg p-1.5 text-sm">
            {target.names.length > 0 ? (
              target.names.map((name) => (
                <button
                  key={name}
                  type="button"
                  role="menuitemradio"
                  aria-checked={name === target.name}
                  onClick={() => choose(name)}
                  className={clsx("w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border-0 cursor-pointer text-left text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]", name === target.name ? "bg-[var(--vscode-list-inactiveSelectionBackground,rgba(128,128,128,0.2))]" : "bg-transparent")}
                >
                  <span className="font-mono text-xs">{name}</span>
                  <span className={clsx("text-[11px]", MUTED)}>{[name === target.profileDefault && "profile default", name === target.setting && "setting"].filter(Boolean).join(" · ")}</span>
                </button>
              ))
            ) : (
              <form
                className="p-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (typed.trim()) {
                    choose(typed.trim());
                  }
                }}
              >
                <div className={clsx("text-xs mb-1.5", MUTED)}>profiles.yml could not be read, so type a name</div>
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder="dbt target name"
                    aria-label="dbt target name"
                    className="min-w-0 flex-1 px-2 py-1 rounded font-mono text-xs bg-[var(--vscode-input-background)] text-[var(--vscode-input-foreground)] border border-[var(--vscode-input-border,var(--vscode-widget-border))]"
                  />
                  <button type="submit" className={SECONDARY_BUTTON} disabled={!typed.trim()}>
                    Use
                  </button>
                </div>
              </form>
            )}
            <div className={clsx("border-t border-[var(--vscode-widget-border)] mt-1 pt-1.5 px-2 pb-1 text-xs space-y-1", MUTED)}>
              {target.overridden && (
                <button type="button" className={clsx("p-0 bg-transparent border-0 cursor-pointer underline text-xs", WARNING)} onClick={() => choose(null)}>
                  Back to the default{backTo ? ` (${backTo})` : ""}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** A file of the Project, and a line of it where dbt gave one, as a link that opens it there */
function FileLink({ error, className }: { error: CompileError; className?: string }) {
  if (!error.fileName) {
    return null;
  }
  const at = [error.fileName, error.line].filter((part) => part !== undefined).join(":");
  return (
    <button
      type="button"
      title={`Open ${at}`}
      className={clsx("p-0 bg-transparent border-0 cursor-pointer font-mono text-xs text-[var(--vscode-textLink-foreground)] hover:underline", className)}
      onClick={() => vscode.postMessage({ command: "openFile", file: error.fileName!, ...(error.line !== undefined ? { line: error.line } : {}) })}
    >
      {at}
    </button>
  );
}

function ErrorCard({ error, flavour }: { error: CompileError; flavour?: "dbt-core" | "dbt v2" }) {
  return (
    <div data-dbt="compile error" className="rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={clsx("font-semibold", ERROR)}>Compile error</span>
        {error.code && <span className={clsx("font-mono", MUTED)}>{error.code}</span>}
        <FileLink error={error} className="ml-auto" />
      </div>
      <pre className="mt-2 mb-0 text-xs font-mono whitespace-pre-wrap break-words">{error.message}</pre>
      {error.sourceContext && <pre className={clsx("mt-2 mb-0 text-xs font-mono whitespace-pre overflow-x-auto", MUTED)}>{error.sourceContext}</pre>}
      <div className={clsx("mt-2 text-xs", MUTED)}>{dbtErrorFoot(error, flavour)}</div>
    </div>
  );
}

const LINK = "p-0 bg-transparent border-0 cursor-pointer text-left font-mono text-xs text-[var(--vscode-textLink-foreground)] hover:underline break-all";

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const NO_SQL: Partial<Record<PanelAction["kind"], string>> = {
  seed: "A seed is a CSV file dbt loads as a table. It has no SQL.",
  source: "A source is read, not built. It has no SQL.",
  exposure: "An exposure is something downstream of the Project. It has no SQL.",
  "unit test": "A unit test has no SQL of its own: dbt builds it from the rows it is given when it runs.",
};

const isTestKind = (action: PanelAction) => action.kind === "test" || action.kind === "unit test";
/** The action's own query, apart from its hooks */
const queryOf = (action: PanelAction) => action.sections.find((section) => section.title === "query" || section.title === "operation");

/**
 * One action in the Target row, as a Dataform action's (CompiledQueryTab.tsx): its kind, where it builds, when that
 * table last changed, what its dry run would scan and cost, and the dry run's error.
 */
function DbtTargetAction({ state, view, action, separated }: { state: PanelSlices; view: DbtView; action: PanelAction; separated: boolean }) {
  const query = queryOf(action);
  const asWritten = !!query && !query.compiled;
  const { running, result } = dbtDryRunOf(state, action);
  const failed = result?.error;
  const bigQuery = state.dbt?.bigQuery !== false;
  const which = incrementalCase(state, action);
  const table = state.bigquery && state.file && state.bigquery.compile === state.file.compile ? state.bigquery.tables[action.id] : undefined;
  const link = action.buildsTable && bigQuery;
  const { database, schema, name } = action.target;
  // A test builds nothing either, but that needs no saying
  const buildsNothing = !action.buildsTable && action.kind !== "test" && action.kind !== "unit test" && action.kind !== "source";
  const tested = testedBy(state, view.actions, action);
  const lastUpdated: LastUpdated | undefined = !link || !table ? undefined
    : table.missing ? { none: "Not built yet: BigQuery has no such table." }
    : table.lastModified ? { time: table.lastModified, today: !!table.modifiedToday }
    : { unknown: table.error ?? "BigQuery gave no time" };
  return (
    <TargetAction
      data-dbt="action"
      data-kind={action.kind}
      separated={separated}
      lastUpdated={lastUpdated}
      // No compiled SQL, so no cost. Why is said once for the file, in the Compile row
      dryRun={view.outdated ? <span className="ml-auto"><RowChip tone="warning" title="Of the compile before the one that runs now">outdated</RowChip></span> : asWritten ? null : <DryRunResult running={running} stat={dryRunCostSummary(result, "", state.bigquery?.currencySymbol ?? "$")} />}
      error={failed && !view.outdated ? failed.message : undefined}
      errorTitle="Shown here only. Nothing is marked in the source file."
      head={<>
        <KindBadge kind={action.kind} />
        {action.disabled && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">disabled</span>}
        {link ? (
          <>
            <BigQueryTableLink
              id={action.target}
              showIcon={true}
              className="flex items-center min-w-0 break-all font-mono text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-foreground)] hover:underline transition-colors"
              fallbackClassName="flex items-center font-mono text-[var(--vscode-errorForeground)]"
            />
            <CopyTableIdButton onCopy={() => vscode.postMessage({ command: "copyToClipboard", text: `\`${database}.${schema}.${name}\`` })} />
          </>
        ) : (
          <span className="font-mono font-semibold text-[var(--vscode-foreground)] break-all">{dbtNameOf(state, action)}</span>
        )}
        {buildsNothing && <span className={clsx("text-xs", MUTED)}>builds nothing</span>}
        {tested && (
          <span data-dbt="tested" className={clsx("flex items-center gap-x-1.5 text-xs", MUTED)}>
            tests
            {tested.fileName ? (
              <button type="button" title={`Open ${tested.fileName}`} className={LINK} onClick={() => vscode.postMessage({ command: "openAction", action: tested.target })}>
                {tested.name}
              </button>
            ) : (
              <span className="font-mono">{tested.name}</span>
            )}
          </span>
        )}
        {action.fileName && action.fileName !== view.file && <span className={clsx("text-xs font-mono opacity-80", MUTED)}>{action.fileName}</span>}
      </>}
    >
      {action.kind === "incremental" && action.sqlPresent && (
        <div data-dbt="incremental" className={clsx("text-xs", MUTED)}>
          {which === "incremental"
            ? "dbt compiled the incremental case, because the table already exists."
            : which === "full build"
              ? "dbt compiled the full build, because the table does not exist yet."
              : "dbt compiled one case of this model: the incremental one if the table already exists, the full build if it does not."}
        </div>
      )}
      {action.sections.length === 0 && <div className={clsx("text-xs", MUTED)}>{NO_SQL[action.kind] ?? "No SQL to show."}</div>}
    </TargetAction>
  );
}

/**
 * The tests among the file's actions, as one line of the Target row that opens to each of them: a model with a few
 * tests would otherwise have the SQL start far down. A test whose dry run failed opens the line by itself; a line
 * the user opened or closed stays as they left it.
 */
function FoldedTests({ state, view, tests, separated, others }: { state: PanelSlices; view: DbtView; tests: PanelAction[]; separated: boolean; others: boolean }) {
  // null: follows the problem. Otherwise what the user chose
  const [chosen, setChosen] = useState<boolean | null>(null);
  const dryRuns = view.outdated ? [] : tests.map((test) => dbtDryRunOf(state, test));
  const failed = dryRuns.filter((dryRun) => dryRun.result?.error).length;
  const running = dryRuns.some((dryRun) => dryRun.running);
  const open = chosen ?? failed > 0;
  const unitTests = tests.filter((test) => test.kind === "unit test").length;
  return (
    <div data-dbt="tests" className={clsx(separated && "!mt-2.5 pt-2.5 border-t border-[var(--vscode-widget-border)]")}>
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Hide the tests" : "Show each test, with what its dry run said"}
        onClick={() => setChosen(!open)}
        className="flex items-center gap-1.5 w-full min-h-[22px] p-0 border-0 bg-transparent text-left text-[var(--vscode-foreground)] cursor-pointer hover:opacity-80 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
        <span>
          {/* Beside the file's own test, which is in full above */}
          {others ? counted(tests.length, "other test", "other tests") : counted(tests.length, "test", "tests")}
          {unitTests > 0 && unitTests < tests.length && <span className={MUTED}> · {counted(unitTests, "unit test", "unit tests")} among them</span>}
        </span>
        {failed > 0 && <RowChip tone="error">{failed} failed the dry run</RowChip>}
        {running && <RowChip tone="busy"><Loader2 className="w-2.5 h-2.5 animate-spin" /> dry run…</RowChip>}
      </button>
      {open && tests.map((test) => <DbtTargetAction key={test.id} state={state} view={view} action={test} separated />)}
    </div>
  );
}

/** What the Target row says of a file with no SQL to show: what the thing is, and a few details */
function TargetCard({ card }: { card: DbtCard }) {
  return (
    <div data-dbt="card" className="space-y-1.5">
      <div className="font-semibold leading-[22px]">{card.title}</div>
      <dl className="m-0 grid grid-cols-[minmax(80px,max-content)_1fr] gap-x-4 gap-y-1 text-xs">
        {card.rows.map((row, index) => (
          <React.Fragment key={index}>
            <dt className={MUTED}>{row.label}</dt>
            <dd className="m-0 font-mono break-all self-center">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {card.foot && <div className={clsx("text-xs", MUTED)}>{card.foot}</div>}
    </div>
  );
}

const isRunning = (status: DbtStatusLine | undefined): status is Extract<DbtStatusLine, { kind: "first compile" | "recompiling" }> =>
  status?.kind === "first compile" || status?.kind === "recompiling";

const errorCount = (view: DbtView) =>
  [view.errors.length > 0 && counted(view.errors.length, "error", "errors"), view.errorsElsewhere.length > 0 && `${view.errorsElsewhere.length} elsewhere`].filter(Boolean).join(" · ");

/**
 * The line of the Compile row, as Dataform's (CompiledQueryTab.tsx): the engine that compiled, how long it took, how
 * long ago, and the dbt target. What is not as it is by default is a chip. While dbt works, and when the compile
 * failed, the line says so.
 */
function CompileSummary({ view, block }: { view: DbtView; block: DbtBlock | undefined }) {
  const now = useNow(30_000);
  const status = view.status;
  const running = isRunning(status);
  const elapsed = useElapsed(running ? status.startedAt : undefined);
  if (!status) {
    return <span className={MUTED}>—</span>;
  }
  if (running) {
    return (
      <span data-status={status.kind}>
        <Loader2 className="inline w-3.5 h-3.5 mr-1.5 align-middle animate-spin text-[var(--vscode-textLink-foreground)]" />
        <span className="align-middle">{status.text}</span>
        <span className={clsx("align-middle ml-2 font-mono text-xs", MUTED)}>{[status.command, seconds(elapsed)].filter(Boolean).join(" · ")}</span>
      </span>
    );
  }
  if (status.kind === "failed" || view.errors.length > 0) {
    return <span data-status="failed">{["Compilation failed", errorCount(view)].filter(Boolean).join(" · ")}</span>;
  }
  if (status.kind === "waiting") {
    return <span data-status={status.kind} className={MUTED}>{status.text}</span>;
  }
  const took = status.kind === "parsed" ? "parsed" : status.durationMs !== undefined ? `${(status.durationMs / 1000).toFixed(2)}s` : undefined;
  const target = block?.target;
  return (
    <span data-status={status.kind}>
      {view.parsedOnly && <RowChip tone="warning" title="The Project has on-run hooks, so it was parsed and not compiled: the SQL is as written">parsed only</RowChip>}
      {view.otherWarehouse && <RowChip tone="warning" title={`The Project's profile targets ${view.otherWarehouse}. The extension supports BigQuery`}>not BigQuery</RowChip>}
      {target?.overridden && <RowChip tone="warning" title="Your own choice for this workspace. It overrides the dbtTarget setting">dbt target {target.name} · override</RowChip>}
      {block?.deferToProd?.enabled && <RowChip tone="warning" title={block.deferToProd.available ? "Upstream tables that are not built in your dbt target are read from prod (dbt --defer)" : `On but not applied. ${block.deferToProd.reason ?? ""}`}>defer to prod</RowChip>}
      {view.errorsElsewhere.length > 0 && <RowChip tone="error" title="Compile errors in other files of the Project">{counted(view.errorsElsewhere.length, "error", "errors")} elsewhere</RowChip>}
      <span className="align-middle" title={`${status.kind === "compiled" ? "Compiled" : "Parsed"} at ${new Date(status.compiledAt).toLocaleString()}`}>
        {[engineLabel(block?.dbt) || "dbt", took, formatRelativeTime(status.compiledAt, now), target && !target.overridden && `dbt target ${target.name ?? "dbt's default"}`].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

/** The Compile row of a dbt file: how the SQL was made, what changes what it says, and what went wrong */
function CompileRow({ state, view }: { state: PanelSlices; view: DbtView }) {
  const block = state.dbt;
  const notice = state.settled?.status === "parsed only" ? state.settled.notice : undefined;
  const running = isRunning(view.status);
  const failed = !running && (view.status?.kind === "failed" || view.errors.length > 0);
  const tone: RowTone = running ? "busy" : failed ? "error" : view.parsedOnly || block?.target.overridden || block?.deferToProd?.enabled || view.errorsElsewhere.length > 0 ? "warning" : "calm";
  // Follows the setting, but flips at the click, before the compile that follows has told the panel
  const [deferOn, setDeferOn] = useState(!!block?.deferToProd?.enabled);
  useEffect(() => setDeferOn(!!block?.deferToProd?.enabled), [block?.deferToProd?.enabled]);
  const toggleDefer = (checked: boolean) => {
    setDeferOn(checked);
    vscode.postMessage({ command: "dbt.toggleDeferToProd", on: checked });
  };
  const hasBody = !!block || view.parsedOnly || !!view.otherWarehouse || view.errors.length + view.errorsElsewhere.length > 0;
  return (
    <SummaryRow
      label="Compile"
      tone={tone}
      summary={<CompileSummary view={view} block={block} />}
      // Open, the tokens under the line say how it compiled: the line names the file they are of
      openSummary={failed || running ? undefined : (
        <span className="flex items-center gap-2 min-w-0">
          <span data-dbt="file" className={clsx("truncate font-mono text-xs", MUTED)} title={view.file}>{view.file || " "}</span>
          <ProjectLabel project={state.project} className="flex-shrink-0" />
        </span>
      )}
    >
      {hasBody && (
        <>
          {block && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <TargetControl block={block} />
              <span className={clsx("text-xs", MUTED)} title="vars and profiles dir are set in settings">
                vars <span className="font-mono text-[var(--vscode-foreground)]">{block.vars ?? "none"}</span>
                {" · "}
                profiles dir <span className="font-mono text-[var(--vscode-foreground)]">{block.profilesDir ?? "dbt's default"}</span>
              </span>
              {block.deferToProd && <ModifierSwitch chip label="Defer to prod" checked={deferOn} onChange={toggleDefer} title={DBT_SWITCH_TITLE} />}
            </div>
          )}
          {block?.deferToProd && <DeferralBanner dbt bare on={deferOn} deferral={block.deferral} deferToProd={block.deferToProd} />}
          {view.parsedOnly && (
            <div data-dbt="parsed only" className="text-xs">
              <p className="m-0"><span className={clsx("font-semibold", WARNING)}>Parsed, not compiled.</span> {notice} So the SQL below is as written, and nothing is dry-run.</p>
              <button className={clsx(ROW_BUTTON, "mt-1.5 border-0")} disabled={view.outdated || view.skeleton} onClick={() => vscode.postMessage({ command: "dbt.compileWithHooks", on: true })}>
                Compile with hooks: they will run on every save
              </button>
            </div>
          )}
          {view.otherWarehouse && (
            <p data-dbt="not bigquery" className="m-0 text-xs">
              This Project's profile targets <span className="font-mono">{view.otherWarehouse}</span>. The extension supports BigQuery, so dry run, cost, schema, preview and run are not offered here.
            </p>
          )}
          {view.errors.map((error, index) => (
            <ErrorCard key={index} error={error} flavour={block?.dbt?.flavour} />
          ))}
          {view.errorsElsewhere.length > 0 && (
            <div data-dbt="errors elsewhere" className="text-xs">
              <div className="mb-1">
                <span className={ERROR}>●</span> {counted(view.errorsElsewhere.length, "error", "errors")} elsewhere in the Project
              </div>
              <ul className="m-0 p-0 list-none space-y-1 font-mono">
                {view.errorsElsewhere.map((error, index) => (
                  <li key={index}>
                    <FileLink error={error} />{" "}
                    <span className={MUTED}>
                      {error.message.split("\n")[0]}
                      {error.code ? `  (${error.code})` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </SummaryRow>
  );
}

/** A neighbour as a line of the lineage lists: under its dataset where it is a table, with its kind said */
function lineageEntry(row: LineageRow, ofTests = false): LineageEntry {
  const { database, schema, name } = row.target;
  return {
    id: targetId(row.target),
    dataset: ofTests || isMadeUpTarget(row.target) ? "" : [database, schema].filter(Boolean).join("."),
    name: row.name,
    url: row.buildsTable ? getUrlToNavigateToTableInBigQuery(database, schema, name) : null,
    tags: [
      // Under "Tests" a test needs no saying
      ...(ofTests && row.kind === "test" ? [] : [{ text: row.kind }]),
      ...(row.package ? [{ text: `package ${row.package}`, title: `In the installed package ${row.package}, not in this Project` }] : []),
    ],
    ...(row.fileName ? { open: () => vscode.postMessage({ command: "openAction", action: row.target }) } : {}),
  };
}

/** A block of SQL of the tabs, with the action and the section it is of */
interface DbtSqlBlock extends SqlBlock {
  action: PanelAction;
}

/** How Dataform's panel names a block of SQL, for dbt's sections */
function sectionLabel(action: PanelAction, title: string): string {
  return /^pre-hook/.test(title) ? title.replace("pre-hook", "Pre-hook") : /^post-hook/.test(title) ? title.replace("post-hook", "Post-hook") : isTestKind(action) ? "Test" : action.kind === "operation" ? "Hook" : "Query";
}

/** The SQL of the file's actions: a tab for each section. The query of the first action is the one on show */
function sqlBlocks(state: PanelSlices, view: DbtView): DbtSqlBlock[] {
  return view.actions.flatMap((action) => {
    const query = queryOf(action);
    const failed = view.outdated ? undefined : dbtDryRunOf(state, action).result?.error;
    return action.sections.map((section): DbtSqlBlock => {
      const isQuery = section === query;
      return {
        key: `${action.id}/${section.title}`,
        label: sectionLabel(action, section.title),
        target: targetText(action.target),
        code: section.sql,
        main: isQuery,
        none: "No SQL.",
        failed: isQuery && !!failed,
        ...(isQuery && failed?.line && failed.section === section.title ? { annotations: [{ line: failed.line, message: failed.message }] } : {}),
        ...(section.compiled ? {} : { note: { text: "as written", title: "dbt has not compiled this: it is the SQL as it is in the file" } }),
        action,
      };
    });
  });
}

/**
 * The Compiled query tab of a dbt file, in the rows of a Dataform file's (CompiledQueryTab.tsx): Target, Compile,
 * Lineage, Run and Last run, then the SQL as tabs. A run is `dbt build` in the extension's terminal (xf#54): the
 * panel knows what was sent, and, where the run's BigQuery jobs are followed, what they did and how the run ended.
 */
/** The runs of the Project on show that are in the history, oldest first */
function dbtRunsOf(state: PanelSlices): WorkflowUrlEntry[] {
  const root = state.project?.root;
  return (state.dataform.workflowUrls ?? []).filter((entry) => entry.executionMode === "dbt" && entry.dbt?.root === root);
}

function CompiledTab({ state, view }: { state: PanelSlices; view: DbtView }) {
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [chosenTags, setChosenTags] = useState<string[]>([]);
  const [sqlTab, setSqlTab] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const now = useNow(30_000);
  const block = state.dbt;
  const bigQuery = block?.bigQuery !== false;
  const scope = { includeDependencies, includeDependents, fullRefresh };

  // ---- The SQL: one tab for each query the file compiles to
  const blocks = sqlBlocks(state, view);
  const shownBlock = shownSqlBlock(blocks, sqlTab);
  const names = new Map(blocks.map((each) => [each.key, dbtNameOf(state, each.action)]));
  const tabLabel = sqlTabLabels(blocks, (each) => names.get(each.key) ?? each.target);

  // ---- Lineage: what the file's actions read, what reads them and what tests them
  const lineage = view.lineage;
  const ofTestsOnly = !!lineage && lineage.subjects.every((subject) => subject.ofTests);
  // The graph centres on the file's first action, and is drawn from a parse, so it needs no compiled SQL
  const canGraph = view.actions.length > 0;
  // Preview Data runs the query of the action whose SQL is on show. A test's rows are those that fail it
  const previewed = shownBlock?.action;
  const previewQuery = previewed && queryOf(previewed);
  const canPreview = bigQuery && !!previewQuery && previewQuery.compiled && previewQuery.dryRun.length > 0;
  const ofTest = !!previewed && isTestKind(previewed);

  // ---- Run: `dbt build` of the file's actions, of tags, or of what changed
  const run = view.run;
  const tags = bigQuery ? state.project?.tags ?? [] : [];
  const selectedTags = chosenTags.filter((tag) => tags.includes(tag));
  // Run Tag and Run Changed are of the Project, so they are offered on a file that defines nothing to run too
  const changedActions = view.changedActions;
  const canRun = !!run || !!changedActions || tags.length > 0;
  const noDbt = !block?.dbt;
  const modifiersSaid = [includeDependencies && ", with dependencies", includeDependents && ", with dependents", fullRefresh && ", full refresh"].filter(Boolean).join("");

  const lastRun = state.run?.lastRun;
  // The newest run in the history is the last one sent, where its jobs are followed. After a reload it is all that is known of it
  const followed = dbtRunsOf(state).pop();
  const lastEntry = followed && (!lastRun || followed.timestamp >= lastRun.startedAt - 1000) ? followed : undefined;
  const lastCommand = lastRun?.command ?? lastEntry?.dbt?.command;
  const lastEnded = !!lastEntry?.state && TERMINAL_WORKFLOW_STATES.has(lastEntry.state);
  useTick(!!lastEntry && !lastEnded);
  const lastJobs = lastEntry?.actions?.filter((row) => row.jobId).length ?? 0;
  const lastNodes = (lastEntry?.actions?.length ?? 0) - lastJobs;
  // The pill in the header asks for the run's details
  const [detailsAsked, setDetailsAsked] = useState(0);
  useEffect(() => {
    const show = () => setDetailsAsked((asked) => asked + 1);
    window.addEventListener(SHOW_RUN_DETAILS_EVENT, show);
    return () => window.removeEventListener(SHOW_RUN_DETAILS_EVENT, show);
  }, []);

  // ---- Target: the tests are one line that opens. The one test of a file that defines nothing else is what the
  // file is for, so it is in full
  const own = view.actions.filter((action) => action.fileName === view.file);
  const subject = own.length === 1 && isTestKind(own[0]) ? own[0] : undefined;
  const folded = view.actions.filter((action) => isTestKind(action) && action !== subject);
  const inFull = view.actions.filter((action) => !folded.includes(action));

  return (
    <div className="pb-20">
      {/* The panel's padding is taken back: the rows run from edge to edge */}
      <div className="-mx-4 -mt-4">
        <TargetRow>
          {inFull.map((action, index) => (
            <DbtTargetAction key={action.id} state={state} view={view} action={action} separated={index > 0} />
          ))}
          {folded.length > 0 && <FoldedTests state={state} view={view} tests={folded} separated={inFull.length > 0} others={!!subject} />}
          {view.card && <TargetCard card={view.card} />}
        </TargetRow>

        <CompileRow state={state} view={view} />

        <SummaryRow
          label="Lineage"
          tone={lineage ? "calm" : "off"}
          wide
          summary={!lineage ? "—" : (
            <span data-dbt="lineage">
              {[
                `reads from ${lineage.counts.dependencies}`,
                !ofTestsOnly && `read by ${lineage.counts.dependents}`,
                lineage.counts.tests > 0 && counted(lineage.counts.tests, "test", "tests"),
              ].filter(Boolean).join(" · ")}
            </span>
          )}
          actions={(canGraph || canPreview) && <>
            {canGraph && (
              <button type="button" className={clsx(ROW_BUTTON, "border-0")} title="Open the dependency graph of the project, centred on this file" onClick={() => vscode.postMessage({ command: "showDependencyGraph" })}>
                <Network className="w-3 h-3" /> Graph
              </button>
            )}
            {canPreview && (
              <button
                type="button"
                className={clsx(ROW_BUTTON, "border-0")}
                disabled={view.outdated}
                title={ofTest ? `Runs the query of the test ${dbtNameOf(state, previewed!)} and shows the rows that fail it. It costs what the query costs` : `Runs the compiled query of ${dbtNameOf(state, previewed!)} and shows its rows. It costs what the query costs`}
                onClick={() => vscode.postMessage({ command: "preview", action: previewed!.target, section: previewQuery!.title })}
              >
                <Eye className="w-3 h-3" /> {ofTest ? "Preview failing rows" : "Preview Data"}
              </button>
            )}
          </>}
        >
          {lineage && (
            <LineageLists
              reads={lineage.subjects.flatMap((subject) => subject.dependencies).map((row) => lineageEntry(row))}
              readBy={lineage.subjects.flatMap((subject) => subject.dependents).map((row) => lineageEntry(row))}
              tests={lineage.subjects.flatMap((subject) => subject.tests).map((row) => lineageEntry(row, true))}
              // Nothing reads a test
              noneReadBy={ofTestsOnly ? undefined : "Nothing in this Project"}
            />
          )}
        </SummaryRow>

        <RunRow off={canRun ? undefined : "nothing to run in this file"}>
          <RunModifiers
            includeDependencies={includeDependencies}
            includeDependents={includeDependents}
            fullRefresh={fullRefresh}
            onIncludeDependencies={setIncludeDependencies}
            onIncludeDependents={setIncludeDependents}
            onFullRefresh={setFullRefresh}
            titles={{
              dependencies: "Also build what these actions read from (a + in front of the selection)",
              dependents: "Also build what reads from these actions (a + behind the selection)",
              fullRefresh: "Rebuild incremental models from scratch (--full-refresh)",
            }}
          />
          <div className="relative flex items-center gap-1.5 ml-auto">
            <div role="group" aria-label="Run" className={RUN_GROUP}>
              {tags.length > 0 && (
                <TagRunPart
                  tags={tags}
                  selected={selectedTags}
                  onSelect={(update) => setChosenTags((chosen) => update(chosen.filter((tag) => tags.includes(tag))))}
                  onRun={() => vscode.postMessage({ command: "runTags", tags: selectedTags, ...scope })}
                  disabled={noDbt}
                  title="Pick tag(s) to build with dbt, in the terminal"
                  via="with dbt build"
                  className={run ? RUN_PART : RUN_MAIN_PART}
                />
              )}
              {changedActions && (
                <RunChangedButton compact className={RUN_PART} backend="dbt" changedActions={changedActions} disabled={noDbt} includeDependencies={includeDependencies} includeDependents={includeDependents} fullRefresh={fullRefresh} />
              )}
              {run && (
                <button
                  type="button"
                  data-dbt="run"
                  onClick={() => vscode.postMessage({ command: "run", actions: run.targets, ...scope })}
                  disabled={run.blocked !== undefined}
                  style={fullRefresh ? FULL_REFRESH_RING : undefined}
                  title={run.blocked ?? `Run this file's actions with dbt build, in the terminal, into the dbt target ${block?.target.name ?? "dbt chooses"}${modifiersSaid}`}
                  className={RUN_MAIN_PART}
                >
                  <Play className="w-3 h-3" /> File
                </button>
              )}
            </div>
          </div>
        </RunRow>

        <SummaryRow
          label="Last run"
          tone={lastEntry?.state === "FAILED" ? "error" : "calm"}
          openRequest={detailsAsked}
          summary={lastEntry ? (
            <span data-dbt="last run" data-run={lastEntry.state || "UNKNOWN"} title={lastCommand} className="inline-flex items-center gap-1.5 min-w-0 max-w-full align-middle">
              <span className="flex-shrink-0" title={`Status: ${lastEntry.state || "UNKNOWN"}`}>{getStatusIcon(lastEntry.state)}</span>
              <span className="truncate">{runFacts(lastEntry) || (lastEntry.state ?? "unknown").toLowerCase()} · {formatAgo(lastEntry.timestamp, now)} · <span className="font-mono">{lastCommand}</span></span>
            </span>
          ) : lastRun ? (
            <span data-dbt="last run" title={lastRun.command}>sent to terminal · {formatAgo(lastRun.startedAt, now)} · <span className="font-mono">{lastRun.command}</span></span>
          ) : (
            <span className={MUTED}>No run yet</span>
          )}
          wide
          actions={(lastRun || lastEntry) && (
            <>
              {lastEntry && <CancelWorkflowButton entry={lastEntry} />}
              {lastRun && (
                <button type="button" className={clsx(ROW_BUTTON, "border-0")} title="Runs the same selection again, with the dbt target of now" onClick={() => vscode.postMessage({ command: "repeatLastRun" })}>
                  <RotateCcw className="w-3 h-3" /> Again
                </button>
              )}
            </>
          )}
        >
          {lastCommand && (
            <>
              <div className="flex items-start gap-2">
                <pre className="flex-1 min-w-0 m-0 px-2 py-1.5 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-textCodeBlock-background,var(--vscode-sideBar-background))] font-mono text-xs whitespace-pre-wrap break-all">{lastCommand}</pre>
                <button
                  type="button"
                  className={clsx(ROW_BUTTON, "border-0 flex-shrink-0")}
                  title="Copy the command"
                  onClick={() => {
                    vscode.postMessage({ command: "copyToClipboard", text: lastCommand });
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy
                </button>
              </div>
            {lastEntry && (
              <div data-dbt="last run jobs" className="mt-2 flex flex-col gap-1.5">
                {lastEntry.jobsNote && <div className={clsx("text-[11px]", MUTED)}>{lastEntry.jobsNote}</div>}
                {lastJobs === 0 && !lastEntry.jobsNote && (
                  <div data-dbt="no jobs yet" className={clsx("text-[11px]", MUTED)}>
                    {lastEnded ? "The run started no BigQuery job."
                      : lastNodes > 0 ? `No BigQuery job yet: dbt is at work on ${lastNodes === 1 ? "1 node" : `${lastNodes} nodes`} and has sent BigQuery no query.`
                        : "Waiting for dbt to start on its first node…"}
                  </div>
                )}
                <RunStartSummary entry={lastEntry} />
                <div className="-mx-3">
                  <WorkflowActionsTable entry={lastEntry} className="max-h-[28rem] overflow-auto" />
                </div>
              </div>
            )}
            </>
          )}
        </SummaryRow>
      </div>

      {shownBlock && <SqlTabs blocks={blocks} shown={shownBlock} onShow={setSqlTab} labelOf={tabLabel} dimmed={view.outdated} />}
      {view.skeleton && (
        <div data-dbt="skeleton" className="pt-4 space-y-2 animate-pulse">
          {[80, 62, 91, 48, 70].map((width) => (
            <div key={width} className="h-3 rounded bg-[var(--vscode-foreground)] opacity-10" style={{ width: `${width}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The columns of a dbt action as BigQuery gives a schema: those of the dry run of its compiled query, each with the
 * description its YAML gives where BigQuery has none. Until the dry run is back, the columns the YAML describes,
 * without types.
 */
function schemaFields(action: PanelAction, fromDryRun: ColumnMetadata[] | undefined): ColumnMetadata[] {
  const described = new Map((action.columns ?? []).map((column) => [column.path.join("."), column.description]));
  if (!fromDryRun) {
    return (action.columns ?? []).filter((column) => column.path.length === 1).map((column) => ({ name: column.path[0], type: "", description: column.description }));
  }
  const withDescriptions = (fields: ColumnMetadata[], prefix: string): ColumnMetadata[] =>
    fields.map((field) => {
      const path = prefix + field.name;
      return { ...field, description: field.description || described.get(path), ...(field.fields ? { fields: withDescriptions(field.fields, `${path}.`) } : {}) };
    });
  return withDescriptions(fromDryRun, "");
}

/** One action's table on the Schema tab: the same table as a Dataform file has, with a line saying where its columns come from */
function ActionSchema({ state, action, alone }: { state: PanelSlices; action: PanelAction; alone: boolean }) {
  const { running, result } = dbtDryRunOf(state, action);
  const fromDryRun = result?.schema?.fields;
  const fields = useMemo(() => schemaFields(action, fromDryRun), [action, fromDryRun]);
  const { database, schema, name } = action.target;
  return (
    <div data-dbt="schema" className="flex flex-col min-h-0" style={{ height: alone ? "calc(100vh - 180px)" : "60vh" }}>
      <div className="pb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-sm">{dbtNameOf(state, action)}</span>
        <span className={clsx("text-xs", result?.error ? ERROR : MUTED)}>
          {fromDryRun
            ? "From the dry run of the compiled query, with the descriptions the model's YAML gives."
            : running
              ? "The dry run is out: types come with it."
              : result?.error
                ? "The dry run failed, so there are no types. See the Compiled query tab."
                : "No dry run yet: these are the columns the model's YAML describes."}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <SchemaTable fields={fields} exportName={`${[database, schema, name].filter(Boolean).join("_")}.json`} />
      </div>
    </div>
  );
}

/** The Schema tab of a dbt file: a table for each action that is not a test */
function SchemaTab({ state, view }: { state: PanelSlices; view: DbtView }) {
  const actions = view.actions.filter((action) => action.kind !== "test" && action.kind !== "unit test" && action.sections.length > 0);
  return (
    <div className="p-4 space-y-4">
      {actions.map((action) => (
        <ActionSchema key={action.id} state={state} action={action} alone={actions.length === 1} />
      ))}
    </div>
  );
}

export function DbtPanel({ state }: { state: PanelSlices }) {
  const view = dbtView(state);
  const [chosen, setChosen] = useState<DbtTab>("compiled");
  useProjectInfoRequest(useCallback(() => setChosen("project"), []));
  // A tab that the file on show does not have is not left selected
  const tab = view.tabs.includes(chosen) ? chosen : "compiled";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const wanted = TAB_KEY[event.key];
      if (wanted) {
        event.preventDefault();
        setChosen(wanted);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The history of runs is the window's: it is asked for once, and the host sends it again as a run goes on
  useEffect(() => {
    vscode.postMessage({ command: "dataform.loadWorkflowUrls" });
  }, []);

  const block = state.dbt;
  const looking = block?.looking === true;

  return (
    <div data-backend="dbt" className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] overflow-hidden">
      {view.tabs.length > 0 && (
        <PanelHeader
          tabs={view.tabs.map((name) => (
            <HeaderTab key={name} active={tab === name} onClick={() => setChosen(name)}>{TAB_LABEL[name]}</HeaderTab>
          ))}
          actions={<>
            {view.page === "panel" && (
              <RunStatusPill
                state={state}
                runs={dbtRunsOf(state)}
                onDetails={() => {
                  setChosen("compiled");
                  // The Last run row is drawn only once its tab is the one on show
                  setTimeout(() => window.dispatchEvent(new Event(SHOW_RUN_DETAILS_EVENT)), 50);
                }}
              />
            )}
            <ReportIssueLink />
          </>}
        />
      )}

      <div className="flex-1 overflow-auto">
        {view.page === "tool missing" && tab !== "project" && <ToolMissing view={view} looking={looking} />}
        {view.page === "tool missing" && tab === "project" && <div className="p-4"><ProjectInfoTab state={state} /></div>}
        {view.page === "unsupported" && tab !== "project" && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-2"><FileChip file={view.file} /><ProjectLabel project={state.project} /></div>
            <h2 className="text-lg font-semibold m-0">This dbt cannot be used</h2>
            <p className="m-0 text-sm">{view.unsupported}</p>
            <ToolButtons looking={looking} />
          </div>
        )}
        {view.page !== "tool missing" && (
          <>
            {/* The schema table has its own frame, as it has in a Dataform file's panel */}
            {view.page === "panel" && tab === "schema" && <SchemaTab state={state} view={view} />}
            {tab !== "schema" && (
              <div className="p-4">
                {view.page === "panel" && tab === "compiled" && <CompiledTab state={state} view={view} />}
                {view.page === "panel" && tab === "runs" && (
                  <div className="pb-10">
                    <div data-dbt="runs" className="-mx-4 -mt-4">
                      <RunHistory urls={dbtRunsOf(state)} refreshable={false} empty="No runs yet. Runs with dbt build appear here, with their BigQuery jobs" />
                    </div>
                  </div>
                )}
                {tab === "project" && <ProjectInfoTab state={state} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
