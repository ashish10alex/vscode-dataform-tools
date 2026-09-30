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
