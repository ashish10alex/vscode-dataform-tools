import React, { useEffect, useState } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronRight, Loader2, MessageSquareWarning } from "lucide-react";
import type { CompileError } from "../../../src/backend/backend";
import type { DbtBlock, PanelAction } from "../../../src/shared/panelContract";
import { DbtCard, DbtStatusLine, DbtTab, DbtView, dbtNameOf, dbtView } from "../../../src/shared/panelDbtView";
import type { PanelSlices } from "../../../src/shared/panelState";
import { CodeBlock } from "../../components/CodeBlock";
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

function ErrorCard({ error }: { error: CompileError }) {
  const at = error.fileName ? [error.fileName, error.line].filter((part) => part !== undefined).join(":") : "";
  return (
    <div data-dbt="compile error" className="rounded border border-[var(--vscode-inputValidation-errorBorder)] bg-[var(--vscode-inputValidation-errorBackground)] p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={clsx("font-semibold", ERROR)}>Compile error</span>
        {error.code && <span className={clsx("font-mono", MUTED)}>{error.code}</span>}
        {at && <span className="font-mono ml-auto">{at}</span>}
      </div>
      <pre className="mt-2 mb-0 text-xs font-mono whitespace-pre-wrap break-words">{error.message}</pre>
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
          {view.outdated ? <span className={WARNING}>outdated</span> : asWritten ? <span className={MUTED}>not compiled</span> : null}
        </span>
      </button>
      {open && (
        <div className={clsx("border-t border-[var(--vscode-widget-border)] p-3 space-y-3", view.outdated && "opacity-50")}>
          {action.kind === "incremental" && action.sqlPresent && (
            <div data-dbt="incremental" className={clsx("text-xs", MUTED)}>
              Incremental model. dbt compiled one case of it: the incremental one if the table already exists, the full build if it does not.
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
                <CodeBlock code={section.sql} language="sql" className={hook ? "opacity-70" : undefined} />
              </div>
            );
          })}
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
        <ErrorCard key={index} error={error} />
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
                {[error.fileName, error.line].filter((part) => part !== undefined).join(":")} <span className={MUTED}>{error.message.split("\n")[0]}</span>
              </li>
            ))}
          </ul>
        </details>
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

function SchemaTab({ state, view }: { state: PanelSlices; view: DbtView }) {
  const described = view.actions.filter((action) => (action.columns?.length ?? 0) > 0);
  return (
    <div className="space-y-4 text-sm">
      {described.map((action) => (
        <div key={action.id}>
          <div className="font-mono text-sm mb-1">{dbtNameOf(state, action)}</div>
          <table className="w-full border-collapse">
            <thead className={clsx("text-left text-[11px] uppercase tracking-wider", MUTED)}>
              <tr>
                <th className="py-1 font-normal">Column</th>
                <th className="py-1 font-normal">Description</th>
              </tr>
            </thead>
            <tbody>
              {action.columns!.map((column) => (
                <tr key={column.path.join(".")} className="border-t border-[var(--vscode-widget-border)]">
                  <td className="py-1.5 pr-4 font-mono text-xs align-top">{column.path.join(".")}</td>
                  <td className="py-1.5">{column.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className={clsx("text-xs", MUTED)}>
        {described.length > 0 ? "The columns the model's YAML describes." : "The model's YAML describes no column."} The columns and types of the compiled query come from its dry run.
      </div>
    </div>
  );
}

function ProjectTab({ state }: { state: PanelSlices }) {
  const block = state.dbt;
  const dbt = block?.dbt;
  const rows: Array<[string, string]> = [
    ["Backend", "dbt"],
    ["dbt", dbt ? `${dbt.path}  (found by ${dbt.foundBy})` : block?.looking ? "looking for it…" : "not found"],
    ["Version", engineLabel(dbt) || "not known"],
    ["dbt target", block?.target.name ? `${block.target.name}${block.target.overridden ? "  (override)" : ""}` : "not reported yet"],
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
          {block?.target.name && (
            <span data-dbt="target" className="px-2 py-1 rounded border border-[var(--vscode-widget-border)]">
              <span className={MUTED}>dbt target</span> <span className="font-mono">{block.target.name}</span>
            </span>
          )}
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
          <div className="p-4">
            {view.page === "panel" && tab === "compiled" && <CompiledTab state={state} view={view} />}
            {view.page === "panel" && tab === "schema" && <SchemaTab state={state} view={view} />}
            {tab === "project" && <ProjectTab state={state} />}
          </div>
        )}
      </div>
    </div>
  );
}
