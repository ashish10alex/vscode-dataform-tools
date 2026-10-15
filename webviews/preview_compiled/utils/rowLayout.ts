import { RowLayout, TabLayout, withRow, withTab } from "../../../src/shared/rowLayout";
import { vscode } from "./vscode";

declare global {
  interface Window {
    /** Which rows the user left open, as the host keeps it (see src/shared/rowLayout.ts) */
    rowLayout?: RowLayout;
    /** Which tab of each group the user left on show, as the host keeps it */
    tabLayout?: TabLayout;
  }
}

/** The layout as this page knows it: what the host put in the page, and every click since */
let layout: RowLayout = (typeof window !== "undefined" && window.rowLayout) || {};
let tabs: TabLayout = (typeof window !== "undefined" && window.tabLayout) || {};

/** Whether the user left the row open, closed, or has not chosen */
export function rowLeftOpen(label: string): boolean | undefined {
  return layout[label];
}

/** Keeps the user's choice: a row drawn again on this page starts that way, and so does it on the next page */
export function rememberRow(label: string, open: boolean) {
  layout = withRow(layout, label, open);
  vscode.postMessage({ command: "rememberRow", label, open });
}

/** The tab of the group the user left on show, if they chose one */
export function tabLeftOn(group: string): string | undefined {
  return tabs[group];
}

/** Keeps the user's choice: the group starts on the tab, on this page and the next */
export function rememberTab(group: string, tab: string) {
  tabs = withTab(tabs, group, tab);
  vscode.postMessage({ command: "rememberTab", group, tab });
}
