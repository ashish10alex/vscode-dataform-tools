import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Play, Tag } from "lucide-react";
import clsx from "clsx";

export type RunBackend = "api" | "cli";

interface RunSplitButtonProps {
  backend: RunBackend;
  /** Remote mode runs through the Dataform API only, so the CLI option is hidden. */
  isRemoteMode: boolean;
  hasTags: boolean;
  running: boolean;
  disabled: boolean;
  onRun: (backend: RunBackend) => void;
  onBackendChange: (backend: RunBackend) => void;
  onRunTag: () => void;
}

const BACKEND_LABEL: Record<RunBackend, string> = { api: "Run (API)", cli: "Run (CLI)" };

interface MenuItem {
  key: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

/**
 * The one primary action in the toolbar: the left half runs with the chosen backend, the chevron
 * switches backend (and runs) or opens the tag picker.
 */
export const RunSplitButton: React.FC<RunSplitButtonProps> = ({
  backend,
  isRemoteMode,
  hasTags,
  running,
  disabled,
  onRun,
  onBackendChange,
  onRunTag,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) { chevronRef.current?.focus(); }
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

  const selectBackend = (next: RunBackend) => {
    onBackendChange(next);
    onRun(next);
  };

  const items: MenuItem[] = [
    { key: "api", label: "Run (API)", hint: "Via the GCP Dataform API", icon: <Play className="w-3.5 h-3.5" />, onSelect: () => selectBackend("api") },
    ...(!isRemoteMode
      ? [{ key: "cli", label: "Run (CLI)", hint: "Locally via the Dataform CLI", icon: <Play className="w-3.5 h-3.5" />, onSelect: () => selectBackend("cli") }]
      : []),
    ...(hasTags
      ? [{ key: "tag", label: "Run Tag…", hint: "Pick tag(s) to run via the API", icon: <Tag className="w-3.5 h-3.5" />, onSelect: onRunTag }]
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
  const segment = "py-1.5 bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] text-sm flex items-center disabled:opacity-50 disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--vscode-focusBorder)]";

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        onClick={() => onRun(backend)}
        disabled={isDisabled}
        className={clsx(segment, "pl-3 pr-3 rounded-l")}
        title={backend === "api" ? "Run this file's actions via the Dataform API" : "Run this file's actions via the Dataform CLI"}
      >
        {running
          ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          : <Play className="w-4 h-4 mr-1.5" />}
        {BACKEND_LABEL[backend]}
      </button>
      <button
        ref={chevronRef}
        onClick={() => setMenuOpen(o => !o)}
        onKeyDown={e => { if (e.key === "ArrowDown" && !menuOpen) { e.preventDefault(); setMenuOpen(true); } }}
        disabled={isDisabled}
        className={clsx(segment, "px-1.5 rounded-r border-l")}
        style={{ borderLeftColor: "color-mix(in srgb, var(--vscode-button-foreground) 30%, transparent)" }}
        aria-label="More run options"
        title="More run options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          aria-label="Run options"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full left-0 mt-1 z-20 min-w-[220px] py-1 rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] text-[var(--vscode-menu-foreground,var(--vscode-foreground))] shadow-lg"
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={el => { itemRefs.current[i] = el; }}
              role="menuitem"
              onClick={() => { closeMenu(false); item.onSelect(); }}
              className="w-full flex items-start gap-2 px-3 py-1.5 text-left text-xs outline-none hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,inherit)] focus:bg-[var(--vscode-menu-selectionBackground,var(--vscode-list-hoverBackground))] focus:text-[var(--vscode-menu-selectionForeground,inherit)]"
            >
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <span className="flex flex-col">
                <span className={clsx(item.key === backend && "font-semibold")}>{item.label}</span>
                <span className="opacity-70">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
