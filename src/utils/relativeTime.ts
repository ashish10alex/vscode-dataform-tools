/** e.g. "just now", "12 min ago", "3 h ago", "2 d ago". Shared by the extension and the webviews, so no vscode import. */
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
