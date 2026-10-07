import type { FileSlice, PanelAction } from "../../../src/shared/panelContract";
import { LegacyModel, legacyStateFromFileSlice } from "../../../src/shared/panelLegacyFile";

/**
 * What the panel shows of the file, worked out from the `file` slice: its actions as the components draw them (a
 * model for each, with its SQL by part), the scripts joined from them, and what the file is when it has none.
 */
export interface FileView {
  /** The actions with SQL to show: tables, views and incremental tables, then assertions, operations, unit tests and notebooks. Empty when the file has none */
  models: LegacyModel[];
  /** What reads from the first model */
  dependents: Array<PanelAction["target"]>;
  /** The types of the models, each once */
  actionTypes: string[];
  /** The file affects a compile and defines no action */
  isHelperFile: boolean;
  /** Set for a file that only declares tables made elsewhere */
  declarations: Array<{ target: PanelAction["target"]; fileName: string }> | null;
  tableOrViewQuery: string;
  assertionQuery: string;
  incrementalQuery: string;
  operationsQuery: string;
  testQuery: string;
  expectedOutputQuery: string;
}

const NOTHING: FileView = {
  models: [], dependents: [], actionTypes: [], isHelperFile: false, declarations: null,
  tableOrViewQuery: "", assertionQuery: "", incrementalQuery: "", operationsQuery: "", testQuery: "", expectedOutputQuery: "",
};

// A slice is read by several components on every render, and the models must be the same objects each time
const views = new WeakMap<FileSlice, FileView>();

/** The view of a `file` slice. Before the host has sent one there is nothing to show */
export function fileView(file: FileSlice | undefined): FileView {
  if (!file) {
    return NOTHING;
  }
  let view = views.get(file);
  if (!view) {
    const derived = Object.fromEntries(Object.entries(legacyStateFromFileSlice(file)).filter(([, value]) => value !== null && value !== undefined));
    view = { ...NOTHING, ...(derived as Partial<FileView>) };
    views.set(file, view);
  }
  return view;
}
