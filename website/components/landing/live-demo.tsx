"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { MousePointerClick, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import type { DemoSource, TokenKind } from "@/lib/demo-source";

/*
 * The frame of the hero: a source file beside the compiled query panel, as in the editor. The panel is the
 * extension's own, in an iframe, fed by a stand-in for the extension host (public/demo/host.js) with states that
 * were recorded from the demo Projects. Until it has loaded, a screenshot of the same state is in its place.
 */

type Backend = DemoSource["backend"];

interface Terminal {
  command: string;
  lines: Array<{ at: number; text: string }>;
}

/** What the stand-in host tells this page */
type DemoMessage =
  | { source: "vdt-demo"; backend?: Backend; type: "rendered" | "preview" | "results shown" }
  | { source: "vdt-demo"; backend?: Backend; type: "terminal"; terminal: Terminal }
  | { source: "vdt-demo"; backend?: Backend; type: "note"; command: string };

/** What a click does in the editor, for the clicks the demo has no answer to */
const NOTES: Record<string, string> = {
  showDependencyGraph: "Opens the dependency graph of the project",
  "dataform.showDependencyInspector": "Opens the dependency inspector",
  "dataform.showColumnLineage": "Shows what a change to the columns breaks downstream",
  "dataform.loadLineage": "Asks Dataplex what else reads this table",
  formatFile: "Formats the file with SQLFluff",
  lintFile: "Lints the file with SQLFluff",
  "dataform.runTests": "Runs the tests of the file",
  runTags: "Runs every action with the tags you pick",
  "dataform.runTagsApi": "Runs every action with the tags you pick",
  "dataform.runChangedActions": "Runs only what you changed against the default branch",
  "dbt.runChangedActions": "Runs only what you changed against the default branch",
  "dataform.runWithOptions": "Runs files and tags of your choice",
  "dataform.toggleDeferToProd": "Reads upstream tables you have not built in dev from prod",
  "dataform.updateCompilerOptions": "Compiles again with your overrides",
  "dataform.switchCompilationMode": "Compiles with the CLI or with the Dataform API",
  "dataform.compileRemotely": "Compiles the pushed branch with the Dataform API",
  "dataform.estimateTagCost": "Estimates the cost of running a tag",
  "dataform.startSnooze": "Pauses compile-on-save for a while",
  "dataform.cancelWorkflowInvocation": "Cancels the run",
  "dataform.openBigQueryJob": "Opens the job in the Google Cloud console",
  "dataform.openExecutedSql": "Opens the SQL the run executed",
  "dataform.exportWorkflowActionsCsv": "Saves the run's actions as CSV",
  "dataform.clearWorkflowUrls": "Clears the list of runs",
  "dbt.setTarget": "Switches the dbt target and compiles again",
  "dbt.compileWithHooks": "Compiles with the project's on-run hooks",
  openAction: "Opens the file that defines the table",
  openFile: "Opens the file",
  openExternal: "Opens the Google Cloud console",
  link: "Opens the Google Cloud console",
  exportSchema: "Saves the schema to a file",
  followInfoLink: "Opens the setting or the file",
  selectProject: "Switches to another project of the workspace",
  showLogs: "Shows the extension's log",
  "results.openExternal": "Opens the job in the Google Cloud console",
  "results.downloadDataAsCsv": "Saves the rows as CSV",
  "results.queryLimit": "Runs the query again with another row limit",
  "results.runBigQueryJob": "Runs the query again",
};

const NOTE_AS_IS: Record<string, string> = {
  copyToClipboard: "Copied to the clipboard.",
  "demo.running": "This run is still going.",
};

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  keyword: "text-[#0000ff] dark:text-[#569cd6]",
  string: "text-[#a31515] dark:text-[#ce9178]",
  number: "text-[#098658] dark:text-[#b5cea8]",
  comment: "text-[#008000] dark:text-[#6a9955]",
  template: "text-[#795e26] dark:text-[#dcdcaa]",
  function: "text-[#795e26] dark:text-[#dcdcaa]",
};

