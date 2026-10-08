import React, { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { AlertCircle, Check, ChevronDown, ChevronRight, Clock, Copy, ExternalLink, Eye, Loader2, MessageSquareWarning, Play, Tag, Terminal } from "lucide-react";
import type { MultiValue } from "react-select";
import StyledMultiSelect from "../../dependancy_graph/components/StyledMultiSelect";
import type { OptionType } from "../../dependancy_graph/components/StyledSelect";
import { ModifierSwitch } from "./ModifierSwitch";
import type { CompileError } from "../../../src/backend/backend";
import type { DbtBlock, PanelAction } from "../../../src/shared/panelContract";
import { DbtCard, DbtStatusLine, DbtTab, DbtView, dbtDryRunOf, dbtErrorFoot, dbtNameOf, dbtView, incrementalCase } from "../../../src/shared/panelDbtView";
import { dryRunCostSummary } from "../../../src/shared/panelBigQueryView";
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "../utils/constants";
import { renderDryRunStatLine } from "./CompiledQueryTab";
import { useNow } from "./CompilationInfoBadge";
import { formatRelativeTime } from "../utils/compilationInfoFormat";
import type { ColumnMetadata } from "../../../src/types";
import type { PanelSlices } from "../../../src/shared/panelState";
import { CodeBlock } from "../../components/CodeBlock";
import { SchemaTable } from "./SchemaTab";
import { getUrlToNavigateToTableInBigQuery } from "../../utils/bigquery";
import { vscode } from "../utils/vscode";

/*
 * The compiled-query panel of a dbt Project (decided in xf#52). What is drawn, and when, is worked out by `dbtView`
 * in src/shared/panelDbtView.ts; the components here only draw it. Nothing here reads the `dataform` block.
 */

const TAB_LABEL: Record<DbtTab, string> = { compiled: "Compiled query", schema: "Schema", project: "Project" };
const TAB_KEY: Record<string, DbtTab> = { c: "compiled", s: "schema", p: "project" };

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

/**
 * How the compile stands, as Dataform's compilation info (CompilationInfoBadge.tsx): the engine that compiled, how
 * long it took and how long ago. While dbt works, and when the compile failed, the same line says so.
 */
function StatusLine({ status, engine }: { status: DbtStatusLine; engine: string }) {
  const now = useNow(30_000);
  const running = status.kind === "first compile" || status.kind === "recompiling";
  const elapsed = useElapsed(running ? status.startedAt : undefined);
  if (status.kind === "compiled" || status.kind === "parsed") {
    const took = status.kind === "parsed" ? "parsed" : status.durationMs !== undefined ? `${(status.durationMs / 1000).toFixed(2)}s` : undefined;
    return (
      <div data-status={status.kind} className={clsx("flex flex-wrap items-center gap-1.5 text-xs", MUTED)} title={`${status.kind === "compiled" ? "Compiled" : "Parsed"} at ${new Date(status.compiledAt).toLocaleString()}`}>
        <Terminal className="w-3 h-3" />
        <span>{[engine || "dbt", took, formatRelativeTime(status.compiledAt, now)].filter(Boolean).join(" · ")}</span>
      </div>
    );
  }
  return (
    <div data-status={status.kind} className={clsx("flex flex-wrap items-center gap-1.5 text-xs", status.kind === "failed" ? ERROR : running ? WARNING : MUTED)}>
      {running && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />}
      <span>{status.text}</span>
      {running && <span className={clsx("font-mono", MUTED)}>{[status.command, seconds(elapsed)].filter(Boolean).join(" · ")}</span>}
    </div>
  );
}

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

// The buttons of Dataform's toolbar (CompiledQueryTab.tsx), so that the two panels look alike
const TOOLBAR_BUTTON_BASE = "py-1.5 rounded text-sm flex items-center disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]";
const TOOLBAR_PRIMARY = `${TOOLBAR_BUTTON_BASE} px-3 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]`;
const TOOLBAR_SECONDARY = `${TOOLBAR_BUTTON_BASE} px-3 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)]`;
// A shade darker than the Run half, as in Dataform's split button
const SELECTOR_BACKGROUND = "color-mix(in srgb, var(--vscode-button-background) 78%, black)";

/**
 * The Run button of a dbt file, shaped as Dataform's (RunSplitButton.tsx): the left half runs the file's actions,
 * the right half names what the run goes to and opens a menu. For Dataform that is the CLI or the API; for dbt it is
 * the dbt target, and the menu has the run by tag.
 */
function DbtRunButton({ target, disabled, title, hasTags, onRun, onRunTag }: { target?: string; disabled: boolean; title: string; hasTags: boolean; onRun: () => void; onRunTag: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const segment = "py-1.5 text-[var(--vscode-button-foreground)] flex items-center disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]";
  return (
    <div ref={wrapper} data-dbt="run" className="relative inline-flex">
      <button type="button" onClick={onRun} disabled={disabled} title={title} className={clsx(segment, "pl-3 pr-3 rounded-l text-sm border-0 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]")}>
        <Play className="w-4 h-4 mr-1.5" />
        Run
      </button>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={clsx(segment, "gap-1 pl-2.5 pr-2 rounded-r text-xs font-medium border-0 border-l hover:!bg-[var(--vscode-button-hoverBackground)]")}
        style={{ background: SELECTOR_BACKGROUND, borderLeftColor: "color-mix(in srgb, var(--vscode-button-foreground) 30%, transparent)", borderLeftStyle: "solid", borderLeftWidth: 1 }}
        aria-label={`Builds into the dbt target ${target ?? "dbt chooses"}. More ways to run`}
        title="The dbt target the run builds into. More ways to run"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="font-mono">{target ?? "dbt's default"}</span>
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div role="menu" aria-label="Run options" className="absolute top-full left-0 mt-1 z-20 min-w-[230px] py-1 rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-lg">
          <button
            type="button"
            role="menuitem"
            disabled={!hasTags}
            onClick={() => {
              setOpen(false);
              onRunTag();
            }}
            className="w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs border-0 bg-transparent text-inherit outline-none disabled:opacity-50 hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,inherit)] focus:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))]"
          >
            <span className="mt-0.5 shrink-0">
              <Tag className="w-3.5 h-3.5" />
            </span>
            <span className="flex flex-col">
              <span>Run Tag…</span>
              <span className="opacity-70">{hasTags ? "Pick tag(s) to build with dbt" : "The Project has no tags"}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The toolbar of a dbt file's Compiled query tab, laid out as Dataform's: a row with Preview Data, then a row with
 * Run and the switches that say how far the run reaches, then the last run. A run is `dbt build` in the extension's
 * terminal (xf#54); the switches apply to a run of the file and to a run by tag alike.
 */
function Toolbar({ state, view }: { state: PanelSlices; view: DbtView }) {
  const [includeDependencies, setIncludeDependencies] = useState(false);
  const [includeDependents, setIncludeDependents] = useState(false);
  const [fullRefresh, setFullRefresh] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const tags = state.project?.tags ?? [];
  const tagOptions = useMemo<OptionType[]>(() => tags.map((tag) => ({ value: tag, label: tag })), [tags]);
  const scope = { includeDependencies, includeDependents, fullRefresh };
  const bigQuery = state.dbt?.bigQuery !== false;
  // What Preview Data runs: the compiled query of the file's first action that has one
  const previewed = view.actions.find((action) => action.sqlPresent && action.sections.some((section) => section.compiled && section.dryRun.length > 0));
  const section = previewed?.sections.find((candidate) => candidate.compiled && candidate.dryRun.length > 0);
  const canPreview = bigQuery && !!previewed && !!section;
  const run = view.run;
  if (!canPreview && !run) {
    return null;
  }
  const blocked = run?.blocked !== undefined;
  const runTags = () => {
    setTagsOpen(false);
    vscode.postMessage({ command: "runTags", tags: selectedTags, ...scope });
  };
  return (
    <div data-dbt="toolbar" className="flex flex-col gap-3">
      {canPreview && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={clsx(TOOLBAR_SECONDARY, "border-0")}
            disabled={view.outdated}
            title="Preview the query results: runs the compiled query and shows its rows. It costs what the query costs"
            onClick={() => vscode.postMessage({ command: "preview", action: previewed!.target, section: section!.title })}
          >
            <Eye className="w-4 h-4 mr-1.5" /> Preview Data
          </button>
        </div>
      )}
      {run && (
        <div className={clsx("flex flex-wrap items-center gap-x-2 gap-y-2", canPreview && "pt-3 border-t border-[var(--vscode-widget-border)]")}>
          <div className="relative">
            <DbtRunButton
              target={state.dbt?.target.name}
              disabled={blocked}
              title={run.blocked ?? "Run this file's actions with dbt build, in the terminal"}
              hasTags={tags.length > 0}
              onRun={() => vscode.postMessage({ command: "run", actions: run.targets, ...scope })}
              onRunTag={() => setTagsOpen(true)}
            />
            {tagsOpen && (
              <div
                role="dialog"
                aria-label="Run by tag"
                onKeyDown={(event) => {
                  if (event.key === "Escape" && !tagMenuOpen) {
                    setTagsOpen(false);
                  }
                }}
                className="absolute top-full left-0 mt-1 z-20 w-[min(320px,calc(100vw-2rem))] p-3 rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] shadow-lg"
              >
                <p className={clsx("text-xs mb-2", MUTED)}>Select tag(s) to build with dbt:</p>
                <StyledMultiSelect
                  options={tagOptions}
                  value={tagOptions.filter((option) => selectedTags.includes(option.value))}
                  onChange={(options: MultiValue<OptionType>) => setSelectedTags(options.map((option) => option.value))}
                  onMenuOpen={() => setTagMenuOpen(true)}
                  onMenuClose={() => setTagMenuOpen(false)}
                  placeholder="Search and select tags..."
                  isSearchable
                  closeMenuOnSelect
                  blurInputOnSelect={false}
                  autoFocus
                />
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--vscode-widget-border)]">
                  <button type="button" onClick={() => setTagsOpen(false)} className="px-3 py-1.5 text-xs border-0 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded">
                    Cancel
                  </button>
                  <button type="button" onClick={runTags} disabled={selectedTags.length === 0 || blocked} className={clsx(TOOLBAR_PRIMARY, "flex-1 justify-center border-0 !text-xs")}>
                    <Play className="w-3.5 h-3.5 mr-1.5" /> {selectedTags.length > 1 ? `Run ${selectedTags.length} tags` : "Run tag"}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div role="group" aria-label="Run modifiers" className="flex flex-wrap items-center gap-1.5">
            <div className="w-px h-5 mr-0.5 bg-[var(--vscode-widget-border)]" aria-hidden="true" />
            <ModifierSwitch label="+Deps" checked={includeDependencies} onChange={setIncludeDependencies} title="Also build what these actions read from (a + in front of the selection)" />
            <ModifierSwitch label="+Dependents" checked={includeDependents} onChange={setIncludeDependents} title="Also build what reads from these actions (a + behind the selection)" />
            <ModifierSwitch label="Full Refresh" checked={fullRefresh} onChange={setFullRefresh} title="Rebuild incremental models from scratch (--full-refresh)" warning />
          </div>
        </div>
      )}
      {state.run?.lastRun && (
        <div data-dbt="last run" className={clsx(BOX, "px-3 py-2 text-xs flex flex-wrap items-center gap-2")}>
          <span className={MUTED}>Sent to terminal</span>
          <span className="font-mono break-all">{state.run.lastRun.command}</span>
          <button type="button" className={clsx(SECONDARY_BUTTON, "ml-auto py-0.5")} title="Runs the same selection again, with the dbt target of now" onClick={() => vscode.postMessage({ command: "repeatLastRun" })}>
            Repeat
          </button>
        </div>
      )}
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
        className={clsx(
          "flex items-center gap-1.5 px-2 py-1 rounded border text-xs bg-transparent cursor-pointer text-[var(--vscode-foreground)]",
          target.overridden ? "border-[var(--vscode-inputValidation-warningBorder)] bg-[var(--vscode-inputValidation-warningBackground)]" : "border-[var(--vscode-widget-border)]",
        )}
      >
        <span className={MUTED}>dbt target</span>
        <span className="font-mono">{target.name ?? "dbt's default"}</span>
        {target.overridden && <span className={clsx("text-[10px] uppercase tracking-wider", WARNING)}>override</span>}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 mt-1 w-64 z-20 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-sideBar-background))] shadow-lg p-1.5 text-sm">
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
              <div>
                vars <span className="font-mono text-[var(--vscode-foreground)]">{block.vars ?? "none"}</span>
              </div>
              <div>
                profiles dir <span className="font-mono text-[var(--vscode-foreground)]">{block.profilesDir ?? "dbt's default"}</span>
              </div>
              <div className="italic">vars and profiles dir are set in settings</div>
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

function Card({ card }: { card: DbtCard }) {
  return (
    <div data-dbt="card" className={clsx(BOX, "p-4")}>
      <div className="text-base font-semibold">{card.title}</div>
      <dl className="mt-3 mb-0 grid grid-cols-[minmax(90px,max-content)_1fr] gap-x-4 gap-y-1.5 text-sm">
        {card.rows.map((row, index) => (
          <React.Fragment key={index}>
            <dt className={MUTED}>{row.label}</dt>
            <dd className="m-0 font-mono text-xs break-all self-center">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {card.foot && <div className={clsx("mt-3 text-xs", MUTED)}>{card.foot}</div>}
    </div>
  );
}

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
 * The card of one action, as a Dataform action's (CompiledQueryTab.tsx): its kind at the top left, what its dry run
 * would scan and cost at the top right, then where it builds, when that table last changed, and the dry run's
 * error. The SQL comes after the cards, further down.
 */
function ActionCard({ state, view, action }: { state: PanelSlices; view: DbtView; action: PanelAction }) {
  const [copied, setCopied] = useState(false);
  const query = queryOf(action);
  const asWritten = !!query && !query.compiled;
  const { running, result } = dbtDryRunOf(state, action);
  const failed = result?.error;
  const bigQuery = state.dbt?.bigQuery !== false;
  const which = incrementalCase(state, action);
  const stat = dryRunCostSummary(result, "", state.bigquery?.currencySymbol ?? "$");
  const badge = ACTION_TYPE_BADGE_STYLES[action.kind] ?? DEFAULT_BADGE_STYLE;
  const table = state.bigquery && state.file && state.bigquery.compile === state.file.compile ? state.bigquery.tables[action.id] : undefined;
  const link = action.buildsTable && bigQuery;
  const { database, schema, name } = action.target;
  // A test builds nothing either, but that needs no saying
  const buildsNothing = !action.buildsTable && action.kind !== "test" && action.kind !== "unit test" && action.kind !== "source";
  return (
    <div data-dbt="action" data-kind={action.kind} className="relative bg-[var(--vscode-sideBar-background)] px-4 pt-7 pb-4 rounded-xl border border-[var(--vscode-widget-border)]/60 flex flex-col space-y-2 group">
      <div className="absolute top-2 left-2 flex items-center gap-1.5">
        <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${badge.bg} ${badge.text} ${badge.border}`}>{action.kind}</span>
        {action.disabled && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]">disabled</span>}
      </div>
      {view.outdated ? (
        <span className={clsx("absolute top-2 right-2 text-xs", WARNING)}>outdated</span>
      ) : asWritten ? (
        <span className={clsx("absolute top-2 right-2 text-xs", MUTED)}>not compiled</span>
      ) : running ? (
        <Loader2 data-dry-run="running" className="absolute top-2 right-2 w-3.5 h-3.5 text-[var(--vscode-descriptionForeground)] animate-spin" />
      ) : stat ? (
        <div data-dry-run="ok" className="absolute top-2 right-2 text-xs font-mono font-medium text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] px-2 py-0.5 rounded">{renderDryRunStatLine(stat)}</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
        {link ? (
          <>
            <a
              href={getUrlToNavigateToTableInBigQuery(database, schema, name)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center text-sm font-mono text-[var(--vscode-foreground)] hover:text-[var(--vscode-textLink-foreground)] transition-colors break-all"
            >
              <ExternalLink className="w-4 h-4 mr-2 flex-shrink-0" />
              {[database, schema, name].filter(Boolean).join(".")}
            </a>
            <button
              type="button"
              onClick={() => {
                vscode.postMessage({ command: "copyToClipboard", text: `\`${database}.${schema}.${name}\`` });
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="p-1.5 border-0 bg-transparent cursor-pointer text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              title="Copy table ID with backticks"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </>
        ) : (
          <div className="flex items-center text-sm font-mono text-[var(--vscode-foreground)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--vscode-symbolIcon-methodForeground)] mr-2"></span>
            <span className="font-semibold break-all">{dbtNameOf(state, action)}</span>
          </div>
        )}
        {buildsNothing && <span className={clsx("text-xs", MUTED)}>builds nothing</span>}
        {action.fileName && action.fileName !== view.file && <span className={clsx("text-xs font-mono opacity-80", MUTED)}>{action.fileName}</span>}
      </div>
      {link && table && !table.missing && (
        <div className={clsx("flex items-center space-x-2 text-xs pl-6", MUTED)}>
          <Clock className="w-3 h-3" />
          <span>Last updated:</span>
          {table.lastModified ? (
            <span className={clsx("font-mono", table.modifiedToday ? "text-[var(--vscode-foreground)]" : "text-[var(--vscode-errorForeground)]")}>{table.lastModified}</span>
          ) : (
            <span className="font-mono opacity-70 cursor-help border-b border-dotted border-[var(--vscode-widget-border)]" title={table.error ?? "BigQuery gave no time"}>
              N/A
            </span>
          )}
        </div>
      )}
      {link && table?.missing && (
        <div className={clsx("flex items-center space-x-2 text-xs pl-6", MUTED)}>
          <Clock className="w-3 h-3" />
          <span>Not built yet: BigQuery has no such table.</span>
        </div>
      )}
      {action.kind === "incremental" && action.sqlPresent && (
        <div data-dbt="incremental" className={clsx("text-xs pl-6", MUTED)}>
          {which === "incremental"
            ? "dbt compiled the incremental case, because the table already exists."
            : which === "full build"
              ? "dbt compiled the full build, because the table does not exist yet."
              : "dbt compiled one case of this model: the incremental one if the table already exists, the full build if it does not."}
        </div>
      )}
      {action.sections.length === 0 && <div className={clsx("text-xs pl-6", MUTED)}>{NO_SQL[action.kind] ?? "No SQL to show."}</div>}
      {failed && !view.outdated && (
        <div data-dbt="dry run error" title="Shown here only. Nothing is marked in the source file." className="mt-1 bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] px-3 py-2 rounded text-xs text-[var(--vscode-inputValidation-errorForeground)] flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div className="overflow-auto whitespace-pre-wrap">{failed.message}</div>
        </div>
      )}
    </div>
  );
}

/** How Dataform's panel names a block of SQL, for dbt's sections */
function sectionLabel(action: PanelAction, title: string, compiled: boolean): string {
  const base = /^pre-hook/.test(title) ? title.replace("pre-hook", "Pre-hook") : /^post-hook/.test(title) ? title.replace("post-hook", "Post-hook") : isTestKind(action) ? "Test" : action.kind === "operation" ? "Hook" : "Query";
  return compiled ? base : `${base} (as written, not compiled)`;
}

/**
 * The SQL of the actions, after their cards: one block that opens and closes for each section, as Dataform has.
 * The file's own query starts open; a test's SQL and a hook start closed.
 */
function SqlBlocks({ state, view }: { state: PanelSlices; view: DbtView }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const bigQuery = state.dbt?.bigQuery !== false;
  const firstWithSql = view.actions.find((action) => action.sections.length > 0);
  return (
    <div className={clsx("space-y-3", view.outdated && "opacity-50")}>
      {view.actions.flatMap((action) => {
        const query = queryOf(action);
        const failed = dbtDryRunOf(state, action).result?.error;
        const name = [action.target.database, action.target.schema, action.target.name].filter(Boolean).join(".");
        return action.sections.map((section) => {
          const key = `${action.id}/${section.title}`;
          const isQuery = section === query;
          const open = toggled[key] ?? (isQuery && action === firstWithSql);
          const marked = isQuery && failed?.line && failed.section === section.title ? [{ line: failed.line, message: failed.message }] : undefined;
          return (
            <div key={key} data-dbt="sql" data-section={section.title} className="rounded-xl border border-[var(--vscode-widget-border)]/50 overflow-hidden">
              <button
                type="button"
                aria-expanded={open}
                className="w-full flex items-center px-4 py-2.5 cursor-pointer border-0 bg-transparent hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors text-left"
                onClick={() => setToggled((before) => ({ ...before, [key]: !open }))}
              >
                {open ? <ChevronDown className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" /> : <ChevronRight className="w-4 h-4 mr-2 flex-shrink-0 text-zinc-400" />}
                <span className="font-semibold text-[var(--vscode-foreground)] text-sm mr-3">{sectionLabel(action, section.title, section.compiled)}</span>
                <span className="text-xs font-mono text-[var(--vscode-descriptionForeground)] opacity-60 truncate">{name}</span>
              </button>
              {open && (
                <div role="region" className="border-t border-[var(--vscode-widget-border)]">
                  <CodeBlock code={section.sql} language="sql" showLineNumbers errorAnnotations={marked} />
                  {/* The file's own query is previewed from the toolbar. A test's rows, and a second model's, from here */}
                  {isQuery && section.compiled && bigQuery && section.dryRun.length > 0 && action !== firstWithSql && (
                    <div className="px-3 pb-3">
                      <button
                        type="button"
                        className={clsx(TOOLBAR_SECONDARY, "border-0")}
                        disabled={view.outdated}
                        title={isTestKind(action) ? "Runs the test's query and shows the rows that fail it" : "Runs the compiled query and shows its rows. It costs what the query costs"}
                        onClick={() => vscode.postMessage({ command: "preview", action: action.target, section: section.title })}
                      >
                        <Eye className="w-4 h-4 mr-1.5" /> {isTestKind(action) ? "Preview failing rows" : "Preview Data"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        });
      })}
    </div>
  );
}

function CompiledTab({ state, view }: { state: PanelSlices; view: DbtView }) {
  const notice = state.settled?.status === "parsed only" ? state.settled.notice : undefined;
  const block = state.dbt;
  return (
    <div className="space-y-4">
      {/* Filename + compile time, then the dbt target where a Dataform file has Format and Lint */}
      <div className="flex flex-wrap items-center gap-2">
        <FileChip file={view.file} />
        {view.status && <StatusLine status={view.status} engine={engineLabel(block?.dbt)} />}
        <div className="flex-grow"></div>
        {block && <TargetControl block={block} />}
      </div>
      {view.parsedOnly && (
        <div data-dbt="parsed only" className="rounded border border-[var(--vscode-inputValidation-warningBorder)] bg-[var(--vscode-inputValidation-warningBackground)] p-3 text-sm">
          <div className={clsx("font-semibold", WARNING)}>Parsed, not compiled</div>
          <p className="mt-1 mb-0">{notice} So the SQL below is as written, and nothing is dry-run.</p>
          <button className={clsx(SECONDARY_BUTTON, "mt-2")} disabled={view.outdated || view.skeleton} onClick={() => vscode.postMessage({ command: "dbt.compileWithHooks", on: true })}>
            Compile with hooks: they will run on every save
          </button>
        </div>
      )}
      {view.otherWarehouse && (
        <div data-dbt="not bigquery" className={clsx(BOX, "p-3 text-sm")}>
          This Project's profile targets <span className="font-mono">{view.otherWarehouse}</span>. The extension supports BigQuery, so dry run, cost, schema, preview and run are not offered here.
        </div>
      )}
      {view.errors.map((error, index) => (
        <ErrorCard key={index} error={error} flavour={state.dbt?.dbt?.flavour} />
      ))}
      {view.actions.length > 0 && (
        <div className="space-y-3">
          {view.actions.map((action) => (
            <ActionCard key={action.id} state={state} view={view} action={action} />
          ))}
        </div>
      )}
      {view.readsFrom.length > 0 && (
        <div data-dbt="reads from" className={clsx("text-xs flex flex-wrap items-center gap-x-4 gap-y-1", MUTED)}>
          <span>reads from</span>
          {view.readsFrom.map((neighbour, index) => (
            <span key={index}>
              {neighbour.fileName ? (
                <button type="button" title={`Open ${neighbour.fileName}`} className="p-0 bg-transparent border-0 cursor-pointer font-mono text-xs text-[var(--vscode-textLink-foreground)] hover:underline" onClick={() => vscode.postMessage({ command: "openAction", action: neighbour.target })}>
                  {neighbour.target.name}
                </button>
              ) : (
                <span className="font-mono text-[var(--vscode-foreground)]">{neighbour.target.name}</span>
              )}{" "}
              {neighbour.kind}
            </span>
          ))}
        </div>
      )}
      <Toolbar state={state} view={view} />
      <SqlBlocks state={state} view={view} />
      {view.card && <Card card={view.card} />}
      {view.skeleton && (
        <div data-dbt="skeleton" className="space-y-2 animate-pulse">
          {[80, 62, 91, 48, 70].map((width) => (
            <div key={width} className="h-3 rounded bg-[var(--vscode-foreground)] opacity-10" style={{ width: `${width}%` }} />
          ))}
        </div>
      )}
      {view.errorsElsewhere.length > 0 && (
        <details data-dbt="errors elsewhere" className={clsx(BOX, "text-sm")}>
          <summary className="px-3 py-2 cursor-pointer">
            <span className={ERROR}>●</span> {view.errorsElsewhere.length} {view.errorsElsewhere.length === 1 ? "error" : "errors"} elsewhere in the Project
          </summary>
          <ul className="px-3 pb-3 m-0 list-none space-y-1 font-mono text-xs">
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
        </details>
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

/** Why the dbt target is the one it is, for the Project tab */
function targetNote(target: DbtBlock["target"]): string {
  if (target.overridden) {
    const fallback = target.setting ?? target.profileDefault;
    return `  (override${fallback ? `; default is ${fallback}` : ""})`;
  }
  if (target.setting === target.name) {
    return "  (the dbtTarget setting)";
  }
  return target.profileDefault === target.name ? "  (profile default)" : "";
}

function ProjectTab({ state }: { state: PanelSlices }) {
  const block = state.dbt;
  const dbt = block?.dbt;
  const rows: Array<[string, string]> = [
    ["Backend", "dbt"],
    ["dbt", dbt ? `${dbt.path}  (found by ${dbt.foundBy})` : block?.looking ? "looking for it…" : "not found"],
    ["Version", engineLabel(dbt) || "not known"],
    ["dbt target", block?.target.name ? `${block.target.name}${targetNote(block.target)}` : "dbt chooses; it has not said which yet"],
    ["dbt vars", block?.vars ?? "none"],
    ["Profiles dir", block?.profilesDir ?? "where dbt looks by default"],
    ["Warehouse", block?.warehouse ?? "not known yet"],
    ["Root", state.project?.root ?? ""],
  ];
  return (
    <dl data-dbt="project" className="m-0 grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className={MUTED}>{label}</dt>
          <dd className="m-0 font-mono text-xs break-all self-center">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function DbtPanel({ state }: { state: PanelSlices }) {
  const view = dbtView(state);
  const [chosen, setChosen] = useState<DbtTab>("compiled");
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

  const block = state.dbt;
  const looking = block?.looking === true;

  return (
    <div data-backend="dbt" className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] overflow-hidden">
      {view.tabs.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--vscode-widget-border)]">
          {view.tabs.map((name) => (
            <button
              key={name}
              onClick={() => setChosen(name)}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors border",
                tab === name
                  ? "bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)] border-[var(--vscode-button-background)]"
                  : "text-[var(--vscode-foreground)] opacity-70 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] border-transparent bg-transparent",
              )}
            >
              {TAB_LABEL[name]}
            </button>
          ))}
          <a href="https://github.com/ashish10alex/vscode-dataform-tools/issues" target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center text-xs text-[var(--vscode-textPreformat-foreground)] hover:brightness-110">
            Report an issue
            <MessageSquareWarning className="w-3 h-3 ml-1" />
          </a>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {view.page === "tool missing" && <ToolMissing view={view} looking={looking} />}
        {view.page === "unsupported" && tab !== "project" && (
          <div className="p-4 space-y-4">
            <div><FileChip file={view.file} /></div>
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
                {tab === "project" && <ProjectTab state={state} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
