import { Action, dryRunScripts, joinScript, previewSection } from '../shared/compiledGraph';

/*
 * What a preview runs for an action of a Compiled Graph, whichever Backend compiled it. The host runs the query with
 * its row limit and shows the rows, as it always has; this only chooses the SQL.
 */

export interface PreviewQuery {
    sql: string;
    /** The sections the query was made of, by title, in order. The last is the one that was asked for */
    sections: string[];
}

/**
 * The query that previews the section titled `section`: the section after what must run before it. A Dataform
 * table's query is previewed after its pre-operations, so that what they declare resolves; a dbt model's query is
 * previewed as it is. With `alone`, only the section's own SQL.
 *
 * Only the section that ends the first dry-run script of its variant can be previewed: that script is the one whose
 * rows are the action's. So the queries of both variants of an incremental table, an assertion's query, an operation
 * and a unit test's test query can be, as they always could. Post-operations cannot, though they are dry-run: a
 * preview runs its query for real, and theirs changes things. Undefined for any other section.
 */
export function previewQuery(action: Action, section: string, options: { alone?: boolean } = {}): PreviewQuery | undefined {
    const chosen = action.sections.find((candidate) => candidate.title === section);
    if (!chosen || !chosen.compiled) {
        return undefined;
    }
    const script = dryRunScripts(action).find((candidate) => candidate.incremental === (chosen.incremental === true));
    if (!script || previewSection(action, script.incremental) !== section) {
        return undefined;
    }
    if (options.alone) {
        return { sql: joinScript([chosen.sql]).sql, sections: [section] };
    }
    return { sql: script.sql, sections: script.parts.map((part) => part.source) };
}
