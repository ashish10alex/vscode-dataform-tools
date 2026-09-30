import type { CompilationInfo } from "../../../src/utils/compilationInfo";

export function formatRelativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) { return "just now"; }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) { return `${minutes} min ago`; }
  const hours = Math.round(minutes / 60);
  if (hours < 24) { return `${hours} h ago`; }
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/** Text parts shown in the compilation info badge, e.g. ["API @ 87be5b3", "cached", "12 min ago"] */
export function compilationInfoParts(info: CompilationInfo, now: number): string[] {
  const parts: string[] = [];
  if (info.backend === "api") {
    const sha = info.sha ? ` @ ${info.sha.slice(0, 7)}` : "";
    parts.push(`API${sha}`);
    if (info.releaseConfig) {
      parts.push(info.releaseConfig);
    }
  } else {
    parts.push("CLI");
  }
  if (info.durationMs !== undefined && !info.fromCache) {
    parts.push(`${(info.durationMs / 1000).toFixed(2)}s`);
  } else if (info.fromCache) {
    parts.push("cached");
  }
  parts.push(formatRelativeTime(info.compiledAt, now));
  return parts;
}

const CLI_SOURCE_LABELS = {
  path: "found on PATH",
  setting: "from the vscode-dataform-tools.dataformExecutablePath setting",
  local: "from the project's node_modules (dataformCliScope: local)",
};

/** The CLI that ran, shown inline only when it is not simply the `dataform` found on PATH. */
export function customCliLabel(info: CompilationInfo): string | undefined {
  if (info.backend !== "cli" || !info.cliPath || !info.cliSource || info.cliSource === "path") {
    return undefined;
  }
  return `${info.cliPath} (${info.cliSource === "setting" ? "dataformExecutablePath" : "local"})`;
}

export function compilationInfoTooltip(info: CompilationInfo): string {
  const lines = [
    info.backend === "api"
      ? `Compiled with the Dataform API${info.sha ? ` from pushed commit ${info.sha}` : ""}`
      : "Compiled locally with the Dataform CLI",
    `Compiled at ${new Date(info.compiledAt).toLocaleString()}`,
  ];
  if (info.backend === "cli" && info.cliPath) {
    lines.push(`Dataform CLI: ${info.cliPath}${info.cliSource ? ` (${CLI_SOURCE_LABELS[info.cliSource]})` : ""}`);
  }
  if (info.releaseConfig) {
    lines.push(`Using compilation settings of release config ${info.releaseConfig}`);
  }
  if (info.fromCache) {
    lines.push(info.backend === "api"
      ? "Served from the cache; click Recompile to compile the latest pushed commit"
      : "Saved from an earlier session; save any Dataform file to recompile");
  }
  if (info.stale && info.staleReason) {
    lines.push(info.staleReason);
  }
  if (info.hasErrors) {
    lines.push("Compilation has errors");
  }
  return lines.join("\n");
}
