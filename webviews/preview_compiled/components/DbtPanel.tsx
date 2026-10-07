import React, { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Loader2, MessageSquareWarning } from "lucide-react";
import type { CompileError } from "../../../src/backend/backend";
import type { DbtBlock, PanelAction } from "../../../src/shared/panelContract";
import { DbtCard, DbtStatusLine, DbtTab, DbtView, dbtDryRunOf, dbtErrorFoot, dbtNameOf, dbtView, incrementalCase } from "../../../src/shared/panelDbtView";
import { formatBytes } from "../../../src/shared/panelBigQueryView";
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

function StatusLine({ status }: { status: DbtStatusLine }) {
  const running = status.kind === "first compile" || status.kind === "recompiling";
  const elapsed = useElapsed(running ? status.startedAt : undefined);
  if (status.kind === "compiled" || status.kind === "parsed") {
    const took = status.kind === "compiled" && status.durationMs !== undefined ? ` · took ${seconds(status.durationMs)}` : "";
    return (
      <div data-status={status.kind} className={clsx("px-4 py-2 text-xs border-b border-[var(--vscode-widget-border)]", MUTED)}>
        {status.kind === "compiled" ? "Compiled" : "Parsed"} at {new Date(status.compiledAt).toLocaleTimeString()}
        {took}
        {status.kind === "compiled" ? " · everything below is from this compile" : ""}
      </div>
    );
  }
  return (
    <div data-status={status.kind} className={clsx("px-4 py-2 text-xs border-b border-[var(--vscode-widget-border)] flex flex-wrap items-center gap-2", status.kind === "failed" ? ERROR : running ? WARNING : MUTED)}>
      {running && <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />}
      <span>{status.text}</span>
      {running && <span className={clsx("font-mono", MUTED)}>{[status.command, seconds(elapsed)].filter(Boolean).join(" · ")}</span>}
    </div>
  );
}

