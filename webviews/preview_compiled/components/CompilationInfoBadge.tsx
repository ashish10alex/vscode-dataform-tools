import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, RefreshCw, Terminal } from "lucide-react";
import type { CompilationInfo } from "../../../src/utils/compilationInfo";
import { compilationInfoParts, compilationInfoTooltip, customCliLabel } from "../utils/compilationInfoFormat";
import { vscode } from "../utils/vscode";

type CompilationBackend = CompilationInfo["backend"];

/** Re-renders every `intervalMs` so relative times ("3 min ago") stay current. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * `backend` is the currently selected backend. When `info` is missing or came from the other backend
 * (e.g. an API compile failed before recording anything, leaving the last CLI compile behind), only the
 * current mode and its toggle are shown, since timings and paths of that compile would mislead.
 */
export function CompilationInfoBadge({ info, backend, recompiling, className }: { info?: CompilationInfo; backend?: CompilationBackend; recompiling?: boolean; className?: string }) {
  const now = useNow(30_000);
  const mode = backend ?? info?.backend;
  if (!mode || recompiling) {
    return null;
  }
  const current = info?.backend === mode ? info : undefined;

  const Icon = mode === "api" ? Cloud : Terminal;
  const cliLabel = current && customCliLabel(current);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className ?? "text-[var(--vscode-descriptionForeground)]"}`} title={current ? compilationInfoTooltip(current) : undefined}>
      <Icon className="w-3 h-3" />
      <span>{current ? compilationInfoParts(current, now).join(" · ") : mode === "api" ? "API" : "CLI"}</span>
      {cliLabel && <span className="font-mono opacity-80">via {cliLabel}</span>}
      {current?.stale && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--vscode-editorWarning-foreground)] border border-[var(--vscode-editorWarning-foreground)]">
          <AlertTriangle className="w-3 h-3" /> outdated
        </span>
      )}
      <button
        onClick={() => vscode.postMessage({ command: "switchCompilationBackend", value: mode === "api" ? "cli" : "api" })}
        title={mode === "api" ? "Compile locally with the Dataform CLI instead" : "Compile the pushed commit with the Dataform API instead (beta)"}
        className="underline decoration-dotted hover:text-[var(--vscode-textLink-activeForeground)]"
      >
        {mode === "api" ? "Use CLI" : "Use API"}
      </button>
      {mode === "api" && (
        <button
          onClick={() => vscode.postMessage({ command: "compileRemotely" })}
          title="Compile the latest pushed commit with the Dataform API"
          className="flex items-center px-2 py-0.5 bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] rounded text-[var(--vscode-button-secondaryForeground)]"
        >
          <RefreshCw className="w-3 h-3 mr-1" /> Recompile
        </button>
      )}
    </div>
  );
}
