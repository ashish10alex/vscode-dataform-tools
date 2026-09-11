/**
 * BigQuery reports `totalBytesProcessed: "0"` whenever it cannot compute the byte count
 * statically (`totalBytesProcessedAccuracy: "UNKNOWN"`). The query still scans real data
 * when executed, so the 0 must never be presented as a genuine estimate.
 *
 * Keep UNKNOWN_ACCURACY_MARKER in sync with the constant of the same name in
 * src/utils/dataformHelpers.ts, which appends it to dry run stat strings.
 */
export const UNKNOWN_ACCURACY_MARKER = " ⚠";

export const UNKNOWN_ACCURACY_TOOLTIP =
  'BigQuery could not estimate the bytes this query scans (totalBytesProcessedAccuracy: UNKNOWN), so it reports 0 bytes. The query will still scan data when executed — treat this as "no estimate", not as free.';
