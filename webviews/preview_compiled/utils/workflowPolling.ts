export const TERMINAL_WORKFLOW_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export const POLL_FAST_MS = 5000;
// Cancellation usually settles within a few seconds, so poll more eagerly while any invocation is CANCELING.
export const POLL_CANCELING_MS = 1500;
export const POLL_SLOW_MS = 10000;
export const POLL_FAST_DURATION_MS = 30000;
export const POLL_TIMEOUT_MS = 30 * 60 * 1000;
