import type { CompileError } from "../../../src/backend/backend";
import type { FileProblem } from "../../../src/shared/panelContract";
import { NOT_IN_A_PROJECT } from "../../../src/shared/panelLegacyState";
import type { PanelSlices } from "../../../src/shared/panelState";
import { CompilationErrorType } from "../types";

/** Why the panel has nothing to show for the file, worked out from the compile status and the `file` slice */
export interface PanelProblem {
  /** A compile is running */
  compiling: boolean;
  /** What is wrong: the compile's doing, or the file's own. Null when nothing is */
  type: CompilationErrorType | null;
  /** For the user; may hold HTML. Null where the panel has its own words for the type, and while a compile runs */
  message: string | null;
  /** The errors the last compile left. Empty while the next one runs */
  compileErrors: CompileError[];
  /** The tools that were looked for and not found */
  missingTools: string[];
}

const FILE_PROBLEM: Record<FileProblem["kind"], CompilationErrorType> = {
  "unsupported file type": CompilationErrorType.UNSUPPORTED_FILE_TYPE,
  "no action": CompilationErrorType.FILE_NOT_FOUND,
  "no sql": CompilationErrorType.QUERY_META_ERROR,
  other: CompilationErrorType.COMPILATION_ERROR,
};

const errorsOf = (status: PanelSlices["compile"]): CompileError[] =>
  status && (status.status === "compiled" || status.status === "parsed only" || status.status === "failed") ? status.errors : [];

export function isCompiling(slices: Pick<PanelSlices, "compile">): boolean {
  return slices.compile?.status === "compiling";
}

/**
 * A file with something to show has no problem. One with nothing to show has its own problem, if it names one;
 * otherwise the reason is the compile's: the file is in no Project, the tool was not found, or the compile left
 * errors. While a compile runs, what was wrong before it started still is: the last compile that finished says.
 */
export function panelProblem({ compile, settled, file }: Pick<PanelSlices, "compile" | "settled" | "file">): PanelProblem {
  const compiling = compile?.status === "compiling";
  const status = compiling ? settled : compile;
  const problem: PanelProblem = {
    compiling,
    type: null,
    message: null,
    compileErrors: compiling ? [] : errorsOf(compile),
    missingTools: status?.status === "tool not found" ? [status.tool] : [],
  };
  if (file?.problem) {
    problem.type = FILE_PROBLEM[file.problem.kind];
    problem.message = file.problem.message ?? null;
  } else if (!file || file.role === "not compiled") {
    if (status?.status === "tool not found") {
      problem.type = CompilationErrorType.MISSING_EXECUTABLE;
    } else if (status?.status === "no project") {
      problem.type = CompilationErrorType.NOT_A_DATAFORM_WORKSPACE;
      problem.message = NOT_IN_A_PROJECT;
    } else if (errorsOf(status).length > 0) {
      problem.type = CompilationErrorType.COMPILATION_ERROR;
    }
  }
  if (compiling) {
    problem.message = null;
  }
  return problem;
}
