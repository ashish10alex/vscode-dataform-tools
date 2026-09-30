import { useEffect, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronRight, CloudDownload, RotateCw, ScrollText, Settings2, Trash2 } from "lucide-react";
import type { DeferralView, DeferToProdState } from "../types";
import { vscode } from "../utils/vscode";
import { ModifierSwitch } from "./ModifierSwitch";
import { formatRelativeTime } from "../utils/compilationInfoFormat";

type DeferralEntryView = Extract<DeferralView, { status: "ready" }>["entries"][number];
type BuiltInDevView = NonNullable<Extract<DeferralView, { status: "ready" }>["builtInDev"]>[number];

/** Built in dev tables grouped by `project.dataset`, both sorted, so long ids are not repeated on every row */
function groupByDataset(tables: BuiltInDevView[]): [string, { name: string; id: string; lastModified?: number }[]][] {
  const groups = new Map<string, { name: string; id: string; lastModified?: number }[]>();
  for (const table of tables) {
    const split = table.dev.lastIndexOf(".");
    const dataset = table.dev.slice(0, split);
    groups.set(dataset, [...(groups.get(dataset) ?? []), { name: table.dev.slice(split + 1), id: table.dev, lastModified: table.lastModified }]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dataset, rows]) => [dataset, rows.sort((a, b) => a.name.localeCompare(b.name))]);
}

const STATUS_NOTE: Record<DeferralEntryView["status"], string | undefined> = {
  deferred: undefined,
  missingEverywhere: "not built in dev or prod",
  unreadable: "no read access to prod, using dev",
};

