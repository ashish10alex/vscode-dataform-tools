/*
 * Which rows of the compiled-query panel the user left open, by the row's label: one layout for every file, Project
 * and Backend. The host keeps it in globalState, synced across the user's machines, and puts it in the panel's page.
 */

/** The globalState key of the layout. Not of the `vscode_dataform_tools_` cache, which Clear Extension Cache empties */
export const ROW_LAYOUT_KEY = 'dataformTools.panelRows';

/** Whether each row the user opened or closed was left open, by its label */
export type RowLayout = Record<string, boolean>;

/** A label the host keeps: the panel's own labels are a few words */
export function isRowLabel(label: unknown): label is string {
    return typeof label === 'string' && label.length > 0 && label.length <= 40;
}

/**
 * How a row starts: open (true), closed (false), or null to follow its problem, opening while it has one.
 *
 * A row that stays closed starts as every other does not: it opens only when asked, and what it was left at is not
 * kept. A row left closed still opens on a problem it has when drawn, as it would on one that came later.
 */
export function firstChoice(row: { left: boolean | undefined; defaultOpen?: boolean; problem: boolean; staysClosed?: boolean }): boolean | null {
    if (row.staysClosed) {
        return null;
    }
    const left = row.left ?? (row.defaultOpen ? true : undefined);
    if (left === false && row.problem) {
        return null;
    }
    return left ?? null;
}

/** The layout after the user opened or closed a row */
export function withRow(layout: RowLayout, label: string, open: boolean): RowLayout {
    return { ...layout, [label]: open };
}

/** The globalState key of which tab the user left on show, by the tabs' group, e.g. the lists of the Lineage row */
export const TAB_LAYOUT_KEY = 'dataformTools.panelTabs';

/** The key of the tab the user left on show, by the tabs' group */
export type TabLayout = Record<string, string>;

/** A group and tab the host keeps: the panel's own are a word or two */
export function isTabChoice(group: unknown, tab: unknown): boolean {
    return isRowLabel(group) && isRowLabel(tab);
}

/** The tabs after the user chose one of a group */
export function withTab(layout: TabLayout, group: string, tab: string): TabLayout {
    return { ...layout, [group]: tab };
}
