import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, GitCompare, Loader2, Play, RefreshCw } from "lucide-react";
import { ChangedActionsView } from "../types";
import { vscode } from "../utils/vscode";
import { describeComparison } from "../../../src/shared/changeComparison";
import { countTypeNames, describeTypeCounts } from "../../../src/shared/actionTypes";
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "../utils/constants";

const REASON_LABELS: Record<string, { label: string; title: string }> = {
  new: { label: "new", title: "Not in the default branch" },
  sql: { label: "SQL", title: "Compiled query, incremental query or pre/post operations differ" },
  config: { label: "config", title: "Materialization settings differ (type, partitioning, clustering, unique key, ...)" },
};

/** Up to this many changed actions, every file starts expanded. */
const EXPAND_ALL_UP_TO = 5;

const NONE_CHANGED: NonNullable<ChangedActionsView["changed"]> = [];
const NONE_DELETED: NonNullable<ChangedActionsView["deleted"]> = [];

interface RunChangedButtonProps {
  changedActions?: ChangedActionsView;
  isRemoteMode: boolean;
  disabled: boolean;
  includeDependencies: boolean;
  includeDependents: boolean;
  fullRefresh: boolean;
  onApiRunDispatched: () => void;
}

/** The project is nearly always the same, so only the dataset (muted) and name are shown. */
function splitTarget(target: string): { dataset: string; name: string } {
  const parts = target.split(".");
  return { dataset: parts.length > 1 ? parts[parts.length - 2] : "", name: parts[parts.length - 1] };
}

/** File name first, since the folder (without the common `definitions/`) is only context. */
function splitFile(rawFileName: string): { base: string; dir: string } {
  const fileName = rawFileName.replace(/\\/g, "/");
  const slash = fileName.lastIndexOf("/");
  const dir = slash >= 0 ? fileName.slice(0, slash).replace(/^definitions\/?/, "") : "";
  return { base: slash >= 0 ? fileName.slice(slash + 1) : fileName, dir };
}

const FileHeading: React.FC<{ fileName: string }> = ({ fileName }) => {
  const { base, dir } = splitFile(fileName);
  return (
    <div className="flex items-baseline gap-2 min-w-0" title={fileName}>
      <span className="font-semibold text-[var(--vscode-foreground)] break-all">{base}</span>
      {dir && <span className="text-[11px] text-[var(--vscode-descriptionForeground)] truncate">{dir}</span>}
    </div>
  );
};

const ActionName: React.FC<{ target: string; className?: string }> = ({ target, className = "" }) => {
  const { dataset, name } = splitTarget(target);
  return (
    <span className={`font-mono [overflow-wrap:anywhere] ${className}`} title={target}>
      {dataset && <span className="text-[var(--vscode-descriptionForeground)]">{dataset}.</span>}
      {name}
    </span>
  );
};

type ChangedAction = NonNullable<ChangedActionsView["changed"]>[number];

const ReasonBadge: React.FC<{ reason: string }> = ({ reason }) => (
  <span
    title={REASON_LABELS[reason]?.title}
    className="px-1 rounded text-[10px] bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]"
  >
    {REASON_LABELS[reason]?.label ?? reason}
  </span>
);

