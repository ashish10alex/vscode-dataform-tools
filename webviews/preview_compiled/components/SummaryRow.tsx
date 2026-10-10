import { ReactNode, useEffect, useRef, useState } from "react";
import clsx from "clsx";

/**
 * calm: nothing to say but the value. busy: at work. warning: a value worth knowing, that is no failure.
 * error: a problem, which opens the row by itself. off: the row has nothing to say for this file.
 */
export type RowTone = "calm" | "busy" | "warning" | "error" | "off";

const TONE_COLOR: Record<RowTone, string | undefined> = {
  calm: undefined,
  off: undefined,
  busy: "var(--vscode-textLink-foreground, #3794ff)",
  warning: "var(--vscode-editorWarning-foreground, #cca700)",
  error: "var(--vscode-errorForeground, #f14c4c)",
};

export const ROW_BUTTON = "flex items-center gap-1 h-6 px-2 rounded text-xs whitespace-nowrap bg-[var(--vscode-button-secondaryBackground)] hover:bg-[var(--vscode-button-secondaryHoverBackground)] text-[var(--vscode-button-secondaryForeground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]";
export const ROW_PRIMARY_BUTTON = "flex items-center gap-1 h-6 px-2 rounded text-xs whitespace-nowrap bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]";

/** The name of a row, in the column the names of all the rows are in */
export const ROW_LABEL = "w-[62px] flex-shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--vscode-descriptionForeground)]";

/** A value of a row's summary that is set apart from the words around it */
export function RowChip({ tone = "calm", title, children }: { tone?: RowTone; title?: string; children: ReactNode }) {
  const color = TONE_COLOR[tone];
  return (
    <span
      title={title}
      className={clsx("inline-flex items-center gap-1 align-middle mr-1.5 px-1.5 h-[18px] rounded border font-mono text-[10.5px] whitespace-nowrap", !color && "border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)]")}
      style={color ? { color, borderColor: `color-mix(in srgb, ${color} 50%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)` } : undefined}
    >
      {children}
    </span>
  );
}

interface SummaryRowProps {
  label: string;
  tone?: RowTone;
  /** One line: what the row holds now. It is cut short where the panel is narrow */
  summary: ReactNode;
  /** The row's main buttons, which work without opening it */
  actions?: ReactNode;
  /** Opens the row when it changes, e.g. when something elsewhere in the panel asks for its details */
  openRequest?: number;
  /** The body is as wide as the panel, for content that needs the room */
  wide?: boolean;
  /** What the open row shows. It stays mounted while the row is closed, so what it holds is kept */
  children?: ReactNode;
}

/**
 * A section of the compiled query, as one line that says what it holds and opens to all of it. A row with a problem
 * opens by itself and closes when the problem is gone; a row the user opened or closed stays as they left it.
 */
export function SummaryRow({ label, tone = "calm", summary, actions, openRequest, wide, children }: SummaryRowProps) {
  const problem = tone === "error";
  // null: follows the problem. Otherwise what the user chose
  const [chosen, setChosen] = useState<boolean | null>(null);
  const hadProblem = useRef(problem);
  useEffect(() => {
    // A problem that is new is shown, though the row was closed on the one before
    if (problem && !hadProblem.current) {
      setChosen((was) => (was === false ? null : was));
    }
    hadProblem.current = problem;
  }, [problem]);
  const firstRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest !== firstRequest.current) {
      setChosen(true);
    }
  }, [openRequest]);

  const off = tone === "off";
  const canOpen = !!children && !off;
  const open = canOpen && (chosen ?? problem);
  // A warning or a problem colours the closed row, so it is seen without opening it. Open, its chip and what the
  // section shows say it, and the whole section in that colour is hard to read
  const color = (tone === "warning" || tone === "error") && open ? undefined : TONE_COLOR[tone];

  return (
    <div
      className={clsx("relative border-b border-[var(--vscode-widget-border)] text-[12.5px]", off && "opacity-50")}
      style={color && tone !== "busy" ? { background: `color-mix(in srgb, ${color} 7%, transparent)` } : undefined}
    >
      {color && <span aria-hidden="true" className="absolute left-0 inset-y-0 w-0.5" style={{ background: color }} />}
      <div className="flex items-center gap-2 px-3">
        <button
          type="button"
          onClick={() => setChosen(!open)}
          disabled={!canOpen}
          aria-expanded={canOpen ? open : undefined}
          title={canOpen ? (open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`) : undefined}
          className="flex items-center gap-2 flex-1 min-w-0 h-[30px] text-left bg-transparent border-0 enabled:cursor-pointer enabled:hover:opacity-80 focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]"
        >
          <span className={ROW_LABEL} style={color ? { color } : undefined}>{label}</span>
          <span className="flex-1 min-w-0 truncate text-[var(--vscode-foreground)]">{summary}</span>
        </button>
        {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
      </div>
      {children && (
        <div hidden={!open} className={clsx("pr-3 pb-3 pt-0.5 space-y-2", wide ? "pl-3" : "pl-3 min-[520px]:pl-[82px]")}>
          {children}
        </div>
      )}
    </div>
  );
}
