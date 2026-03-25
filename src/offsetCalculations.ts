export function calculateIncrementalPreOpsOffset(
    incrementalPreOpsQuery: string | undefined,
    incrementalQuery: string | undefined,
    offSet: number
): number | undefined {
    if (!incrementalPreOpsQuery) {
        return undefined;
    }

    // N_p: lines occupied by pre-ops in the combined dry-run query (p + "\n" + incrementalQuery).
    // p.split('\n').length = iq.incrementalPreOpsQuery.split('\n').length (adding ";" doesn't add \n).
    const N_p = incrementalPreOpsQuery.split('\n').length;

    // N_inc_preamble: leading blank lines in incrementalQuery that Dataform adds before
    // the actual SQL content. These shift BigQuery error line numbers but are NOT in
    // the .sqlx editor file, so they must be subtracted when mapping back to editor lines.
    const incQueryLines = (incrementalQuery || '').split('\n');
    let N_inc_preamble = 0;
    for (const line of incQueryLines) {
        if (line.trim() === '') { N_inc_preamble++; } else { break; }
    }

    // setDiagnostics uses: preOpsOffset = compiledPreOpsLineCount + 2
    // We need: preOpsOffset = N_p + N_inc_preamble + 2 - offSet
    // (the -offSet cancels the offSet term in the formula, which also accounts for preamble)
    return N_p + N_inc_preamble - offSet;
}
