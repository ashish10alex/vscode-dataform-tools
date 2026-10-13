import type { BigQuerySlice } from "../../../src/shared/panelContract";
import { BigQueryFields, bigQueryFieldsOf } from "../../../src/shared/panelBigQueryView";
import type { PanelSlices } from "../../../src/shared/panelState";
import { isCompiling } from "./panelProblem";

/**
 * What BigQuery said of the actions on show, worked out from the `bigquery` slice and the `file` slice it is for.
 * A result is found by the name the panel gives its action: the action's ID, or a unit test's name.
 */
export type BigQueryView = Omit<BigQueryFields, 'columns'>;

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
  const { columns: _columns, ...view } = bigQueryFieldsOf(slice, slices.file);
  return isCompiling(slices) ? { ...view, stats: {}, errors: {}, incrementalErrors: {}, expectedOutputErrors: {}, lastUpdates: [] } : view;
}

type Schema = NonNullable<BigQueryFields['columns']>;
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
    schemas.set(columns, bigQueryFieldsOf(columns.bigquery, columns.file).columns ?? null);
  }
  return schemas.get(columns) ?? null;
}
