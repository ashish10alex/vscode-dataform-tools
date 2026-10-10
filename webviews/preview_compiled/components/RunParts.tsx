import React, { ReactNode, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Play } from "lucide-react";
import { ModifierSwitch } from "./ModifierSwitch";
import { ROW_LABEL, ROW_PRIMARY_BUTTON } from "./SummaryRow";

// A part of the group of run buttons. Its corners are the group's, which rounds its ends
const RUN_PART_BASE = "flex items-center gap-1 h-6 px-2 rounded-[inherit] border-0 text-xs whitespace-nowrap disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]";
/** A run that is not the file's own: in the button colour, thinned, so it is an action and second to the main one */
export const RUN_PART = `${RUN_PART_BASE} text-[var(--vscode-foreground)] bg-[color-mix(in_srgb,var(--run-tint,var(--vscode-button-background))_28%,transparent)] hover:bg-[color-mix(in_srgb,var(--run-tint,var(--vscode-button-background))_45%,transparent)]`;
export const RUN_MAIN_PART = `${RUN_PART_BASE} text-[var(--vscode-button-foreground)] bg-[var(--run-solid,var(--vscode-button-background))] hover:bg-[var(--run-solid-hover,var(--vscode-button-hoverBackground))]`;
/** Everything that starts a run is one group, whose ends are rounded */
export const RUN_GROUP = "inline-flex items-stretch gap-px [&>*:first-child]:rounded-l [&>*:last-child]:rounded-r";
// The colour of the Full refresh chip while it is on
const FULL_REFRESH_COLOR = "var(--vscode-charts-orange, #d18616)";
/** Full refresh rings the Run button in the colour of its chip: the button keeps its own colours, which are readable in every theme */
export const FULL_REFRESH_RING: React.CSSProperties = { boxShadow: `0 0 0 1px var(--vscode-editor-background), 0 0 0 3px ${FULL_REFRESH_COLOR}` };

/**
 * The Run row. It has nothing to open: its modifiers say what Run will do, and its buttons are at the row's end.
 * With nothing to run it is dimmed, and `off` says why.
 */
