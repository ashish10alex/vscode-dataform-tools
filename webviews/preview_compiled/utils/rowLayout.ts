import { RowLayout, withRow } from "../../../src/shared/rowLayout";
import { vscode } from "./vscode";

declare global {
  interface Window {
    /** Which rows the user left open, as the host keeps it (see src/shared/rowLayout.ts) */
    rowLayout?: RowLayout;
  }
}

/** The layout as this page knows it: what the host put in the page, and every click since */
let layout: RowLayout = (typeof window !== "undefined" && window.rowLayout) || {};

/** Whether the user left the row open, closed, or has not chosen */
export function rowLeftOpen(label: string): boolean | undefined {
  return layout[label];
}

/** Keeps the user's choice: a row drawn again on this page starts that way, and so does it on the next page */
export function rememberRow(label: string, open: boolean) {
  layout = withRow(layout, label, open);
  vscode.postMessage({ command: "rememberRow", label, open });
}
