import { Cloud, Terminal } from "lucide-react";
import clsx from "clsx";

export type RunBackend = "api" | "cli";

/** The colour of the Dataform API in the Run row: on the switch, and on the run buttons while it is chosen */
export const API_COLOR = "var(--vscode-charts-purple, #b180d7)";

const OPTIONS = [
  { backend: "cli", label: "CLI", Icon: Terminal, title: "Run locally with the Dataform CLI: your files as they are" },
  { backend: "api", label: "API", Icon: Cloud, title: "Run on GCP with the Dataform API: the branch as it is on the git remote" },
] as const;

interface RunBackendSwitchProps {
  backend: RunBackend;
  /** Remote mode runs through the Dataform API only: the CLI is there to be seen, and cannot be chosen */
  isRemoteMode: boolean;
  disabled?: boolean;
  onChange: (backend: RunBackend) => void;
}

/**
 * Where the row's runs go: Run, Run Tag and Run Changed alike. Both choices are always on show, so the other one
 * is a click away and is seen without opening anything.
 */
export function RunBackendSwitch({ backend, isRemoteMode, disabled, onChange }: RunBackendSwitchProps) {
  return (
    <div role="radiogroup" aria-label="Run with" className="inline-flex items-center h-6 p-[2px] rounded border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] flex-shrink-0">
      {OPTIONS.map(({ backend: option, label, Icon, title }) => {
        const unavailable = isRemoteMode && option === "cli";
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={option === backend}
            disabled={disabled || unavailable}
            onClick={() => onChange(option)}
            title={unavailable ? "The project is compiled with the Dataform API, which runs the pushed branch. Compile with the CLI to run your local files" : title}
            // The chosen side has the colour its runs have: the run buttons beside it take the same one
            style={option === backend ? { background: `color-mix(in srgb, ${option === "api" ? API_COLOR : "var(--vscode-button-background)"} 50%, transparent)` } : undefined}
            className={clsx(
              "flex items-center gap-1 h-full px-1.5 rounded-sm border-0 text-xs whitespace-nowrap transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-[var(--vscode-focusBorder)]",
              option === backend
                ? "text-[var(--vscode-foreground)] font-medium"
                : "bg-transparent text-[var(--vscode-descriptionForeground)] enabled:hover:text-[var(--vscode-foreground)]"
            )}
          >
            <Icon className="w-3 h-3" /> {label}
          </button>
        );
      })}
    </div>
  );
}
