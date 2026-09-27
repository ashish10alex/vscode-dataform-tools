import type { WorkflowAction } from '../types';

/*
 * Timing helpers for workflow actions, shared by the extension and the webview (no `vscode` import).
 */

/** Compact duration for tables: `1.2s`, `33s`, `1m 04s`, `2h 06m`. */
export function formatDuration(ms: number): string {
    if (ms < 10_000) {
        return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
    }
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m ${String(totalSeconds % 60).padStart(2, '0')}s`;
    }
    return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m`;
}

/** Epoch ms from a protobuf `Timestamp`, whose `seconds` may arrive as a number, string or Long. */
export function timestampToMs(timestamp: { seconds?: unknown, nanos?: unknown } | null | undefined): number | undefined {
    if (timestamp?.seconds === undefined || timestamp.seconds === null) {
        return undefined;
    }
    const seconds = Number(String(timestamp.seconds));
    if (!Number.isFinite(seconds)) {
        return undefined;
    }
    return seconds * 1000 + Math.floor((Number(timestamp.nanos) || 0) / 1e6);
}

/**
 * A finished action that ran a BigQuery job still needs its stats loaded. Stats cached before timing was
 * recorded have no `endTime`, which every finished job has, so they are loaded again.
 */
export function needsJobStats(action: WorkflowAction): boolean {
    if (!action.jobId || (action.state !== 'SUCCEEDED' && action.state !== 'FAILED')) {
        return false;
    }
    return !action.jobStats || (!action.jobStats.error && action.jobStats.endTime === undefined);
}
