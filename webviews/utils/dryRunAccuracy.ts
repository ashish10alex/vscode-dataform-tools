import type { CSSProperties } from "react";

/**
 * BigQuery reports `totalBytesProcessed: "0"` whenever it cannot compute the byte count
 * statically (`totalBytesProcessedAccuracy: "UNKNOWN"`). The query still scans real data
 * when executed, so those figures must never be shown as a genuine estimate.
 *
 * Keep UNKNOWN_ACCURACY_STAT in sync with the constant of the same name in
 * src/utils/dataformHelpers.ts, which emits it in place of the bytes/cost figures.
 */
export const UNKNOWN_ACCURACY_STAT = "⚠ Bytes unknown";

export const UNKNOWN_ACCURACY_TOOLTIP =
  'BigQuery could not estimate the bytes this query scans (totalBytesProcessedAccuracy: UNKNOWN), so it reports 0 bytes and 0 cost. The query will still scan data when executed — treat this as "no estimate", not as free.';

/** Warning chip styling, shared by every surface that reports an un-estimable dry run. */
export const UNKNOWN_ACCURACY_CHIP_STYLE: CSSProperties = {
  backgroundColor: "var(--vscode-inputValidation-warningBackground)",
  color: "var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground))",
  border: "1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground))",
};
