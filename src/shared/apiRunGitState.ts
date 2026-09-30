/*
 * What a run through the Dataform API leaves out. The API compiles and runs the branch as it is on the
 * git remote, so uncommitted and unpushed changes to the Dataform project do not run.
 * Shared by the extension and the webview (no `vscode` import).
 */

export type ApiRunFileSource = "uncommitted" | "unpushed";

export type ApiRunFileChange = {
    /** Relative to the Dataform project folder, with forward slashes */
    path: string;
    status: "M" | "A" | "D";
    source: ApiRunFileSource;
};

export type ApiRunGitState =
    /** Not a git repository, or git could not be run: nothing to say */
    | { kind: "unavailable" }
    /** The branch is not on the git remote; `branch` is undefined on a detached HEAD */
    | { kind: "noUpstream"; branch?: string }
    | {
        kind: "tracking";
        branch: string;
        /** e.g. `origin/feat/orders` */
        upstream: string;
        uncommitted: ApiRunFileChange[];
        /** Unpushed commits that touch the Dataform project */
        unpushedCommits: number;
        unpushedFiles: ApiRunFileChange[];
        /** Commits on the upstream missing locally, as of the last fetch */
        behind: number;
    };

/** Paths, relative to the Dataform project folder, whose changes affect what the API compiles. */
export const DATAFORM_PROJECT_PATHSPECS = ["definitions", "includes", "workflow_settings.yaml", "dataform.json", "package.json"];

export function isDataformProjectFile(relativePath: string): boolean {
    return DATAFORM_PROJECT_PATHSPECS.some((spec) => relativePath === spec || relativePath.startsWith(`${spec}/`));
}

function toStatus(code: string): ApiRunFileChange["status"] {
    if (code === "??" || code.includes("A")) {
        return "A";
    }
    return code.includes("D") ? "D" : "M";
}

/**
 * Parses `git status --porcelain -z --no-renames`, whose paths are relative to the repository root.
 * `prefix` is the Dataform folder relative to that root (`git rev-parse --show-prefix`, e.g. `dataform/`).
 */
export function parseStatusPorcelainZ(output: string, prefix: string): ApiRunFileChange[] {
    return output.split("\0").filter(Boolean).flatMap((entry) => {
        const repoPath = entry.slice(3);
        if (!repoPath.startsWith(prefix)) {
            return [];
        }
        const path = repoPath.slice(prefix.length);
        return isDataformProjectFile(path) ? [{ path, status: toStatus(entry.slice(0, 2)), source: "uncommitted" as const }] : [];
    });
}

/** Parses `git diff --name-status -z --no-renames --relative`, whose paths are relative to the Dataform folder. */
export function parseNameStatusZ(output: string): ApiRunFileChange[] {
    const fields = output.split("\0").filter(Boolean);
    const changes: ApiRunFileChange[] = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
        const path = fields[i + 1];
        if (isDataformProjectFile(path)) {
            changes.push({ path, status: toStatus(fields[i]), source: "unpushed" });
        }
    }
    return changes;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const MAX_TOOLTIP_FILES = 20;

export type ApiRunGitSummary = {
    tone: "muted" | "warning" | "error";
    label: string;
    tooltip: string;
};

/** The chip shown next to Run when it goes through the Dataform API; undefined when there is nothing to show. */
export function describeApiRunGitState(state: ApiRunGitState | undefined): ApiRunGitSummary | undefined {
    if (!state || state.kind === "unavailable") {
        return undefined;
    }
    if (state.kind === "noUpstream") {
        const label = state.branch
            ? `${state.branch} isn't on the git remote — API run will fail`
            : "Detached HEAD — API run needs a branch pushed to the git remote";
        return {
            tone: "error",
            label,
            tooltip: "Run via API compiles and runs a branch as it is on the git remote. Push the branch first.",
        };
    }

    const lines = [`Run via API uses ${state.upstream} on the git remote, not your local files.`];
    const parts: string[] = [];
    if (state.uncommitted.length > 0) {
        parts.push(plural(state.uncommitted.length, "uncommitted file"));
    }
    if (state.unpushedFiles.length > 0) {
        // A diff through a merge can list files without a commit that touches them on its own side
        parts.push(plural(Math.max(state.unpushedCommits, 1), "unpushed commit"));
    }
    const notIncluded = [...state.uncommitted, ...state.unpushedFiles];
    if (notIncluded.length > 0) {
        lines.push("Not included:");
        notIncluded.slice(0, MAX_TOOLTIP_FILES).forEach((file) => lines.push(`  ${file.status} ${file.path} (${file.source})`));
        if (notIncluded.length > MAX_TOOLTIP_FILES) {
            lines.push(`  …and ${notIncluded.length - MAX_TOOLTIP_FILES} more`);
        }
    }
    if (state.behind > 0) {
        lines.push(`${state.upstream} has ${plural(state.behind, "commit")} you don't have locally (as of the last fetch).`);
    }

    return {
        tone: parts.length > 0 ? "warning" : "muted",
        label: parts.length > 0 ? `${parts.join(" · ")} won't run` : `Runs ${state.upstream}`,
        tooltip: lines.join("\n"),
    };
}
