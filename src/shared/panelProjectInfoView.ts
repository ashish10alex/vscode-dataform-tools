import type { ProjectInfoSlice } from './panelContract';

/*
 * What the Project tab of the compiled-query panel works out from the `project info` slice. The rows themselves are
 * worked out by the host (src/panel/projectInfo.ts), which may use Node; this is what the panel may use too.
 */

/** How many rows of a slice are marked as a likely mistake */
export function warningsOf(slice: ProjectInfoSlice | undefined): number {
    return (slice?.sections ?? []).flatMap((section) => section.rows).filter((row) => row.warning).length;
}
