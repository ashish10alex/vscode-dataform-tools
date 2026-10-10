import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Play, Tag } from "lucide-react";
import clsx from "clsx";

export type RunBackend = "api" | "cli";

interface RunSplitButtonProps {
  backend: RunBackend;
  /** Remote mode runs through the Dataform API only, so the CLI option is hidden. */
  isRemoteMode: boolean;
  hasTags: boolean;
  /** The file has no action to run, so the Run half opens the tag picker and the menu only switches backend. */
  tagsOnly?: boolean;
  running: boolean;
  disabled: boolean;
  onRun: (backend: RunBackend) => void;
  onBackendChange: (backend: RunBackend) => void;
  onRunTag: () => void;
  /** As small as a button of a summary row, with its menu opening from its right edge: it is at the row's right end */
  compact?: boolean;
  /** Ringed in the warning colour: what it runs has side effects worth a second look, e.g. a full refresh */
  warning?: boolean;
}

const BACKEND_SHORT_LABEL: Record<RunBackend, string> = { api: "API", cli: "CLI" };
// A shade darker than the Run half, so the selector reads as its own control.
const SELECTOR_BACKGROUND = "color-mix(in srgb, var(--vscode-button-background) 78%, black)";
// The colour of the Full Refresh switch while it is on
const WARNING_COLOR = "var(--vscode-charts-orange, #d18616)";

interface MenuItem {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/**
 * The one primary action in the toolbar: the left half runs, the right half shows the backend it runs
 * with and opens a menu to switch backend or pick tags to run. Tags run with the backend that is set, as the
 * file's actions do. On a file with no action to run, the left half picks tags instead.
 */
export const RunSplitButton: React.FC<RunSplitButtonProps> = ({
  backend,
  isRemoteMode,
  hasTags,
  tagsOnly = false,
  running,
  disabled,
  onRun,
  onBackendChange,
  onRunTag,
  compact = false,
  warning = false,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectorRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) { selectorRef.current?.focus(); }
  };

  useEffect(() => {
    if (!menuOpen) { return; }
    itemRefs.current[0]?.focus();
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) { setMenuOpen(false); }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

  const backendItem = (value: RunBackend, label: string, hint: string): MenuItem => ({
    key: value,
    label,
    hint,
    icon: value === backend ? <Check className="w-3.5 h-3.5" /> : <span className="w-3.5 h-3.5 inline-block" />,
    onSelect: () => onBackendChange(value),
  });

  const items: MenuItem[] = [
    ...(!isRemoteMode ? [backendItem("cli", "Run via CLI", "Locally with the Dataform CLI")] : []),
    backendItem("api", "Run via API", "On GCP Dataform"),
    ...(hasTags && !tagsOnly
      ? [{ key: "tag", label: "Run Tag…", hint: `Pick tag(s) to run via the ${BACKEND_SHORT_LABEL[backend]}`, icon: <Tag className="w-3.5 h-3.5" />, onSelect: onRunTag }]
      : []),
  ];

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const current = itemRefs.current.findIndex(el => el === document.activeElement);
    const focusAt = (i: number) => itemRefs.current[(i + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(current + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(current - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(items.length - 1); }
    else if (e.key === "Escape" || e.key === "Tab") { closeMenu(e.key === "Escape"); }
  };

  const isDisabled = disabled || running;
  const iconSize = compact ? "w-3 h-3 mr-1" : "w-4 h-4 mr-1.5";
  const segment = (compact ? "h-6 " : "py-1.5 ") + "text-[var(--vscode-button-foreground)] flex items-center disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]";

  return (
    // The warning is a ring in the colour of the switch that asked for it: the button keeps its own colours, which
    // are readable in every theme and while it is disabled
    <div ref={wrapperRef} className="relative inline-flex rounded" style={warning ? { boxShadow: `0 0 0 1px var(--vscode-editor-background), 0 0 0 3px ${WARNING_COLOR}` } : undefined}>
      <button
        onClick={() => (tagsOnly ? onRunTag() : onRun(backend))}
        disabled={isDisabled}
        className={clsx(segment, compact ? "px-2 text-xs" : "pl-3 pr-3 text-sm", "rounded-l bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)]")}
        title={tagsOnly
          ? `Pick tag(s) to run via the Dataform ${BACKEND_SHORT_LABEL[backend]}`
          : `Run this file's actions via the Dataform ${BACKEND_SHORT_LABEL[backend]}`}
        aria-haspopup={tagsOnly ? "dialog" : undefined}
      >
        {running
          ? <Loader2 className={clsx(iconSize, "animate-spin")} />
          : tagsOnly ? <Tag className={iconSize} /> : <Play className={iconSize} />}
        {tagsOnly ? "Run Tag…" : "Run"}
      </button>
      <button
        ref={selectorRef}
        onClick={() => setMenuOpen(o => !o)}
        onKeyDown={e => { if (e.key === "ArrowDown" && !menuOpen) { e.preventDefault(); setMenuOpen(true); } }}
        disabled={isDisabled}
        className={clsx(segment, compact ? "gap-0.5 pl-1.5 pr-1 text-[11px]" : "gap-1 pl-2.5 pr-2 text-xs", "rounded-r font-medium border-l hover:!bg-[var(--vscode-button-hoverBackground)]")}
        style={{
          background: SELECTOR_BACKGROUND,
          borderLeftColor: "color-mix(in srgb, var(--vscode-button-foreground) 30%, transparent)",
        }}
        aria-label={`Runs via ${BACKEND_SHORT_LABEL[backend]}. Change how to run`}
        title="Change how to run"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        {BACKEND_SHORT_LABEL[backend]}
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          aria-label="Run options"
          onKeyDown={onMenuKeyDown}
          className={clsx("absolute top-full mt-1 z-20 min-w-[230px] py-1 rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-lg", compact ? "right-0" : "left-0")}
        >
          {items.map((item, i) => (
            <React.Fragment key={item.key}>
            {item.key === "tag" && <div role="separator" className="my-1 border-t border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border))]" />}
            <button
              ref={el => { itemRefs.current[i] = el; }}
              role={item.key === "tag" ? "menuitem" : "menuitemradio"}
              aria-checked={item.key === "tag" ? undefined : item.key === backend}
              onClick={() => { closeMenu(true); item.onSelect(); }}
              className="w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,inherit)] focus:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] focus:text-[var(--vscode-menu-selectionForeground,inherit)]"
            >
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <span className="flex flex-col">
                <span>{item.label}</span>
                <span className="opacity-70">{item.hint}</span>
              </span>
            </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
