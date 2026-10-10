import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Cloud, Loader2, RefreshCw, Terminal } from "lucide-react";
import clsx from "clsx";
import { ROW_TOKEN, ROW_TOKEN_SET } from "./SummaryRow";
import type { CompilationInfo } from "../../../src/utils/compilationInfo";
import { compilationInfoParts, compilationInfoTooltip, customCliLabel } from "../utils/compilationInfoFormat";
import { vscode } from "../utils/vscode";

/** Re-renders every `intervalMs` so relative times ("3 min ago") stay current. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * `mode` is the Compilation Mode currently selected. When `info` is missing or came from the other one
 * (e.g. an API compile failed before recording anything, leaving the last CLI compile behind), only the
 * current mode and its toggle are shown, since timings and paths of that compile would mislead.
 */
export function CompilationInfoBadge({ info, mode: selected, recompiling, className }: { info?: CompilationInfo; mode?: CompilationInfo["mode"]; recompiling?: boolean; className?: string }) {
  const now = useNow(30_000);
  const mode = selected ?? info?.mode;
  if (!mode || recompiling) {
    return null;
  }
  const current = info?.mode === mode ? info : undefined;

  const Icon = mode === "api" ? Cloud : Terminal;
  const cliLabel = current && customCliLabel(current);
  return (
    // A custom CLI's path can be long: it is cut short on the one line, where wrapping would give it a line or two of its own
    <div className={`flex ${cliLabel ? "min-w-0 [&>*]:flex-shrink-0 [&>*]:whitespace-nowrap" : "flex-wrap"} items-center gap-1.5 text-xs ${className ?? "text-[var(--vscode-descriptionForeground)]"}`} title={current ? compilationInfoTooltip(current) : undefined}>
      <Icon className="w-3 h-3" />
      <span>{current ? compilationInfoParts(current, now).join(" · ") : mode === "api" ? "API" : "CLI"}</span>
      {cliLabel && <span className="font-mono opacity-80 !flex-shrink min-w-[3rem] truncate">via {cliLabel}</span>}
      {current?.stale && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--vscode-editorWarning-foreground)] border border-[var(--vscode-editorWarning-foreground)]">
          <AlertTriangle className="w-3 h-3" /> outdated
        </span>
      )}
      <button
        type="button"
        onClick={() => vscode.postMessage({ command: "dataform.switchCompilationMode", compilationMode: mode === "api" ? "cli" : "api" })}
        title={mode === "api" ? "Compile locally with the Dataform CLI instead" : "Compile the pushed commit with the Dataform API instead (beta)"}
        className="underline decoration-dotted hover:text-[var(--vscode-textLink-activeForeground)]"
      >
        {mode === "api" ? "Use CLI" : "Use API"}
      </button>
      {mode === "api" && (
        <button
          type="button"
          onClick={() => vscode.postMessage({ command: "dataform.compileRemotely" })}
          title="Compile the latest pushed commit with the Dataform API"
          className="flex items-center px-2 py-0.5 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)]"
        >
          <RefreshCw className="w-3 h-3 mr-1" /> Recompile
        </button>
      )}
    </div>
  );
}

const MODES: { mode: CompilationInfo["mode"]; label: string; hint: string }[] = [
  { mode: "cli", label: "Dataform CLI", hint: "your local files" },
  { mode: "api", label: "Dataform API (beta)", hint: "the pushed commit" },
];

/**
 * How the file was compiled, as a token of an open row: which Compilation Mode, how long it took and how long ago.
 * A click opens what the badge says in a line of its own: the other mode to switch to, Recompile in API mode, and
 * the details the badge has in its tooltip. `mode` and `info` are the badge's, see `CompilationInfoBadge`.
 */
export function CompileModeToken({ info, mode: selected, recompiling }: { info?: CompilationInfo; mode?: CompilationInfo["mode"]; recompiling?: boolean }) {
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const mode = selected ?? info?.mode;
  if (!mode) {
    return null;
  }
  const current = info?.mode === mode ? info : undefined;
  const Icon = recompiling ? Loader2 : mode === "api" ? Cloud : Terminal;
  const switchTo = (to: CompilationInfo["mode"]) => {
    setOpen(false);
    if (to !== mode) {
      vscode.postMessage({ command: "dataform.switchCompilationMode", compilationMode: to });
    }
  };

  return (
    <div ref={root} className="relative flex-shrink-0 max-w-full">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="How the file was compiled. Click to compile another way, and for the details"
        className={clsx(ROW_TOKEN, "hover:bg-[var(--vscode-toolbar-hoverBackground)]")}
        style={current?.stale && !recompiling ? ROW_TOKEN_SET : undefined}
      >
        <Icon className={clsx("w-3 h-3 flex-shrink-0 text-[var(--vscode-descriptionForeground)]", recompiling && "animate-spin")} />
        <span className="truncate">{recompiling ? "Compiling…" : current ? compilationInfoParts(current, now).join(" · ") : mode === "api" ? "API" : "CLI"}</span>
        {current?.stale && !recompiling && <span className="flex items-center gap-1 text-[var(--vscode-editorWarning-foreground)]"><AlertTriangle className="w-3 h-3" /> outdated</span>}
        <ChevronDown className="w-3 h-3 flex-shrink-0 text-[var(--vscode-descriptionForeground)]" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="How the file was compiled"
          className="absolute left-0 top-full mt-1 z-20 w-[min(320px,calc(100vw-2rem))] p-1 rounded-md border border-[var(--vscode-menu-border,var(--vscode-widget-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-lg text-xs"
        >
          <div className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]">Compile with</div>
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="menuitemradio"
              aria-checked={option.mode === mode}
              onClick={() => switchTo(option.mode)}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-sm text-left bg-transparent border-0 hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,inherit)]"
            >
              <span className="w-3.5 flex-shrink-0">{option.mode === mode && <Check className="w-3.5 h-3.5" />}</span>
              <span>{option.label}</span>
              <span className="ml-auto opacity-70">{option.hint}</span>
            </button>
          ))}
          {mode === "api" && (
            <button
              type="button"
              onClick={() => { setOpen(false); vscode.postMessage({ command: "dataform.compileRemotely" }); }}
              title="Compile the latest pushed commit with the Dataform API"
              className="w-full flex items-center gap-2 px-2 py-1 mt-0.5 rounded-sm text-left bg-transparent border-0 hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,inherit)]"
            >
              <RefreshCw className="w-3.5 h-3.5 flex-shrink-0" /> Recompile the latest pushed commit
            </button>
          )}
          {current && (
            <div className="mt-1 px-2 pt-1.5 pb-1 border-t border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border))] whitespace-pre-wrap break-words text-[11px] text-[var(--vscode-descriptionForeground)]">
              {compilationInfoTooltip(current)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
