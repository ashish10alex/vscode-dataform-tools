import { ReactNode, useEffect, useRef, useState } from 'react';
import { Clock, Ellipsis, MessageSquareWarning } from 'lucide-react';
import clsx from 'clsx';

const ISSUES_URL = "https://github.com/ashish10alex/vscode-dataform-tools/issues";

const iconButtonClass = "flex items-center justify-center gap-1 h-6 min-w-6 px-1 rounded text-[var(--vscode-foreground)] opacity-80 hover:opacity-100 hover:bg-[var(--vscode-toolbar-hoverBackground)] transition-colors bg-transparent border-0";
const menuItemClass = "flex items-center gap-2 w-full px-2.5 py-1 rounded-sm text-[13px] text-left whitespace-nowrap text-[var(--vscode-menu-foreground,var(--vscode-foreground))] hover:bg-[var(--vscode-menu-selectionBackground,var(--vscode-toolbar-hoverBackground))] hover:text-[var(--vscode-menu-selectionForeground,var(--vscode-foreground))] bg-transparent border-0 no-underline";

/** The row at the top of the panel: the tabs as one control on the left, actions on the right */
export function PanelHeader({ tabs, actions, className }: { tabs: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-center w-full px-2 py-1.5 border-b border-[var(--vscode-widget-border)] z-10", className)}>
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-thin">
        <div role="tablist" className="inline-flex items-center p-0.5 rounded-md border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)]">{tabs}</div>
      </div>
      <div className="flex items-center gap-0.5 pl-2 flex-shrink-0">{actions}</div>
    </div>
  );
}

/** A tab of the panel: a segment of the control, filled when it is the active one */
export function HeaderTab({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-selected={active}
      role="tab"
      className={clsx(
        "flex items-center flex-shrink-0 px-2.5 py-0.5 rounded text-[12.5px] whitespace-nowrap border-0 transition-colors",
        active
          ? "bg-[var(--vscode-list-inactiveSelectionBackground,var(--vscode-toolbar-hoverBackground))] text-[var(--vscode-foreground)]"
          : "bg-transparent text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
      )}
    >
      {children}
    </button>
  );
}

export interface HeaderShortcut {
  label: string;
  /** The key that opens the tab */
  hint: string;
  onSelect: () => void;
}

/** Everything of the header that is not a tab, behind one button. While a snooze runs the button shows the time left */
export function HeaderMenu({ snoozeTimeLeft, onStartSnooze, onStopSnooze, shortcuts = [] }: {
  snoozeTimeLeft?: string;
  onStartSnooze: () => void;
  onStopSnooze: () => void;
  shortcuts?: HeaderShortcut[];
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onMouseDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={menu} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={snoozeTimeLeft ? `Compilation snoozed, ${snoozeTimeLeft} remaining` : "More actions"}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(iconButtonClass, snoozeTimeLeft && "px-1.5 text-[11px] tabular-nums opacity-100 bg-[var(--vscode-inputValidation-warningBackground,rgba(255,200,0,0.1))] border border-[var(--vscode-inputValidation-warningBorder,var(--vscode-widget-border))]")}
      >
        {snoozeTimeLeft && (
          <>
            <Clock className="w-3.5 h-3.5 text-[var(--vscode-notificationsWarningIcon-foreground)]" />
            {snoozeTimeLeft}
          </>
        )}
        <Ellipsis className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 min-w-[220px] p-1 rounded-md border border-[var(--vscode-menu-border,var(--vscode-widget-border))] bg-[var(--vscode-menu-background,var(--vscode-editor-background))] shadow-lg z-20"
        >
          <button role="menuitem" className={menuItemClass} onClick={select(snoozeTimeLeft ? onStopSnooze : onStartSnooze)}>
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            {snoozeTimeLeft ? `Stop snooze (${snoozeTimeLeft} left)` : "Snooze compilation (5 minutes)"}
          </button>
          <a role="menuitem" className={menuItemClass} href={ISSUES_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <MessageSquareWarning className="w-3.5 h-3.5 flex-shrink-0" />
            Report an issue
          </a>
          {shortcuts.length > 0 && <div className="my-1 border-t border-[var(--vscode-menu-separatorBackground,var(--vscode-widget-border))]" />}
          {shortcuts.map((shortcut) => (
            <button key={shortcut.hint} role="menuitem" className={menuItemClass} onClick={select(shortcut.onSelect)}>
              {shortcut.label}
              <kbd className="ml-auto pl-4 font-mono text-[11px] text-[var(--vscode-descriptionForeground)]">{shortcut.hint}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReportIssueLink() {
  return (
    <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" title="Report an issue" aria-label="Report an issue" className={iconButtonClass}>
      <MessageSquareWarning className="w-4 h-4" />
    </a>
  );
}
