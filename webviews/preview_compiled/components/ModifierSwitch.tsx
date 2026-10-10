import React from "react";
import { AlertTriangle } from "lucide-react";
import clsx from "clsx";

const ON_COLOR = "var(--vscode-charts-yellow, #cca700)";
// Full refresh rebuilds tables from scratch, so it is flagged in the warning colour rather than the usual on colour.
const WARNING_COLOR = "var(--vscode-charts-orange, #d18616)";
const OFF_TRACK = "color-mix(in srgb, var(--vscode-foreground) 25%, transparent)";
const OFF_KNOB = "color-mix(in srgb, var(--vscode-foreground) 75%, transparent)";

interface ModifierSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  /** Marks a modifier with side effects worth a second look when it is on. */
  warning?: boolean;
  /** Drawn as a chip with a dot, for a row with no room for the switch */
  chip?: boolean;
}

/** An on/off switch that changes how the run controls beside it execute (e.g. include dependencies). */
export const ModifierSwitch: React.FC<ModifierSwitchProps> = ({ label, checked, onChange, title, warning, chip }) => {
  const onColor = warning ? WARNING_COLOR : ON_COLOR;
  if (chip) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        title={title}
        className={clsx(
          "inline-flex items-center gap-1 h-6 px-1.5 rounded border text-xs whitespace-nowrap flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
          checked ? "text-[var(--vscode-foreground)] font-medium" : "border-[var(--vscode-widget-border)] text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
        )}
        style={checked ? { borderColor: `color-mix(in srgb, ${onColor} 60%, transparent)`, background: `color-mix(in srgb, ${onColor} 16%, transparent)` } : undefined}
      >
        <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: checked ? onColor : OFF_TRACK }} />
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={title}
      className={clsx(
        "inline-flex items-center gap-1.5 px-1.5 py-1 rounded text-xs text-[var(--vscode-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
        checked ? "font-semibold" : "opacity-80 hover:opacity-100"
      )}
    >
      <span
        aria-hidden="true"
        className="relative inline-block w-[30px] h-4 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? onColor : OFF_TRACK }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full transition-[left]"
          style={{ left: checked ? 16 : 2, background: checked ? "var(--vscode-editor-background)" : OFF_KNOB }}
        />
      </span>
      {warning && checked && <AlertTriangle className="w-3.5 h-3.5" style={{ color: WARNING_COLOR }} />}
      {label}
    </button>
  );
};
