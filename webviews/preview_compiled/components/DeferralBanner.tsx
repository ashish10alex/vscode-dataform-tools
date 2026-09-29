import { useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, CloudDownload, Settings2, Trash2 } from "lucide-react";
import type { DeferralView, DeferToProdState } from "../types";
import { vscode } from "../utils/vscode";

const STATUS_NOTE: Record<DeferralView["entries"][number]["status"], string | undefined> = {
  deferred: undefined,
  missingEverywhere: "not built in dev or prod",
  unreadable: "no read access to prod, using dev",
};

/** Which upstream tables of this file are read from prod, shown above the compiled SQL that already reflects it. */
const WARNING_BUTTON = "flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]";

export function DeferralBanner({ deferral, deferToProd, leftoverProxies }: { deferral?: DeferralView | null; deferToProd?: DeferToProdState; leftoverProxies?: string[] | null }) {
  // Collapsed to the summary by default, like the other sections of the panel; kept across recompiles
  const [expanded, setExpanded] = useState(false);
  if (!deferral && leftoverProxies && leftoverProxies.length > 0) {
    return (
      <div className="rounded-lg border border-[var(--vscode-editorWarning-foreground)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
          <span className="font-semibold text-[var(--vscode-foreground)]">
            {leftoverProxies.length} upstream table{leftoverProxies.length === 1 ? " is a proxy view" : "s are proxy views"} from an earlier deferred run, so {leftoverProxies.length === 1 ? "it reads" : "they read"} prod
          </span>
          <div className="flex-grow" />
          <button onClick={() => vscode.postMessage({ command: "toggleDeferToProd" })} className={WARNING_BUTTON}>
            <CloudDownload className="w-3 h-3" /> Turn on defer to prod
          </button>
          <button onClick={() => vscode.postMessage({ command: "removeProxyViews" })} className={WARNING_BUTTON}>
            <Trash2 className="w-3 h-3" /> Remove proxy views
          </button>
        </div>
        {leftoverProxies.map((id) => (
          <div key={id} className="font-mono text-[var(--vscode-descriptionForeground)]">{id}</div>
        ))}
      </div>
    );
  }
  if (deferToProd?.enabled && !deferToProd.available) {
    return (
      <div className="rounded-lg border border-[var(--vscode-editorWarning-foreground)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs flex flex-wrap items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
        <span className="font-semibold text-[var(--vscode-foreground)]">Defer to prod is on but not applied.</span>
        <span className="text-[var(--vscode-descriptionForeground)]">{deferToProd.reason}</span>
        <button
          onClick={() => vscode.postMessage({ command: "openDeferToProdSettings" })}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]"
        >
          <Settings2 className="w-3 h-3" /> Set prod options
        </button>
      </div>
    );
  }
  if (!deferral) {
    return null;
  }
  const deferred = deferral.entries.filter((entry) => entry.status === "deferred");
  const warnings = deferral.entries.filter((entry) => entry.stale || entry.status !== "deferred").length;
  const hasEntries = deferral.entries.length > 0;
  const openActions = () => vscode.postMessage({ command: "deferToProdActions" });
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs space-y-1.5">
      <div className="flex items-center gap-2 text-[var(--vscode-foreground)]">
        <button
          onClick={() => setExpanded(!expanded)}
          disabled={!hasEntries}
          aria-expanded={expanded}
          title={hasEntries ? (expanded ? "Hide the upstream tables" : "Show the upstream tables") : undefined}
          className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default"
        >
          {hasEntries ? <Chevron className="w-3.5 h-3.5 text-zinc-400" /> : <span className="w-3.5" />}
          <CloudDownload className="w-3.5 h-3.5 text-[var(--vscode-textLink-foreground)]" />
          <span className="font-semibold">Defer to prod</span>
          <span className="text-[var(--vscode-descriptionForeground)]">
            {deferred.length === 0
              ? "no upstream table is read from prod"
              : `${deferred.length} upstream table${deferred.length === 1 ? "" : "s"} read from prod`}
          </span>
          {warnings > 0 && (
            <span className="flex items-center gap-1 text-[var(--vscode-editorWarning-foreground)]">
              <AlertTriangle className="w-3 h-3" /> {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
        </button>
        <div className="flex-grow" />
        <button
          onClick={openActions}
          title="Turn off, refresh or configure defer to prod"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]"
        >
          <Settings2 className="w-3 h-3" /> Options
        </button>
      </div>
      {expanded && deferral.entries.map((entry) => {
        const note = entry.stale ? "changed on this branch, prod may be out of date" : STATUS_NOTE[entry.status];
        const isWarning = entry.stale || entry.status !== "deferred";
        return (
          <div key={entry.dev} className="flex flex-wrap items-center gap-1.5 font-mono text-[var(--vscode-descriptionForeground)]">
            {isWarning && <AlertTriangle className="w-3 h-3 text-[var(--vscode-editorWarning-foreground)]" />}
            <span>{entry.dev}</span>
            {entry.status === "deferred" && entry.prod && (
              <>
                <ArrowRight className="w-3 h-3" />
                <span className="text-[var(--vscode-foreground)]">{entry.prod}</span>
              </>
            )}
            {note && <span className="font-sans text-[var(--vscode-editorWarning-foreground)]">{note}</span>}
          </div>
        );
      })}
    </div>
  );
}
