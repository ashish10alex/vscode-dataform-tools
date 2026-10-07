import type { BigQuerySlice } from "../../../src/shared/panelContract";
import { legacyStateFromBigQuerySlice } from "../../../src/shared/panelLegacyBigQuery";
import type { PanelSlices } from "../../../src/shared/panelState";
import type { ColumnMetadata, DryRunErrorAnnotation, LastModifiedTimeMetaItem } from "../types";
import { isCompiling } from "./panelProblem";

/**
 * What BigQuery said of the actions on show, worked out from the `bigquery` slice and the `file` slice it is for.
 * A result is found by the name the panel gives its action: the action's ID, or a unit test's name.
 */
export interface BigQueryView {
  /** Dry runs are out */
  dryRunning: boolean;
  currencySymbol: string;
  /** What each dry run would cost, as text */
  stats: Record<string, string>;
  errors: Record<string, DryRunErrorAnnotation>;
  incrementalErrors: Record<string, DryRunErrorAnnotation>;
  expectedOutputErrors: Record<string, DryRunErrorAnnotation>;
  /** The SQL that was dry-run, which the panel shows in place of the action's own */
  queries: Record<string, string>;
  incrementalQueries: Record<string, string>;
  nonIncrementalQueries: Record<string, string>;
  /** What is known of each model's table, by the model's position. Null for one that builds none */
  lastUpdates: Array<LastModifiedTimeMetaItem | null | undefined>;
}

const NONE: BigQuerySlice = { compile: 0, results: [], dryRunning: [], tables: {}, currencySymbol: "$" };

/**
 * While a compile runs, the costs, errors and table times of the last one are not shown: they are of SQL that is
 * being replaced. The SQL that was dry-run stays, as the SQL on show does. A slice of another compile than the
 * file's says nothing of the file.
 */
export function bigQueryView(slices: Pick<PanelSlices, "bigquery" | "file" | "compile">): BigQueryView {
  const sent = slices.bigquery ?? NONE;
  const ofThisCompile = !slices.file || sent.compile === slices.file.compile;
  const slice = ofThisCompile ? sent : { ...sent, results: [], tables: {} };
  const flat = legacyStateFromBigQuerySlice(slice, slices.file) as Record<string, any>;
  const compiling = isCompiling(slices);
  return {
    dryRunning: flat.dryRunning,
    currencySymbol: flat.currencySymbol,
    stats: compiling ? {} : flat.dryRunStatByNodeName,
    errors: compiling ? {} : flat.dryRunErrorsByNodeName,
    incrementalErrors: compiling ? {} : flat.dryRunIncrementalErrorsByNodeName,
    expectedOutputErrors: compiling ? {} : flat.dryRunExpectedOutputErrorsByNodeName,
    queries: flat.dryRunQueryByNodeName,
    incrementalQueries: flat.dryRunIncrementalQueryByNodeName,
    nonIncrementalQueries: flat.dryRunNonIncrementalQueryByNodeName,
    lastUpdates: compiling ? [] : flat.modelsLastUpdateTimesMeta ?? [],
  };
}

type Schema = { fields: ColumnMetadata[] };
// The Schema tab works its rows out again when the columns change: the same results must give the same object
const schemas = new WeakMap<NonNullable<PanelSlices["columns"]>, Schema | null>();

/**
 * The columns on show: those of the first action, from the last dry runs that gave results for the file (see
 * `PanelSlices.columns`). Null when the file on show has no action with columns.
 */
export function columnsOnShow(columns: PanelSlices["columns"]): Schema | null {
  if (!columns) {
    return null;
  }
  if (!schemas.has(columns)) {
    schemas.set(columns, (legacyStateFromBigQuerySlice(columns.bigquery, columns.file).compiledQuerySchema as Schema | undefined) ?? null);
  }
  return schemas.get(columns) ?? null;
}