export function RunRow({ off, children }: { off?: string; children?: ReactNode }) {
  return (
    <div className={clsx("border-b border-[var(--vscode-widget-border)] text-[12.5px]", off && "opacity-50")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-h-[30px] px-3 py-[3px]">
        <span className={ROW_LABEL}>Run</span>
        {off ? <span className="text-[var(--vscode-foreground)]">{off}</span> : children}
      </div>
    </div>
  );
}

interface RunModifiersProps {
  includeDependencies: boolean;
  includeDependents: boolean;
  fullRefresh: boolean;
  onIncludeDependencies: (on: boolean) => void;
  onIncludeDependents: (on: boolean) => void;
  onFullRefresh: (on: boolean) => void;
  /** What each does, in the words of the tool that runs */
  titles: { dependencies: string; dependents: string; fullRefresh: string };
}

/** The chips that say how far a run reaches, at the start of the Run row */
export function RunModifiers({ includeDependencies, includeDependents, fullRefresh, onIncludeDependencies, onIncludeDependents, onFullRefresh, titles }: RunModifiersProps) {
  return (
    <div role="group" aria-label="Run modifiers" className="flex items-center gap-1 flex-shrink-0">
      <ModifierSwitch chip label="+Deps" checked={includeDependencies} onChange={onIncludeDependencies} title={titles.dependencies} />
      <ModifierSwitch chip label="+Dependents" checked={includeDependents} onChange={onIncludeDependents} title={titles.dependents} />
      <ModifierSwitch chip label="Full refresh" checked={fullRefresh} onChange={onFullRefresh} title={titles.fullRefresh} warning />
    </div>
  );
}

interface TagRunPartProps {
  /** The tags of the Project */
  tags: string[];
  selected: string[];
  onSelect: (update: (chosen: string[]) => string[]) => void;
  onRun: () => void;
  disabled?: boolean;
  /** How the button looks, given by the group it is a part of */
  className: string;
  title: string;
  /** What the run goes through, said beside the picker's heading, e.g. "via the CLI" */
  via?: string;
}

/**
 * The part of the run group that runs by tag: it opens a picker of the Project's tags. The picker opens from the end
 * of the row, not from under the button: it is as wide as a narrow panel. So the row's end is the positioned parent.
 */
export function TagRunPart({ tags, selected, onSelect, onRun, disabled, className, title, via }: TagRunPartProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { return; }
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  const shown = tags.filter((tag) => tag.toLowerCase().includes(filter.trim().toLowerCase()));
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const runLabel = selected.length === 0 ? "Run" : `Run ${selected.length} tag${selected.length === 1 ? "" : "s"}`;
  const run = () => {
    onRun();
    setOpen(false);
  };

  const onPickerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") { return; }
    // Cmd/Ctrl+Enter runs what is chosen. Plain Enter in the filter chooses the one tag it has left
    if (e.metaKey || e.ctrlKey) {
      if (selected.length > 0) {
        e.preventDefault();
        run();
      }
    } else if (e.target instanceof HTMLInputElement && shown.length === 1) {
      e.preventDefault();
      const [only] = shown;
      onSelect((chosen) => chosen.includes(only) ? chosen : [...chosen, only]);
      setFilter("");
    }
  };

  return (
    <div ref={wrapper} className="flex">
      <button
        onClick={() => { setFilter(""); setOpen((was) => !was); }}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className={className}
      >
        <Play className="w-3 h-3" /> Tag…
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Run by tag"
          onKeyDown={onPickerKeyDown}
          className="absolute top-full right-0 mt-1 z-20 w-[min(340px,calc(100vw-1.5rem))] rounded-md border border-[var(--vscode-menu-border,var(--vscode-widget-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] shadow-lg text-xs"
        >
          <div className="flex items-center gap-2 px-2.5 pt-2">
            <span className="font-medium text-[var(--vscode-foreground)]">Run by tag</span>
            {via && <span className="text-[var(--vscode-descriptionForeground)]">{via}</span>}
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              aria-label="Filter the tags"
              className="ml-auto w-[112px] h-6 px-2 rounded bg-[var(--vscode-input-background)] border border-[var(--vscode-input-border,var(--vscode-widget-border))] text-xs text-[var(--vscode-input-foreground)] placeholder:text-[var(--vscode-input-placeholderForeground)] focus:outline-none focus:border-[var(--vscode-focusBorder)]"
            />
          </div>
          <div role="group" aria-label="Tags" className="flex flex-wrap gap-1 max-h-[168px] overflow-y-auto px-2.5 py-2">
            {shown.map((tag) => (
              <ModifierSwitch
                key={tag}
                chip
                label={tag}
                checked={selected.includes(tag)}
                onChange={(checked) => onSelect((chosen) => checked ? [...chosen, tag] : chosen.filter((other) => other !== tag))}
                title={selected.includes(tag) ? `Leave the tag ${tag} out of the run` : `Run the tag ${tag}`}
              />
            ))}
            {shown.length === 0 && <span className="py-1 italic text-[var(--vscode-descriptionForeground)]">No tag has "{filter}" in its name</span>}
          </div>
          <div className="flex items-center gap-2 px-2.5 py-2 border-t border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border))]">
            {/* The chosen tags by name: the filter can have them out of the list above */}
            <span className="min-w-0 truncate text-[var(--vscode-descriptionForeground)]" title={selected.join(", ")}>
              {selected.length === 0 ? "None chosen" : <span className="font-mono text-[var(--vscode-foreground)]">{selected.join(", ")}</span>}
            </span>
            {selected.length > 0 && (
              <button onClick={() => onSelect(() => [])} className="flex-shrink-0 bg-transparent border-0 p-0 text-[var(--vscode-textLink-foreground)] hover:underline">Clear</button>
            )}
            <button onClick={run} disabled={selected.length === 0} className={clsx(ROW_PRIMARY_BUTTON, "ml-auto flex-shrink-0")}>
              <Play className="w-3 h-3" /> {runLabel}
              <span className="ml-1 text-[10px] font-mono opacity-70">{isMac ? "⌘↵" : "Ctrl+↵"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
