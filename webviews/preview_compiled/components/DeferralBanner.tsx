import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, CloudDownload, Settings2, Trash2 } from "lucide-react";
import type { DeferralView, DeferToProdState } from "../types";
import { vscode } from "../utils/vscode";
import { ModifierSwitch } from "./ModifierSwitch";

const STATUS_NOTE: Record<DeferralView["entries"][number]["status"], string | undefined> = {
  deferred: undefined,
  missingEverywhere: "not built in dev or prod",
  unreadable: "no read access to prod, using dev",
};

const SECONDARY_BUTTON = "flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]";
const SWITCH_TITLE = "Read upstream tables that are not built in dev from prod, in the compiled SQL, dry run, Preview Data and runs (like dbt --defer)";

/**
 * Defer to prod for the file shown: the switch, a one-line summary and, expanded, which upstream tables are read
 * from prod. Always shown for a query file, as a quiet dashed strip while defer to prod is off, so the switch sits
 * next to what it changes.
 */
export function DeferralBanner({ deferral, deferToProd, leftoverProxies }: { deferral?: DeferralView | null; deferToProd?: DeferToProdState; leftoverProxies?: string[] | null }) {
  // Collapsed to the summary by default, like the other sections of the panel; kept across recompiles
  const [expanded, setExpanded] = useState(false);
  // Follows the setting, but flips at once on click instead of waiting for the panel to redraw
  const [on, setOn] = useState(!!deferToProd?.enabled);
  useEffect(() => setOn(!!deferToProd?.enabled), [deferToProd?.enabled]);

  if (!deferToProd) {
    return null;
  }
  const toggle = (checked: boolean) => {
    setOn(checked);
    setExpanded(false);
    vscode.postMessage({ command: "toggleDeferToProd", value: checked });
  };
  const deferSwitch = <ModifierSwitch label="Defer to prod" checked={on} onChange={toggle} title={SWITCH_TITLE} />;

  // Off, but proxy views from an earlier deferred run still read prod: a warning, so it stays expanded
  if (!on && leftoverProxies && leftoverProxies.length > 0) {
    return (
      <div className="rounded-lg border border-[var(--vscode-editorWarning-foreground)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {deferSwitch}
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
          <span className="font-semibold text-[var(--vscode-foreground)]">
            {leftoverProxies.length} upstream table{leftoverProxies.length === 1 ? " is a proxy view" : "s are proxy views"} from an earlier deferred run, so {leftoverProxies.length === 1 ? "it reads" : "they read"} prod
          </span>
          <div className="flex-grow" />
          <button onClick={() => vscode.postMessage({ command: "removeProxyViews", value: leftoverProxies })} className={SECONDARY_BUTTON}>
            <Trash2 className="w-3 h-3" /> Remove proxy views
          </button>
        </div>
        {leftoverProxies.map((id) => (
          <div key={id} className="font-mono text-[var(--vscode-descriptionForeground)]">{id}</div>
        ))}
      </div>
    );
  }

  if (!on) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--vscode-widget-border)] px-3 py-1.5 text-xs flex flex-wrap items-center gap-2">
        {deferSwitch}
        <span className="text-[var(--vscode-descriptionForeground)]">off: upstream tables are read from dev</span>
      </div>
    );
  }

  if (!deferToProd.available && deferToProd.enabled) {
    return (
      <div className="rounded-lg border border-[var(--vscode-editorWarning-foreground)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs flex flex-wrap items-center gap-2">
        {deferSwitch}
        <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
        <span className="font-semibold text-[var(--vscode-foreground)]">On but not applied.</span>
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

  const entries = deferral?.entries ?? [];
  const deferred = entries.filter((entry) => entry.status === "deferred");
  const warnings = entries.filter((entry) => entry.stale || entry.status !== "deferred").length;
  const hasEntries = entries.length > 0;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // Just switched on: the panel redraws once the upstream tables have been looked up
  const summary = !deferral
    ? "looking up upstream tables…"
    : deferred.length === 0
      ? "no upstream table is read from prod"
      : `${deferred.length} upstream table${deferred.length === 1 ? "" : "s"} read from prod`;

  return (
    <div className="rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-[var(--vscode-foreground)]">
        {deferSwitch}
        <button
          onClick={() => setExpanded(!expanded)}
          disabled={!hasEntries}
          aria-expanded={expanded}
          title={hasEntries ? (expanded ? "Hide the upstream tables" : "Show the upstream tables") : undefined}
          className="flex items-center gap-2 min-w-0 text-left disabled:cursor-default"
        >
          <CloudDownload className={clsx("w-3.5 h-3.5", deferral ? "text-[var(--vscode-textLink-foreground)]" : "text-[var(--vscode-descriptionForeground)] animate-pulse")} />
          <span className="text-[var(--vscode-descriptionForeground)]">{summary}</span>
          {warnings > 0 && (
            <span className="flex items-center gap-1 text-[var(--vscode-editorWarning-foreground)]">
              <AlertTriangle className="w-3 h-3" /> {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
          {hasEntries && <Chevron className="w-3.5 h-3.5 text-zinc-400" />}
        </button>
        <div className="flex-grow" />
        <button
          onClick={() => vscode.postMessage({ command: "deferToProdActions" })}
          title="Refresh, remove proxy views or configure defer to prod"
          className={SECONDARY_BUTTON}
        >
          <Settings2 className="w-3 h-3" /> Options
        </button>
      </div>
      {expanded && entries.map((entry) => {
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
