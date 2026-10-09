import { Folder } from "lucide-react";
import type { ProjectSlice } from "../../../src/shared/panelContract";

/** Names the Project the file on show is in, when the host found that worth saying: see `ProjectSlice.label` */
export function ProjectLabel({ project, className }: { project: ProjectSlice | null | undefined; className?: string }) {
  if (!project?.label) {
    return null;
  }
  return (
    <span title={`Project root: ${project.root}`} className={`flex items-center text-xs text-[var(--vscode-descriptionForeground)] ${className ?? ""}`}>
      <Folder className="w-3 h-3 mr-1 flex-shrink-0" />
      {project.label}
    </span>
  );
}
