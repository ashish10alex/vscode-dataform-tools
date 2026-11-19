/*
 * Run Changed wording and file grouping, shared by the extension and the webview (no `vscode` import).
 */

/** `in feat/orders vs origin/main`, or `vs origin/main` when the compared branch is unknown. */
export function describeComparison(headRef: string | undefined, baseRef: string): string {
    return headRef ? `in ${headRef} vs ${baseRef}` : `vs ${baseRef}`;
}

const UNKNOWN_FILE = '(unknown file)';

/** The file Run Changed groups an action under, and selects it by; actions without a file share one group. */
export function changedFileKey(fileName: string): string {
    return fileName || UNKNOWN_FILE;
}

/** A changed action that may be a deleted one renamed: see `pairRenames` in src/utils/renames.ts */
export interface MaybeRenamed {
    fileName: string;
    reasons: string[];
    renamedFrom?: string;
    renamedFromFile?: string;
    similarity?: number;
}

/** What a renamed action is listed for: `renamed` in place of `new`, as it isn't one */
export function displayReasons(action: MaybeRenamed): string[] {
    return action.renamedFrom ? action.reasons.map((reason) => reason === 'new' ? 'renamed' : reason) : action.reasons;
}

/**
 * What a file of renamed actions was, by file, as xf shows it: "← old.sqlx (95%)" for a file git calls renamed, the
 * old file's name or its path when it moved to another folder; "← old_schema.old_name" for a file that kept its path
 * but moves its action.
 */
export function renamedFromLabels(actions: MaybeRenamed[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const action of actions) {
        if (!action.renamedFrom) {
            continue;
        }
        const key = changedFileKey(action.fileName);
        if (!action.renamedFromFile || action.renamedFromFile === action.fileName) {
            labels.set(key, `← ${action.renamedFrom.split('.').slice(-2).join('.')}`);
            continue;
        }
        const dir = (file: string) => file.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
        const from = dir(action.renamedFromFile) === dir(action.fileName) ? action.renamedFromFile.replace(/\\/g, '/').split('/').pop()! : action.renamedFromFile;
        labels.set(key, `← ${from} (${action.similarity ?? 0}%)`);
    }
    return labels;
}