const SECONDARY_BUTTON = "flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-secondaryForeground)] bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)]";
const PRIMARY_BUTTON = "flex items-center gap-1 px-2 py-0.5 rounded text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]";
const WARNING_BOX = "rounded-lg border border-[var(--vscode-editorWarning-foreground)] bg-[var(--vscode-sideBar-background)] px-3 py-2 text-xs";
/** The prod compile takes a few seconds; past this the lookup has most likely failed without saying so */
const SLOW_LOOKUP_MS = 30_000;
const BUILT_IN_DEV_TITLE = "Built in dev, so it is read from dev, like dbt --defer. Upstream tables are only read from prod when they are not built in dev.";
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
  // Set by Retry until the panel redraws with the new lookup
  const [retrying, setRetrying] = useState(false);
  useEffect(() => setRetrying(false), [deferral]);

  // Waiting for the upstream tables: just switched on, or retried. The panel redraws once they are looked up.
  const pending = !!deferToProd?.available && on && (!deferral || retrying);
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) {
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_LOOKUP_MS);
    return () => clearTimeout(timer);
  }, [pending, attempt]);

  if (!deferToProd) {
    return null;
  }
  const toggle = (checked: boolean) => {
    setOn(checked);
    setExpanded(false);
    vscode.postMessage({ command: "toggleDeferToProd", value: checked });
  };
  const retry = () => {
    setRetrying(true);
    setAttempt((count) => count + 1);
    vscode.postMessage({ command: "retryDeferral" });
  };
  const deferSwitch = <ModifierSwitch label="Defer to prod" checked={on} onChange={toggle} title={SWITCH_TITLE} />;
  const setProdOptionsButton = (label: string, primary: boolean) => (
    <button onClick={() => vscode.postMessage({ command: "openDeferToProdSettings" })} className={primary ? PRIMARY_BUTTON : SECONDARY_BUTTON}>
      <Settings2 className="w-3 h-3" /> {label}
    </button>
  );
  const retryButton = (
    <button onClick={retry} title="Compile with the prod options and look up the upstream tables again" className={SECONDARY_BUTTON}>
      <RotateCw className="w-3 h-3" /> Retry
    </button>
  );
  const logsButton = (
    <button onClick={() => vscode.postMessage({ command: "showLogs" })} title="Open the Dataform Tools output" className={SECONDARY_BUTTON}>
      <ScrollText className="w-3 h-3" /> Show logs
    </button>
  );

  // Off, but proxy views from an earlier deferred run still read prod: a warning, so it stays expanded
  if (!on && leftoverProxies && leftoverProxies.length > 0) {
    return (
      <div className={clsx(WARNING_BOX, "space-y-1.5")}>
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

  // Availability does not depend on the setting, so this shows as soon as the switch is flipped
  if (!deferToProd.available) {
    return (
      <div className={clsx(WARNING_BOX, "flex flex-wrap items-center gap-2")}>
        {deferSwitch}
        <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
        <span className="font-semibold text-[var(--vscode-foreground)]">On but not applied.</span>
        <span className="text-[var(--vscode-descriptionForeground)]">{deferToProd.reason}</span>
        {setProdOptionsButton("Set prod options", true)}
      </div>
    );
  }

  if (deferral?.status === "error" && !pending) {
    return (
      <div className={clsx(WARNING_BOX, "space-y-1.5")}>
        <div className="flex flex-wrap items-center gap-2">
          {deferSwitch}
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--vscode-editorWarning-foreground)]" />
          <span className="font-semibold text-[var(--vscode-foreground)]">Could not look up the upstream tables, so nothing is read from prod.</span>
          <div className="flex-grow" />
          {setProdOptionsButton("Set prod options", true)}
          {retryButton}
          {logsButton}
        </div>
        <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[var(--vscode-descriptionForeground)]">{deferral.message}</div>
      </div>
    );
  }

  const entries = deferral?.status === "ready" ? deferral.entries : [];
  const deferred = entries.filter((entry) => entry.status === "deferred");
  const warnings = entries.filter((entry) => entry.stale || entry.status !== "deferred").length;
  const builtInDev = deferral?.status === "ready" ? deferral.builtInDev ?? [] : [];
  const hasEntries = !pending && (entries.length > 0 || builtInDev.length > 0);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  // Every upstream table that has a prod name is missing there: the prod options likely point at the wrong place
  const withProd = entries.filter((entry) => entry.prod);
  const noneInProd = !pending && withProd.length > 0 && withProd.every((entry) => entry.status === "missingEverywhere");
  const summary = pending
    ? (slow ? "still looking up upstream tables, this is taking longer than usual" : "looking up upstream tables…")
    : noneInProd
      ? `none of the ${withProd.length} upstream table${withProd.length === 1 ? " was" : "s were"} found in prod`
      : deferred.length === 0
        ? builtInDev.length === 0
          ? "no upstream table is read from prod"
          : `nothing read from prod: ${entries.length > 0 ? `${builtInDev.length} upstream table${builtInDev.length === 1 ? " is" : "s are"}` : builtInDev.length === 1 ? "the upstream table is" : `all ${builtInDev.length} upstream tables are`} built in dev`
        : `${deferred.length} upstream table${deferred.length === 1 ? "" : "s"} read from prod${builtInDev.length > 0 ? `, ${builtInDev.length} built in dev read from dev` : ""}`;

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
          <CloudDownload className={clsx("w-3.5 h-3.5", pending ? "text-[var(--vscode-descriptionForeground)] animate-pulse" : "text-[var(--vscode-textLink-foreground)]")} />
          <span className={noneInProd ? "text-[var(--vscode-editorWarning-foreground)]" : "text-[var(--vscode-descriptionForeground)]"}>{summary}</span>
          {!pending && !noneInProd && warnings > 0 && (
            <span className="flex items-center gap-1 text-[var(--vscode-editorWarning-foreground)]">
              <AlertTriangle className="w-3 h-3" /> {warnings} warning{warnings === 1 ? "" : "s"}
            </span>
          )}
          {hasEntries && <Chevron className="w-3.5 h-3.5 text-zinc-400" />}
        </button>
        <div className="flex-grow" />
        {pending && slow && retryButton}
        {pending && slow && logsButton}
        {noneInProd && setProdOptionsButton("Check prod options", false)}
        <button
          onClick={() => vscode.postMessage({ command: "deferToProdActions" })}
          title="Refresh, remove proxy views or configure defer to prod"
          className={SECONDARY_BUTTON}
        >
          <Settings2 className="w-3 h-3" /> Options
        </button>
      </div>
      {expanded && hasEntries && entries.map((entry) => {
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
      {expanded && hasEntries && builtInDev.length > 0 && (
        <div title={BUILT_IN_DEV_TITLE} className="space-y-1.5 pt-0.5">
          <div className="text-[var(--vscode-descriptionForeground)]">Built in dev, so read from dev</div>
          {/* One grid for every group, so the times line up down the whole list */}
          <div className="grid grid-cols-[minmax(0,max-content)_1fr] gap-x-6">
            {groupByDataset(builtInDev).map(([dataset, rows], index) => (
              <div key={dataset} className="contents">
                <div className={clsx("col-span-2 font-mono text-[var(--vscode-descriptionForeground)] truncate", index > 0 && "mt-1.5")}>{dataset}</div>
                {rows.map((row) => (
                  <div key={row.id} className="contents">
                    <span title={row.id} className="pl-4 font-mono text-[var(--vscode-foreground)] truncate">{row.name}</span>
                    <span className="whitespace-nowrap text-[var(--vscode-descriptionForeground)]">
                      {row.lastModified ? `updated ${formatRelativeTime(row.lastModified, Date.now())}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
