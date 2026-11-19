import { Action, dryRunScripts, joinScript, previewSection } from '../shared/compiledGraph';
import { CteChoice, cteStatement } from './ctePreview';

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
 * previewed as it is. With `alone`, only the section's own SQL. With `cte`, the rows of that CTE of the query instead.
 *
 * Only the section that ends the first dry-run script of its variant can be previewed: that script is the one whose
 * rows are the action's. So the queries of both variants of an incremental table, an assertion's query, an operation
 * and a unit test's test query can be, as they always could. Post-operations cannot, though they are dry-run: a
 * preview runs its query for real, and theirs changes things. Undefined for any other section.
 */
export function previewQuery(action: Action, section: string, options: { alone?: boolean; cte?: CtePreviewOptions } = {}): PreviewQuery | undefined {
    const chosen = action.sections.find((candidate) => candidate.title === section);
    if (!chosen || !chosen.compiled) {
        return undefined;
    }
    const script = dryRunScripts(action).find((candidate) => candidate.incremental === (chosen.incremental === true));
    if (!script || previewSection(action, script.incremental) !== section) {
        return undefined;
    }
    if (options.cte) {
        return ctePreviewQuery(action, script.parts.map((part) => part.source), options.cte);
    }
    if (options.alone) {
        return { sql: joinScript([chosen.sql]).sql, sections: [section] };
    }
    return { sql: script.sql, sections: script.parts.map((part) => part.source) };
}

/** A CTE to preview instead of the section's own rows, and the LIMIT its SELECT ends with */
export interface CtePreviewOptions extends CteChoice {
    limit: number;
}

/** Sections run before a query, whose CTEs are not the query's: Dataform's pre-operations, dbt's pre-hooks */
const isPreOperations = (title: string) => /pre_operations$|^pre-hook/.test(title);

/**
 * The query that previews a CTE of the script made of the sections titled `titles`: the sections before the one the
 * CTE is in, then the CTE's WITH clause up to the CTE and a SELECT of its rows. Undefined when no section of the
 * query has the CTE.
 */
function ctePreviewQuery(action: Action, titles: string[], cte: CtePreviewOptions): PreviewQuery | undefined {
    const sections = titles.map((title) => action.sections.find((candidate) => candidate.title === title)!);
    const searched = sections.filter((section) => !isPreOperations(section.title));
    const found = cteStatement(searched.map((section) => section.sql), cte, cte.limit);
    if (!found) {
        return undefined;
    }
    const at = sections.indexOf(searched[found.index]);
    const before = sections.slice(0, at);
    return {
        sql: joinScript([...before.map((section) => section.sql), found.sql]).sql,
        sections: [...before.map((section) => section.title), sections[at].title],
    };
}
