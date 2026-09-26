import { useEffect, useState } from "react";
import { AlertTriangle, Cloud, RefreshCw, Terminal } from "lucide-react";
import type { CompilationInfo } from "../../../src/utils/compilationInfo";
import { compilationInfoParts, compilationInfoTooltip, customCliLabel } from "../utils/compilationInfoFormat";
import { vscode } from "../utils/vscode";

/** Re-renders every `intervalMs` so relative times ("3 min ago") stay current. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function CompilationInfoBadge({ info, recompiling, className }: { info?: CompilationInfo; recompiling?: boolean; className?: string }) {
  const now = useNow(30_000);
  if (!info || recompiling) {
    return null;
  }

  const Icon = info.backend === "api" ? Cloud : Terminal;
  const cliLabel = customCliLabel(info);
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-xs ${className ?? "text-[var(--vscode-descriptionForeground)]"}`} title={compilationInfoTooltip(info)}>
      <Icon className="w-3 h-3" />
      <span>{compilationInfoParts(info, now).join(" · ")}</span>
      {cliLabel && <span className="font-mono opacity-80">via {cliLabel}</span>}
      {info.stale && (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[var(--vscode-editorWarning-foreground)] border border-[var(--vscode-editorWarning-foreground)]">
          <AlertTriangle className="w-3 h-3" /> outdated
        </span>
      )}
      <button
        onClick={() => vscode.postMessage({ command: "switchCompilationBackend", value: info.backend === "api" ? "cli" : "api" })}
        title={info.backend === "api" ? "Compile locally with the Dataform CLI instead" : "Compile the pushed commit with the Dataform API instead (beta)"}
        className="underline decoration-dotted hover:text-[var(--vscode-textLink-activeForeground)]"
      >
        {info.backend === "api" ? "Use CLI" : "Use API"}
      </button>
      {info.backend === "api" && (
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
