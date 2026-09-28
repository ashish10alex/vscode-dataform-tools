/*
 * Wording for what Run Changed compares, shared by the extension and the webview (no `vscode` import).
 */

/** `in feat/orders vs origin/main`, or `vs origin/main` when the compared branch is unknown. */
export function describeComparison(headRef: string | undefined, baseRef: string): string {
    return headRef ? `in ${headRef} vs ${baseRef}` : `vs ${baseRef}`;
}
