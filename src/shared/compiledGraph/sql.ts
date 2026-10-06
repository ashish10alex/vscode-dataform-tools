import type { Action } from './graph';

/*
 * An action's SQL as titled sections in execution order. A Backend builds them with `titledSections`; everything
 * else reads them.
 */

/** One titled block of an action's SQL */
export interface SqlSection {
    /** Unique within its action, so a BigQuery result can be keyed by action and section */
    title: string;
    sql: string;
    /**
     * Set on the sections of the run that updates an existing table, when the action has SQL for that as well as
     * for a full rebuild: a Dataform incremental table does; a dbt one is compiled once, for one or the other.
     */
    incremental?: boolean;
    /** False for SQL shown as written, which its tool compiles only when it runs it: a dbt pre- or post-hook */
    compiled: boolean;
    /** Whether the section is part of what is dry-run for the action, see `dryRunScripts` */
    dryRun: boolean;
}

export type SectionFlags = Omit<SqlSection, 'title' | 'sql'>;

/**
 * Sections for the statements of one part of an action, numbered "title 1/2", "title 2/2" when there are several.
 * Leading and trailing blank lines are dropped, and so are empty statements.
 */
export function titledSections(title: string, statements: Array<string | undefined>, flags: SectionFlags): SqlSection[] {
    const sections: SqlSection[] = [];
    statements.forEach((statement, index) => {
        const sql = (statement ?? '').replace(/^\n+|\n+$/g, '');
        if (sql.trim() === '') {
            return;
        }
        sections.push({ title: statements.length > 1 ? `${title} ${index + 1}/${statements.length}` : title, sql, ...flags });
    });
    return sections;
}

/** Whether the action has SQL for runs that update an existing table as well as for full rebuilds */
export function hasIncrementalVariant(action: Action): boolean {
    return action.sections.some((section) => section.incremental);
}

/**
 * The SQL the action executes, in execution order. For an action with an incremental variant, `incremental` selects
 * it instead of the full rebuild.
 */
export function sectionsFor(action: Action, incremental: boolean): SqlSection[] {
    const variant = incremental && hasIncrementalVariant(action);
    return action.sections.filter((section) => (section.incremental === true) === variant);
}
