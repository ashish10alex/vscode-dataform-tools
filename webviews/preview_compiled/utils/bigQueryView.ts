import type { BigQuerySlice } from "../../../src/shared/panelContract";
import { BigQueryFields, bigQueryFieldsOf } from "../../../src/shared/panelBigQueryView";
import { PanelSlices, fileOnShow } from "../../../src/shared/panelState";
import type { Target } from "../../../src/shared/compiledGraph";
import { isCompiling } from "./panelProblem";
import { fileView } from "./fileView";

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

/** What the Schema tab shows: the table whose columns they are, the columns, and whether new ones are on their way */
export interface SchemaOnShow {
  /** The table of the first action of the file on show. Unset while another file's SQL is on show, and for a file with no such action */
  target?: Target;
  /** The file on show, which names the tab while its target is not known */
  file?: string;
  /** The columns of the file on show. Null when there are none: never those of the file shown before */
  columns: Schema | null;
  /** A compile or dry runs are out: the file's columns are to come, or to be replaced */
  loading: boolean;
}

/**
 * The columns of the last dry runs stay while the next are out (see `PanelSlices.columns`), so that a save does not
 * empty the Schema tab. When another file is shown they are of the wrong table: the tab says the file's are loading.
 */
export function schemaOnShow(slices: Pick<PanelSlices, "compile" | "file" | "bigquery" | "columns">): SchemaOnShow {
  const file = fileOnShow(slices);
  const target = slices.file && slices.file.file === file ? fileView(slices.file).models[0]?.target : undefined;
  const columns = slices.columns && slices.columns.file.file === file ? columnsOnShow(slices.columns) : null;
  const loading = isCompiling(slices) || (slices.bigquery?.dryRunning.length ?? 0) > 0;
  return { target, file, columns, loading };
}