/** A file's changed actions: one row with its type counts and reasons, expanding to the actions. */
const ChangedFileGroup: React.FC<{ fileName: string; actions: ChangedAction[]; expanded: boolean; onToggle: () => void }> = ({ fileName, actions, expanded, onToggle }) => {
  const reasons = (["new", "sql", "config"] as const).filter((reason) => actions.some((a) => a.reasons.includes(reason)));
  return (
    <div className="py-1.5 border-t first:border-t-0 border-[var(--vscode-widget-border)]">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full grid grid-cols-[auto_1fr_auto] items-center gap-1.5 rounded text-left hover:bg-[var(--vscode-toolbar-hoverBackground)]"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <FileHeading fileName={fileName} />
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">{describeTypeCounts(countTypeNames(actions.map((a) => a.type)))}</span>
          {reasons.map((reason) => <ReasonBadge key={reason} reason={reason} />)}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1 space-y-1">
          {actions.map((action) => {
            const badge = ACTION_TYPE_BADGE_STYLES[action.type] ?? DEFAULT_BADGE_STYLE;
            return (
              <li key={action.target} className="grid grid-cols-[1fr_auto] items-start gap-3 pl-5">
                <ActionName target={action.target} />
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <span className={`px-1 rounded border text-[10px] ${badge.bg} ${badge.text} ${badge.border}`}>{action.type}</span>
                  {action.reasons.map((reason) => <ReasonBadge key={reason} reason={reason} />)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

function groupByFile<T extends { fileName: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.fileName || "(unknown file)";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

/** Runs only the actions that changed vs the default branch; the popover lists what would run. */
export const RunChangedButton: React.FC<RunChangedButtonProps> = ({
  changedActions,
  isRemoteMode,
  disabled,
  includeDependencies,
  includeDependents,
  fullRefresh,
  onApiRunDispatched,
}) => {
  const [open, setOpen] = useState(false);
  // Files whose expansion differs from the default, which depends on the size of the change set
  const [toggledFiles, setToggledFiles] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Left offset from the button's wrapper. Undefined until measured, when the popover is right-aligned.
  const [popoverLeft, setPopoverLeft] = useState<number | undefined>(undefined);

  // Right-align with the button when there is room, otherwise shift so the popover stays inside the
  // panel; the toolbar wraps, so the button can sit anywhere along the row.
  useLayoutEffect(() => {
    if (!open) { return; }
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      const popover = popoverRef.current;
      if (!anchor || !popover) { return; }
      const margin = 16;
      const width = popover.offsetWidth;
      const viewportWidth = document.documentElement.clientWidth;
      const left = Math.max(margin, Math.min(anchor.right - width, viewportWidth - margin - width));
      setPopoverLeft(left - anchor.left);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) { return; }
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const changed = changedActions?.changed ?? NONE_CHANGED;
  const deleted = changedActions?.deleted ?? NONE_DELETED;
  const changedGroups = useMemo(() => groupByFile(changed), [changed]);
  const deletedGroups = useMemo(() => groupByFile(deleted), [deleted]);

  if (!changedActions || changedActions.status === "unavailable") {
    return null;
  }

  const status = changedActions.status;
  const baseRef = changedActions.baseRef ?? "default branch";
  const headRef = changedActions.headRef;
  const comparison = describeComparison(headRef, baseRef);
  const noChanges = status === "ready" && changed.length === 0;
  const onDefaultBranch = status === "ready" && !!changedActions.onDefaultBranch;
  const defaultBranch = changedActions.defaultBranch ?? baseRef.replace(/^origin\//, "");
  const flags = [
    includeDependencies && "+dependencies",
    includeDependents && "+dependents",
    fullRefresh && "full refresh",
  ].filter(Boolean) as string[];

  const reasonCounts = (["new", "sql", "config"] as const)
    .map((reason) => [reason, changed.filter((a) => a.reasons.includes(reason)).length] as const)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${count} ${REASON_LABELS[reason].label}`);
  const typeCounts = describeTypeCounts(countTypeNames(changed.map((a) => a.type)));
  const summary = `${changed.length} action${changed.length === 1 ? "" : "s"} in ${changedGroups.length} file${changedGroups.length === 1 ? "" : "s"}${typeCounts ? `: ${typeCounts}` : ""} · ${reasonCounts.join(" · ")}`;

  const expandedByDefault = changed.length <= EXPAND_ALL_UP_TO;
  const isExpanded = (fileName: string) => expandedByDefault !== toggledFiles.has(fileName);
  const allExpanded = changedGroups.every(([fileName]) => isExpanded(fileName));
  const toggleFile = (fileName: string) => setToggledFiles((prev) => {
    const next = new Set(prev);
    if (!next.delete(fileName)) { next.add(fileName); }
    return next;
  });
  // Expanding all toggles every file only when they start collapsed, and collapsing all the reverse
  const setAllExpanded = (expand: boolean) =>
    setToggledFiles(expand === expandedByDefault ? new Set() : new Set(changedGroups.map(([fileName]) => fileName)));

  const compute = () => vscode.postMessage({ command: "computeChangedActions" });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) { setToggledFiles(new Set()); }
    if (next && status !== "ready" && status !== "computing") {
      compute();
    }
  };

  const run = (api: boolean) => {
    vscode.postMessage({
      command: "runChangedActions",
      value: { api, includeDependencies, includeDependents, fullRefresh },
    });
    if (api) { onApiRunDispatched(); }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        disabled={disabled}
        className="pl-3 pr-2 py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded text-sm flex items-center disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]"
        title={noChanges ? `No changes ${comparison}. Click to recheck` : `Run only the actions changed ${comparison}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <GitCompare className="w-4 h-4 mr-1.5" /> Run Changed
        {status === "ready" && (
          <span className="ml-1.5 text-[11px] leading-none px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--vscode-button-foreground) 25%, transparent)" }}>
            {changed.length}
          </span>
        )}
        {status === "computing" && <Loader2 className="w-3.5 h-3.5 ml-1.5 animate-spin" />}
        <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-80" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          style={{
            ...(popoverLeft === undefined ? { right: 0 } : { left: popoverLeft }),
            // widget-border is transparent or near the background in many themes, so derive a faint edge from the text colour
            borderColor: "color-mix(in srgb, var(--vscode-foreground) 22%, transparent)",
          }}
          className="absolute top-full mt-1 z-20 w-[min(640px,calc(100vw-2rem))] p-3 rounded-lg border bg-[var(--vscode-editor-background)] shadow-lg"
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <p className="text-xs text-[var(--vscode-descriptionForeground)]">
              {onDefaultBranch && (
                <span className="block mb-0.5 text-[var(--vscode-foreground)]">
                  You're on <span className="font-mono">{defaultBranch}</span>, the branch Run Changed compares against.
                </span>
              )}
              {status === "ready" ? (
                <>
                  Changes {headRef && <>in <span className="font-mono">{headRef}</span> </>}vs <span className="font-mono">{baseRef}</span>
                  {changedActions.mergeBaseSha && (
                    <> @ <span className="font-mono">{changedActions.mergeBaseSha.slice(0, 7)}</span> (merge-base)</>
                  )}
                  {changedActions.headLabel && <> · {changedActions.headLabel}</>}
                </>
              ) : (
                <>Changes {headRef && <>in <span className="font-mono">{headRef}</span> </>}vs <span className="font-mono">{baseRef}</span></>
              )}
            </p>
            <button
              onClick={compute}
              disabled={status === "computing"}
              className="p-1 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] disabled:opacity-50"
              title="Recompute"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mb-3 pb-3 border-b border-[var(--vscode-widget-border)]">
            {flags.length > 0 && (
              <p className="mb-2 text-[11px] text-[var(--vscode-descriptionForeground)]">With {flags.join(", ")}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 text-xs bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] rounded"
              >
                Cancel
              </button>
              {!isRemoteMode && (
                <button
                  onClick={() => run(false)}
                  disabled={status !== "ready" || changed.length === 0}
                  className="flex-1 justify-center px-3 py-1.5 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded flex items-center disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 mr-1.5" /> Run (CLI)
                </button>
              )}
              <button
                onClick={() => run(true)}
                disabled={status !== "ready" || changed.length === 0}
                className="flex-1 justify-center px-3 py-1.5 text-xs bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded flex items-center disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" /> Run (API)
              </button>
            </div>
          </div>
          {status === "ready" && changed.length > 0 && (
            <div className="mb-2 flex items-start justify-between gap-2 text-xs">
              <p className="text-[var(--vscode-foreground)]">{summary}</p>
              {changedGroups.length > 1 && (
                <button
                  onClick={() => setAllExpanded(!allExpanded)}
                  className="shrink-0 px-1.5 py-0.5 rounded text-[var(--vscode-textLink-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                >
                  {allExpanded ? "Collapse all" : "Expand all"}
                </button>
              )}
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto text-xs pr-1">
            {status === "computing" && (
              <div className="flex items-center gap-2 py-3 text-[var(--vscode-descriptionForeground)]">
                <Loader2 className="w-4 h-4 animate-spin" /> Compiling the default branch at the merge-base…
              </div>
            )}
            {status === "error" && (
              <div className="flex items-start gap-2 py-2 text-[var(--vscode-errorForeground)] whitespace-pre-wrap break-words">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {changedActions.error}
              </div>
            )}
            {noChanges && (
              <p className="py-2 text-[var(--vscode-descriptionForeground)]">
                {onDefaultBranch
                  ? "Nothing to compare. Switch to a feature branch, or edit files."
                  : "No changed actions."}
              </p>
            )}
            {status === "ready" && changedGroups.map(([fileName, actions]) => (
              <ChangedFileGroup
                key={fileName}
                fileName={fileName}
                actions={actions}
                expanded={isExpanded(fileName)}
                onToggle={() => toggleFile(fileName)}
              />
            ))}
            {status === "ready" && deleted.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--vscode-widget-border)] opacity-60">
                <p className="mb-1">Removed on this branch (not run):</p>
                {deletedGroups.map(([fileName, actions]) => (
                  <div key={fileName} className="mb-1">
                    <FileHeading fileName={fileName} />
                    {actions.map((action) => (
                      <div key={action.target} className="pl-3 line-through">
                        <ActionName target={action.target} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
};
