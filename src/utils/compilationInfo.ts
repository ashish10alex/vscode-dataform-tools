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

let currentInfo: CompilationInfo | undefined;
let onChanged: ((info: CompilationInfo) => void) | undefined;

export function setCompilationInfo(info: CompilationInfo) {
    currentInfo = info;
    onChanged?.(info);
}

export function getCompilationInfo(): CompilationInfo | undefined {
    return currentInfo;
}

export function setOnCompilationInfoChanged(callback: (info: CompilationInfo) => void) {
    onChanged = callback;
}
