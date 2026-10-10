import { AlertTriangle, GitBranch, XCircle } from "lucide-react";
import clsx from "clsx";
import type { ApiRunGitState } from "../../../src/shared/apiRunGitState";
import { describeApiRunGitState } from "../../../src/shared/apiRunGitState";
import { API_COLOR } from "./RunBackendSwitch";

const TONE_CLASSES = {
  muted: "text-[var(--vscode-descriptionForeground)]",
  warning: "px-1.5 py-0.5 rounded border text-[var(--vscode-editorWarning-foreground)] border-[var(--vscode-editorWarning-foreground)]",
  error: "px-1.5 py-0.5 rounded border text-[var(--vscode-errorForeground)] border-[var(--vscode-errorForeground)]",
};

/**
 * Shown next to Run when it goes through the Dataform API, which runs the branch as it is on the git
 * remote: names the ref it runs and the local changes that will not be part of the run.
 */
export function ApiRunGitChip({ state }: { state?: ApiRunGitState }) {
  const summary = describeApiRunGitState(state);
  if (!summary) {
    return null;
  }
  const Icon = summary.tone === "error" ? XCircle : summary.tone === "warning" ? AlertTriangle : GitBranch;
  return (
    <span
      role="status"
      title={summary.tooltip}
      className={clsx("inline-flex items-center gap-1 text-xs cursor-default", TONE_CLASSES[summary.tone])}
    >
      {/* In the colour of the API in the row above, where the note is no warning: it is of the same thing */}
      <Icon className="w-3 h-3 shrink-0" style={summary.tone === "muted" ? { color: API_COLOR } : undefined} aria-hidden="true" />
      {summary.label}
    </span>
  );
}
