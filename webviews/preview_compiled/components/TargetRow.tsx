import React, { ReactNode, useState } from "react";
import clsx from "clsx";
import { AlertCircle, Check, Clock, Copy, Loader2 } from "lucide-react";
import { ROW_LABEL, RowChip } from "./SummaryRow";
import { ACTION_TYPE_BADGE_STYLES, DEFAULT_BADGE_STYLE } from "../utils/constants";
import { UNKNOWN_ACCURACY_CHIP_STYLE, UNKNOWN_ACCURACY_STAT, UNKNOWN_ACCURACY_TOOLTIP } from "../../utils/dryRunAccuracy";

/**
 * A stat line ending in UNKNOWN_ACCURACY_STAT means BigQuery could not estimate the bytes.
 * Render it as a warning chip rather than plain text, so it is impossible to mistake for a
 * normal estimate at a glance; the tooltip explains what BigQuery actually reported.
 */
export const renderDryRunStatLine = (line: string) => {
  if (!line.endsWith(UNKNOWN_ACCURACY_STAT)) {
    return line;
  }
  const label = line.slice(0, -UNKNOWN_ACCURACY_STAT.length);
  return (
    <span title={UNKNOWN_ACCURACY_TOOLTIP}>
      {label}
      <span className="px-1.5 py-0.5 rounded font-semibold" style={UNKNOWN_ACCURACY_CHIP_STYLE}>
        {UNKNOWN_ACCURACY_STAT}
      </span>
    </span>
  );
};

/** What kind of action it is, in the colours of its kind */
export function KindBadge({ kind }: { kind: string }) {
  const style = ACTION_TYPE_BADGE_STYLES[kind] || DEFAULT_BADGE_STYLE;
  return <span className={`inline-block align-middle mr-1.5 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}>{kind}</span>;
}

/** Copies a table's ID. It is seen when the action it is of is pointed at */
export function CopyTableIdButton({ onCopy }: { onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        onCopy();
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="p-1 border-0 bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
      title="Copy table ID with backticks"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** What the dry run of an action said: at work, or what it would scan and cost. Lines of `stat` are parted by `<br>` */
export function DryRunResult({ running, stat }: { running: boolean; stat?: string }) {
  if (running) {
    return <span data-dry-run="running" className="ml-auto"><RowChip tone="busy"><Loader2 className="w-2.5 h-2.5 animate-spin" /> dry run…</RowChip></span>;
  }
  if (!stat) {
    return null;
  }
  return (
    <span data-dry-run="ok" className="ml-auto text-xs font-mono font-medium text-[var(--vscode-button-foreground)] bg-[var(--vscode-button-background)] px-2 py-0.5 rounded">
      {stat.split("<br>").map((line, i) => (
        <React.Fragment key={i}>{i > 0 && <br />}{renderDryRunStatLine(line)}</React.Fragment>
      ))}
    </span>
  );
}

/** When the table an action builds was last changed. `none` is said where there is no such time */
export type LastUpdated = { time: string; today: boolean } | { unknown: string } | { none: string };

interface TargetActionProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Not the first of the row: a line sets it apart, so it is plain which action an error is of */
  separated: boolean;
  /** The action's first line: its kind and what it builds */
  head: ReactNode;
  lastUpdated?: LastUpdated;
  /** What the dry run said. It is at the end of the action's last line: beside when its table was updated, where that is known */
  dryRun?: ReactNode;
  error?: string;
  errorTitle?: string;
  /** Lines between the table's time and the error */
  children?: ReactNode;
}

/** One action of the Target row */
export function TargetAction({ separated, head, lastUpdated, dryRun, error, errorTitle, children, className, ...rest }: TargetActionProps) {
  return (
    <div {...rest} className={clsx("space-y-1.5 group", separated && "!mt-2.5 pt-2.5 border-t border-[var(--vscode-widget-border)]", className)}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 min-w-0">
        {head}
        {!lastUpdated && dryRun}
      </div>
      {lastUpdated && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--vscode-descriptionForeground)]">
          <Clock className="w-3 h-3" />
          {"none" in lastUpdated ? (
            <span>{lastUpdated.none}</span>
          ) : (
            <>
              <span>Last updated:</span>
              {"unknown" in lastUpdated ? (
                <span className="font-mono text-[var(--vscode-descriptionForeground)] opacity-70 cursor-help border-b border-dotted border-[var(--vscode-widget-border)]" title={lastUpdated.unknown}>
                  N/A
                </span>
              ) : (
                <span className={clsx("font-mono", lastUpdated.today ? "text-[var(--vscode-foreground)]" : "text-[var(--vscode-errorForeground)]")}>
                  {lastUpdated.time}
                </span>
              )}
            </>
          )}
          {dryRun}
        </div>
      )}
      {children}
      {error && (
        <div data-dry-run="error" title={errorTitle} className="bg-[var(--vscode-inputValidation-errorBackground)] border border-[var(--vscode-inputValidation-errorBorder)] px-3 py-2 rounded text-xs text-[var(--vscode-inputValidation-errorForeground)] flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <div className="overflow-auto whitespace-pre-wrap">{error}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The Target row. It is always open: what the file builds and what its dry run said is what the panel is opened for.
 * With no children it is dimmed, and says so with a dash.
 */
export function TargetRow({ children }: { children?: ReactNode }) {
  const empty = React.Children.toArray(children).length === 0;
  return (
    <div className={clsx("flex gap-2 px-3 py-1.5 border-b border-[var(--vscode-widget-border)] text-[12.5px]", empty && "opacity-50")}>
      <span className={clsx(ROW_LABEL, "leading-[22px]")}>Target</span>
      <div className="flex-1 min-w-0 space-y-2">
        {empty ? <span className="leading-[22px]">—</span> : children}
      </div>
    </div>
  );
}
