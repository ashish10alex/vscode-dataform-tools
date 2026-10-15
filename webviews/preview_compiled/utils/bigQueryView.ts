import type { BigQuerySlice, FileSlice, PanelAction } from "../../../src/shared/panelContract";
import { BigQueryFields, bigQueryFieldsOf, schemaOf } from "../../../src/shared/panelBigQueryView";
import { fileModels } from "../../../src/shared/panelFileView";
import { PanelSlices, fileOnShow } from "../../../src/shared/panelState";
import type { Target } from "../../../src/shared/compiledGraph";
import type { CompiledQuerySchema } from "../../../src/types";
import { isCompiling } from "./panelProblem";

/**
 * What BigQuery said of the actions on show, worked out from the `bigquery` slice and the `file` slice it is for.
 * A result is found by the name the panel gives its action: the action's ID, or a unit test's name.
 */
export type BigQueryView = BigQueryFields;

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
  const view = bigQueryFieldsOf(slice, slices.file);
  return isCompiling(slices) ? { ...view, stats: {}, errors: {}, incrementalErrors: {}, expectedOutputErrors: {}, lastUpdates: [] } : view;
}

/** The columns of a table: the rows of the Schema tab */
export type Schema = CompiledQuerySchema;

/** A table the file builds, as its tab on the Schema tab shows it */
export interface TargetSchema {
  /** The action's ID, by which the tab chosen is kept from one compile of the file to the next */
  id: string;
  target: Target;
  /** Its columns, from the last dry runs that gave results for the file. Null when there are none */
  columns: Schema | null;
  /** What BigQuery said was wrong with its dry run */
  error?: string;
  /** A compile or its dry run is out: its columns are to come, or to be replaced */
  loading: boolean;
}

/** What the Schema tab shows */
export interface SchemaOnShow {
  /** The file on show, which names the tab while its tables are not known */
  file?: string;
  /**
   * The tables, views and incremental tables of the file, in the order the panel lists them. Empty while another
   * file's SQL is on show, and for a file that builds none
   */
  targets: TargetSchema[];
  /** A compile or dry runs are out */
  loading: boolean;
}

// The Schema tab works its rows out again when the columns change: the same results must give the same object
const schemas = new WeakMap<BigQuerySlice, Map<string, Schema | null>>();

/** An action's columns in a set of results, made once for each set */
function schemaIn(bigquery: BigQuerySlice, action: PanelAction): Schema | null {
  let byAction = schemas.get(bigquery);
  if (!byAction) {
    byAction = new Map();
    schemas.set(bigquery, byAction);
  }
  if (!byAction.has(action.id)) {
    byAction.set(action.id, schemaOf(bigquery, action) ?? null);
  }
  return byAction.get(action.id) ?? null;
}

const mainResult = (bigquery: BigQuerySlice, id: string) => bigquery.results.find((result) => result.action === id && result.script === "query" && !result.incremental);

/**
 * The columns of the last dry runs stay while the next are out (see `PanelSlices.columns`), so that a save does not
 * empty the Schema tab. When another file is shown they are of the wrong tables: the tab says the file's are loading.
 * A table whose dry run is back has its columns while those of the others are still out.
 */
export function schemaOnShow(slices: Pick<PanelSlices, "compile" | "file" | "bigquery" | "columns">): SchemaOnShow {
  const file = fileOnShow(slices);
  const compiling = isCompiling(slices);
  const dryRunning = slices.bigquery?.dryRunning ?? [];
  const shown = slices.file && slices.file.file === file ? slices.file : undefined;
  const live = shown && slices.bigquery?.compile === shown.compile ? slices.bigquery : undefined;
  const kept = slices.columns && slices.columns.file.file === file ? slices.columns : undefined;
  const tables = shown ? fileModels(shown).filter(({ model }) => !NO_TABLE.has(model.type)) : [];
  const pending = !!shown && awaitsBigQuery(slices.bigquery, shown);
  const targets = tables.map(({ action }): TargetSchema => {
    const fresh = live && mainResult(live, action.id);
    const from = fresh ? { bigquery: live, result: fresh, action } : kept && { bigquery: kept.bigquery, result: mainResult(kept.bigquery, action.id), action: kept.file.actions.find((candidate) => candidate.id === action.id) };
    return {
      id: action.id,
      target: action.target,
      columns: from?.action ? schemaIn(from.bigquery, from.action) : null,
      ...(from?.result?.error ? { error: from.result.error.message } : {}),
      loading: compiling || pending || dryRunning.some((key) => key.action === action.id),
    };
  });
  return { file, targets, loading: compiling || pending || dryRunning.length > 0 };
}

/**
 * The `bigquery` slice on hand is of another file than the one on show, so the file's own is still to come: it is of
 * an earlier compile, or names actions and none of the file's. One that names nothing may be the file's own: the
 * host does not send a slice the same as the last.
 */
function awaitsBigQuery(bigquery: BigQuerySlice | undefined, file: FileSlice): boolean {
  if (!bigquery) {
    return false;
  }
  if (bigquery.compile < file.compile) {
    return true;
  }
  const named = [...bigquery.results.map((result) => result.action), ...bigquery.dryRunning.map((key) => key.action)];
  return named.length > 0 && !named.some((id) => file.actions.some((action) => action.id === id));
}

/** What the panel lists that builds no table with columns to show */
const NO_TABLE = new Set(["assertion", "operations", "test", "notebook"]);