function ToolMissing({ view, looking }: { view: DbtView; looking: boolean }) {
  return (
    <div className="p-4 space-y-4">
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
 * Run (xf#54): `dbt build` of the file's actions in the extension's terminal. The button names the dbt target it
 * builds into. The menu adds what the actions read from, what reads from them, a full refresh, and a run by tag.
 */
function RunControl({ run, target, tags }: { run: NonNullable<DbtView["run"]>; target?: string; tags: string[] }) {
  const [open, setOpen] = useState(false);
  const blocked = run.blocked !== undefined;
  const start = (scope: { includeDependencies?: boolean; includeDependents?: boolean; fullRefresh?: boolean }) => {
    setOpen(false);
    vscode.postMessage({ command: "run", actions: run.targets, includeDependencies: false, includeDependents: false, fullRefresh: false, ...scope });
  };
  const startTag = (tag: string) => {
    setOpen(false);
    vscode.postMessage({ command: "runTags", tags: [tag], includeDependencies: false, includeDependents: false, fullRefresh: false });
  };
  const item = "w-full px-2 py-1.5 rounded border-0 bg-transparent cursor-pointer text-left text-sm text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]";
  return (
    <div data-dbt="run" className="relative">
      <div className={clsx("flex rounded overflow-hidden text-xs", blocked && "opacity-50")} title={run.blocked ?? "dbt build of this file's actions, in the terminal"}>
        <button type="button" disabled={blocked} onClick={() => start({})} className="px-3 py-1 border-0 cursor-pointer font-semibold bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]">
          Run → <span className="font-mono">{target ?? "dbt's default"}</span>
        </button>
        <button type="button" aria-label="More ways to run" aria-haspopup="menu" aria-expanded={open} disabled={blocked} onClick={() => setOpen(!open)} className="px-1.5 border-0 border-l border-[var(--vscode-button-separator,rgba(255,255,255,0.3))] cursor-pointer bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]">
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div role="menu" className="absolute right-0 mt-1 w-64 z-20 rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editorWidget-background,var(--vscode-sideBar-background))] shadow-lg p-1.5">
            <button type="button" role="menuitem" className={item} onClick={() => start({})}>This file's actions</button>
            <button type="button" role="menuitem" className={item} onClick={() => start({ includeDependencies: true })}>… with dependencies</button>
            <button type="button" role="menuitem" className={item} onClick={() => start({ includeDependents: true })}>… with dependents</button>
            <button type="button" role="menuitem" className={item} onClick={() => start({ fullRefresh: true })}>… full refresh</button>
            <div className={clsx("border-t border-[var(--vscode-widget-border)] mt-1 pt-1.5 px-2 pb-1 text-[11px] uppercase tracking-wider", MUTED)}>Run a tag</div>
            {tags.length === 0 && <div className={clsx("px-2 pb-1 text-xs", MUTED)}>The Project has no tags.</div>}
            <div className="max-h-40 overflow-auto">
              {tags.map((tag) => (
                <button key={tag} type="button" role="menuitem" className={clsx(item, "font-mono text-xs")} onClick={() => startTag(tag)}>
                  tag:{tag}
                </button>
              ))}
            </div>
          </div>
        </>
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

function ActionSection({ state, view, action, first }: { state: PanelSlices; view: DbtView; action: PanelAction; first: boolean }) {
  const [open, setOpen] = useState(first);
  const isTest = action.kind === "test" || action.kind === "unit test";
  const query = action.sections.find((section) => section.title === "query" || section.title === "operation");
  const asWritten = !!query && !query.compiled;
  const { running, result } = dbtDryRunOf(state, action);
  const failed = result?.error;
  const bigQuery = state.dbt?.bigQuery !== false;
  const which = incrementalCase(state, action);
  // The size is in the section's header; here, what a run of the query would cost
  const price = result?.cost && !result.error && !result.bytesUnknown ? result.cost.value : undefined;
  const cost = price === undefined ? "" : `${state.bigquery?.currencySymbol ?? "$"}${price < 0.01 ? price.toFixed(4) : price.toFixed(2)}`;
  return (
    <section data-dbt="action" data-kind={action.kind} className={clsx(BOX, "min-w-0")}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-left bg-transparent border-0 text-[var(--vscode-foreground)] cursor-pointer">
        {open ? <ChevronDown className={clsx("w-4 h-4", MUTED)} /> : <ChevronRight className={clsx("w-4 h-4", MUTED)} />}
        <span className={clsx("px-1.5 py-0.5 rounded text-[11px] uppercase tracking-wider border border-[var(--vscode-widget-border)]", isTest ? "text-[var(--vscode-textLink-foreground)]" : "text-[var(--vscode-textPreformat-foreground)]")}>
          {action.kind}
        </span>
        <span className="font-mono text-sm">{dbtNameOf(state, action)}</span>
        {action.fileName && action.fileName !== view.file && <span className={clsx("text-xs", MUTED)}>defined in {action.fileName}</span>}
        <span className="ml-auto flex items-center gap-2 text-xs">
          {action.disabled && <span className={MUTED}>disabled</span>}
          {view.outdated ? (
            <span className={WARNING}>outdated</span>
          ) : asWritten ? (
            <span className={MUTED}>not compiled</span>
          ) : running ? (
            <span data-dry-run="running" className={clsx("flex items-center gap-1", MUTED)}>
              <Loader2 className="w-3 h-3 animate-spin" />
              dry run
            </span>
          ) : failed ? (
            <span data-dry-run="failed" className={ERROR}>✕ dry run failed</span>
          ) : result ? (
            <span data-dry-run="ok" className="font-mono text-[var(--vscode-testing-iconPassed,#73c991)]" title="What the query would scan, from BigQuery's dry run">
              ✓ {result.bytesUnknown ? "bytes unknown" : formatBytes(result.bytes ?? 0)}
            </span>
          ) : null}
        </span>
      </button>
      {open && (
        <div className={clsx("border-t border-[var(--vscode-widget-border)] p-3 space-y-3", view.outdated && "opacity-50")}>
          {action.kind === "incremental" && action.sqlPresent && (
            <div data-dbt="incremental" className={clsx("text-xs", MUTED)}>
              {which === "incremental"
                ? "Incremental model. dbt compiled the incremental case, because the table already exists."
                : which === "full build"
                  ? "Incremental model. dbt compiled the full build, because the table does not exist yet."
                  : "Incremental model. dbt compiled one case of it: the incremental one if the table already exists, the full build if it does not."}
            </div>
          )}
          {action.sections.length === 0 && <div className={clsx("text-sm", MUTED)}>{NO_SQL[action.kind] ?? "No SQL to show."}</div>}
          {action.sections.map((section) => {
            const hook = section !== query;
            return (
              <div key={section.title} data-section={section.title}>
                {(hook || asWritten) && (
                  <div className={clsx("text-[11px] uppercase tracking-wider mb-1", MUTED)}>
                    {hook ? `${section.title} · as written, not compiled, not dry-run` : "as written, not compiled"}
                  </div>
                )}
                <CodeBlock
                  code={section.sql}
                  language="sql"
                  className={hook ? "opacity-70" : undefined}
                  showLineNumbers={!hook && !!failed?.line && failed.section === section.title}
                  errorAnnotations={!hook && failed?.line && failed.section === section.title ? [{ line: failed.line, message: failed.message }] : undefined}
                />
                {!hook && failed && (
                  <div data-dbt="dry run error" className="mt-2 rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] px-3 py-2 text-xs">
                    {failed.line && failed.section === section.title && (
                      <span className={clsx("font-semibold", ERROR)}>
                        Line {failed.line}
                        {failed.column ? `, column ${failed.column}` : ""} of the compiled SQL:{" "}
                      </span>
                    )}
                    <span className="break-words">{failed.message}</span>
                    <div className={clsx("mt-0.5", MUTED)}>Shown here only. Nothing is marked in the source file.</div>
                  </div>
                )}
              </div>
            );
          })}
          {query?.compiled && bigQuery && query.dryRun.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={view.outdated}
                title={isTest ? "Runs the test's query and shows the rows that fail it" : "Runs the compiled query and shows its rows. It costs what the query costs"}
                onClick={() => vscode.postMessage({ command: "preview", action: action.target, section: query.title })}
              >
                {isTest ? "Preview failing rows" : "Preview"}
              </button>
              {cost && <span data-dbt="cost" className={MUTED}>≈ {cost}</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CompiledTab({ state, view }: { state: PanelSlices; view: DbtView }) {
  const notice = state.settled?.status === "parsed only" ? state.settled.notice : undefined;
  return (
    <div className="space-y-4">
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
      {view.actions.map((action, index) => (
        <ActionSection key={action.id} state={state} view={view} action={action} first={index === 0} />
      ))}
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
      {state.run?.lastRun && (
        <div data-dbt="last run" className={clsx(BOX, "px-3 py-2 text-xs flex flex-wrap items-center gap-2")}>
          <span className={MUTED}>Sent to terminal</span>
          <span className="font-mono break-all">{state.run.lastRun.command}</span>
          <button type="button" className={clsx(SECONDARY_BUTTON, "ml-auto py-0.5")} title="Runs the same selection again, with the dbt target of now" onClick={() => vscode.postMessage({ command: "repeatLastRun" })}>
            Repeat
          </button>
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
  const engine = engineLabel(block?.dbt);
  const looking = block?.looking === true;

  return (
    <div data-backend="dbt" className="flex flex-col h-screen bg-[var(--vscode-editor-background)] text-[var(--vscode-editor-foreground)] overflow-hidden">
      <div className="px-4 pt-3 pb-3 flex flex-wrap items-start gap-3 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)]">
        <div className="min-w-0">
          <div className="font-mono text-sm break-all">{view.file}</div>
          {(view.what || view.target) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {view.what && <span className="px-1.5 py-0.5 rounded border border-[var(--vscode-widget-border)]">{view.what}</span>}
              {view.target &&
                (view.target.link ? (
                  <a className="font-mono text-[var(--vscode-textLink-foreground)]" target="_blank" rel="noopener noreferrer" href={getUrlToNavigateToTableInBigQuery(view.target.target.database, view.target.target.schema, view.target.target.name)}>
                    {view.target.text}
                  </a>
                ) : (
                  <span className={clsx("font-mono", MUTED)}>
                    {view.target.text}
                    {view.target.buildsNothing ? "  (builds nothing)" : ""}
                  </span>
                ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
          {engine && <span className={clsx("font-mono", MUTED)}>{engine}</span>}
          {block && view.page !== "tool missing" && <TargetControl block={block} />}
          {view.page === "panel" && view.run && <RunControl run={view.run} target={block?.target.name} tags={state.project?.tags ?? []} />}
        </div>
      </div>

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

      {view.page === "panel" && view.status && <StatusLine status={view.status} />}

      <div className="flex-1 overflow-auto">
        {view.page === "tool missing" && <ToolMissing view={view} looking={looking} />}
        {view.page === "unsupported" && tab !== "project" && (
          <div className="p-4 space-y-4">
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