const EDITOR = "bg-white text-black dark:bg-[#1e1e1e] dark:text-[#d4d4d4]";
// As tall as the window leaves under the header and the headline, so that the whole frame is in view on arrival
const FRAME_HEIGHT = "h-[clamp(420px,calc(100svh-14.5rem),760px)]";
// Scrolls as an editor does, without a bar
const NO_BAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function Source({ source }: { source: DemoSource }) {
  return (
    <div className={cn("h-full overflow-auto py-3 text-left font-mono text-[12px] leading-[19px]", NO_BAR, EDITOR)}>
      <div className="px-4 pb-2 font-sans text-[11px] text-[#616161] dark:text-[#cccccc]/70">{source.path}</div>
      {source.lines.map((line, index) => (
        <div key={index} className="flex min-w-max pr-4">
          <span className="w-11 shrink-0 select-none pr-4 text-right text-[#237893] dark:text-[#858585]" aria-hidden>
            {index + 1}
          </span>
          <span className="whitespace-pre">
            {line.length === 0
              ? " "
              : line.map((token, tokenIndex) => (
                  <span key={tokenIndex} className={TOKEN_CLASS[token.kind]}>
                    {token.text}
                  </span>
                ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function TerminalPane({ terminal, run }: { terminal: Terminal; run: number }) {
  const [shown, setShown] = useState(0);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShown(0);
    const timers = terminal.lines.map((line, index) => setTimeout(() => setShown(index + 1), line.at));
    return () => timers.forEach(clearTimeout);
  }, [terminal, run]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [shown]);

  return (
    <div className={cn("h-full overflow-auto px-4 py-2 text-left font-mono text-[12px] leading-[18px]", NO_BAR, EDITOR)} aria-live="polite">
      <div className="whitespace-pre-wrap break-all">
        <span className="text-[#098658] dark:text-[#89d185]">football %</span> {terminal.command}
      </div>
      {terminal.lines.slice(0, shown).map((line, index) => (
        <div key={index} className="whitespace-pre-wrap">
          {line.text || " "}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

export function LiveDemo({ sources }: { sources: DemoSource[] }) {
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "light" ? "light" : "dark";
  const [backend, setBackend] = useState<Backend>("dataform");
  /** The panel is mounted only once the page has loaded, so that it does not hold up the hero's first paint */
  const [mounted, setMounted] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [narrowView, setNarrowView] = useState<"panel" | "source">("panel");
  const [bottom, setBottom] = useState<"terminal" | "results" | null>(null);
  const [terminal, setTerminal] = useState<{ terminal: Terminal; run: number } | null>(null);
  const [previews, setPreviews] = useState(0);
  const [note, setNote] = useState<{ text: string; install: boolean; id: number } | null>(null);
  const panel = useRef<HTMLIFrameElement>(null);
  const results = useRef<HTMLIFrameElement>(null);
  /** The theme the iframes were opened with: a later change is told to them, which keeps what the visitor did */
  const openedWith = useRef(theme);
  const pulsed = useRef(false);

  const source = sources.find((candidate) => candidate.backend === backend)!;

  useEffect(() => {
    openedWith.current = theme;
    const mount = () => setMounted(true);
    if (document.readyState === "complete") {
      mount();
      return;
    }
    window.addEventListener("load", mount, { once: true });
    return () => window.removeEventListener("load", mount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (const frame of [panel.current, results.current]) {
      (frame?.contentWindow as (Window & { demoSetTheme?: (theme: string) => void }) | null | undefined)?.demoSetTheme?.(theme);
    }
  }, [theme, rendered, bottom]);

  useEffect(() => {
    if (!note) {
      return;
    }
    const timer = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(timer);
  }, [note]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data as DemoMessage | undefined;
      if (event.origin !== window.location.origin || message?.source !== "vdt-demo") {
        return;
      }
      // A message of the panel that was on show before the other file's tab was chosen
      if (message.backend && message.backend !== backend) {
        return;
      }
      switch (message.type) {
        case "rendered":
          setRendered(true);
          if (!pulsed.current) {
            pulsed.current = true;
            setTimeout(() => (panel.current?.contentWindow as (Window & { demoPulse?: () => void }) | null | undefined)?.demoPulse?.(), 500);
          }
          return;
        case "terminal":
          setTerminal((last) => ({ terminal: message.terminal, run: (last?.run ?? 0) + 1 }));
          setBottom("terminal");
          return;
        case "preview":
          setPreviews((count) => count + 1);
          setBottom("results");
          return;
        case "note":
          setNote(
            NOTE_AS_IS[message.command]
              ? { text: NOTE_AS_IS[message.command], install: false, id: Date.now() }
              : { text: `${NOTES[message.command] ?? "This works"} in the editor.`, install: true, id: Date.now() }
          );
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [backend]);

  const choose = useCallback((next: Backend) => {
    setBackend((current) => {
      if (current !== next) {
        setRendered(false);
        setBottom(null);
        setTerminal(null);
        setNote(null);
      }
      return next;
    });
  }, []);

  const tab = (active: boolean) =>
    cn(
      "flex h-full items-center gap-1.5 border-r px-3 font-mono text-[11px] transition-colors",
      active ? "bg-white text-foreground dark:bg-[#1e1e1e]" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <figure className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_0_0_hsl(var(--border)),0_24px_48px_-24px_rgb(0_0_0/0.35)]">
      <div className="flex h-9 items-stretch border-b bg-muted/40">
        <span className="flex items-center gap-1.5 px-3.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <div role="tablist" aria-label="Demo project" className="flex min-w-0 items-stretch border-l">
          {sources.map((candidate) => (
            <button
              key={candidate.backend}
              role="tab"
              type="button"
              aria-selected={candidate.backend === backend}
              onClick={() => choose(candidate.backend)}
              className={tab(candidate.backend === backend)}
            >
              <span className="truncate">{candidate.fileName}</span>
              <span className="rounded bg-foreground/10 px-1 py-px font-sans text-[10px] text-muted-foreground">
                {candidate.backend === "dbt" ? "dbt" : "Dataform"}
              </span>
            </button>
          ))}
        </div>
        <figcaption className="ml-auto hidden items-center gap-1.5 px-3.5 text-[11px] text-muted-foreground sm:flex">
          <MousePointerClick className="h-3.5 w-3.5 text-brand" aria-hidden />
          Live demo · click around
        </figcaption>
      </div>

      {/* Below the md breakpoint the two do not fit side by side: one is on show, the other a tap away */}
      <div className="flex border-b text-[11px] md:hidden" role="tablist" aria-label="View">
        {(["panel", "source"] as const).map((view) => (
          <button
            key={view}
            role="tab"
            type="button"
            aria-selected={narrowView === view}
            onClick={() => setNarrowView(view)}
            className={cn("flex-1 py-1.5", narrowView === view ? "bg-white font-medium text-foreground dark:bg-[#1e1e1e]" : "text-muted-foreground")}
          >
            {view === "panel" ? "Compiled query" : "Source"}
          </button>
        ))}
      </div>

      <div className={cn("relative grid md:grid-cols-[minmax(0,9fr)_minmax(0,13fr)]", FRAME_HEIGHT)}>
        <div className={cn("min-h-0 border-r", narrowView === "source" ? "block" : "hidden md:block")}>
          <Source source={source} />
        </div>

        <div className={cn("relative min-h-0", EDITOR, narrowView === "panel" ? "block" : "hidden md:block")}>
          {/* The screenshots are of the panel in this state; both are rendered, so the right one is there on first paint */}
          {(["light", "dark"] as const).map((shade) => (
            <img
              key={shade}
              src={`/demo/poster-${backend}-${shade}.png`}
              alt={shade === "dark" ? "The compiled query panel: the compiled SQL of the model, what a dry run says it will scan and cost, and the buttons to run and preview it" : ""}
              aria-hidden={shade === "light" || rendered}
              className={cn(
                "absolute inset-0 h-full w-full object-cover object-left-top transition-opacity duration-300",
                shade === "dark" ? "hidden dark:block" : "block dark:hidden",
                rendered && "opacity-0"
              )}
            />
          ))}
          {mounted && (
            <iframe
              key={backend}
              ref={panel}
              src={`/demo/panel.html?backend=${backend}&theme=${openedWith.current}`}
              title={`Live demo of the compiled query panel, for a ${backend === "dbt" ? "dbt" : "Dataform"} model`}
              allow="clipboard-write"
              className={cn("absolute inset-0 h-full w-full border-0 transition-opacity duration-300", rendered ? "opacity-100" : "opacity-0")}
            />
          )}
        </div>

        {bottom && (
          <div className="absolute inset-x-0 bottom-0 flex h-[56%] flex-col border-t shadow-[0_-12px_24px_-16px_rgb(0_0_0/0.4)] motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-200">
            <div className="flex h-8 shrink-0 items-center border-b bg-muted text-[11px] uppercase tracking-wide">
              {(["terminal", "results"] as const).map((pane) => {
                const available = pane === "terminal" ? !!terminal : previews > 0;
                return (
                  <button
                    key={pane}
                    type="button"
                    disabled={!available}
                    onClick={() => setBottom(pane)}
                    className={cn(
                      "h-full border-b-2 px-3.5",
                      bottom === pane ? "border-brand text-foreground" : "border-transparent text-muted-foreground",
                      !available && "opacity-40"
                    )}
                  >
                    {pane === "terminal" ? "Terminal" : "Query results"}
                  </button>
                );
              })}
              <button type="button" onClick={() => setBottom(null)} className="ml-auto flex h-full items-center px-3 text-muted-foreground hover:text-foreground" aria-label="Close the bottom panel">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className={cn("relative min-h-0 flex-1", EDITOR)}>
              {terminal && (
                <div className={cn("absolute inset-0", bottom !== "terminal" && "hidden")}>
                  <TerminalPane terminal={terminal.terminal} run={terminal.run} />
                </div>
              )}
              {previews > 0 && (
                <iframe
                  key={`${backend}-${previews}`}
                  ref={results}
                  src={`/demo/results.html?backend=${backend}&theme=${theme}`}
                  title="Live demo of the query results, with rows made up for the demo"
                  className={cn("absolute inset-0 h-full w-full border-0", bottom !== "results" && "hidden")}
                />
              )}
            </div>
          </div>
        )}

        {note && (
          <div key={note.id} role="status" className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-popover px-3.5 py-2 text-left text-xs text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
              <span>{note.text}</span>
              {note.install && (
                <a href={site.marketplace.vscode} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-brand underline-offset-4 hover:underline">
                  Install
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
