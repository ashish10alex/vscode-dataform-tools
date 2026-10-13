/*
 * Which Compilation Mode produced the compiled JSON currently in use and how fresh it is, so the compiled
 * query panel can show it. Remote mode serves results from a per-commit cache, so without this the
 * user cannot tell whether they are looking at an old compilation.
 */

export type CompilationInfo = {
    mode: "cli" | "api";
    /** Epoch ms of the compilation that produced the result */
    compiledAt: number;
    /** Only set when the compilation ran just now (not when served from a cache) */
    durationMs?: number;
    /** api: served from the per-commit cache */
    fromCache: boolean;
    /** api: compiled commit */
    sha?: string;
    /** api: local HEAD, uncommitted changes or the upstream differ from the compiled commit */
    stale?: boolean;
    staleReason?: string;
    /** api: short name of the release config whose compilation settings were used */
    releaseConfig?: string;
    hasErrors?: boolean;
    /** cli: the Dataform CLI that ran */
    cliPath?: string;
    /** cli: where that CLI came from; anything but "path" is worth pointing out when it fails */
    cliSource?: "path" | "setting" | "local";
};

/** By the root of the Project compiled: each Project has its own tool and its own last compile */
const infoOf = new Map<string, CompilationInfo>();
let onChanged: ((info: CompilationInfo, root: string) => void) | undefined;

/** Notes how the Project at `root` was last compiled */
export function setCompilationInfo(root: string, info: CompilationInfo) {
    infoOf.set(root, info);
    onChanged?.(info, root);
}

/** How the Project at `root` was last compiled; undefined before its first compile, and with no Project */
export function getCompilationInfo(root: string | undefined): CompilationInfo | undefined {
    return root === undefined ? undefined : infoOf.get(root);
}

export function setOnCompilationInfoChanged(callback: (info: CompilationInfo, root: string) => void) {
    onChanged = callback;
}
