import { CteDefinition, findCtes } from '../cteScanner';
import { blankCommentsAndStrings } from '../configBlock/parser';

/*
 * Previewing one CTE of a query: the query's WITH clause up to and including the CTE, then a SELECT of the CTE's
 * rows. The CTE is chosen in the file as written and found again by name in the compiled SQL, where refs and
 * templates are resolved.
 */

/** A CTE a preview is asked for: its name, and which of the previewable CTEs of that name it is, counting from 0 */
export interface CteChoice {
    name: string;
    occurrence: number;
}

/** Blocks of a .sqlx file whose CTEs are not part of the query a preview runs */
const SQLX_OTHER_BLOCK = /(^|\n)[ \t]*(config|js|pre_operations|post_operations)\s*\{/g;

function sqlxOtherBlocks(text: string): { start: number; end: number }[] {
    const blanked = blankCommentsAndStrings(text);
    const blocks: { start: number; end: number }[] = [];
    for (const match of blanked.matchAll(SQLX_OTHER_BLOCK)) {
        const open = (match.index ?? 0) + match[0].length - 1;
        let depth = 0;
        let end = blanked.length;
        for (let i = open; i < blanked.length; i++) {
            if (blanked[i] === '{') {
                depth++;
            } else if (blanked[i] === '}' && --depth === 0) {
                end = i + 1;
                break;
            }
        }
        blocks.push({ start: open, end });
    }
    return blocks;
}

/**
 * The CTEs of `text` a preview can be asked for: those of a WITH that starts a statement, not one inside
 * parentheses, whose CTEs may read the CTEs around them. In a .sqlx file (`sqlx`), not those of its config, js,
 * pre_operations or post_operations blocks either.
 */
export function previewableCtes(text: string, sqlx = false): CteDefinition[] {
    const blocks = sqlx ? sqlxOtherBlocks(text) : [];
    return findCtes(text).filter((cte) =>
        text[cte.scopeEnd] !== ')' && !blocks.some((block) => cte.start >= block.start && cte.start < block.end));
}

/** The previewable CTEs of `text`, each with the choice that names it */
export function cteChoices(text: string, sqlx = false): { cte: CteDefinition; choice: CteChoice }[] {
    const seen = new Map<string, number>();
    return previewableCtes(text, sqlx).map((cte) => {
        const key = cte.name.toLowerCase();
        const occurrence = seen.get(key) ?? 0;
        seen.set(key, occurrence + 1);
        return { cte, choice: { name: cte.name, occurrence } };
    });
}

/** The choice of the previewable CTE whose definition holds `offset`, the innermost when they nest */
export function cteChoiceAt(text: string, offset: number, sqlx = false): CteChoice | undefined {
    return cteChoices(text, sqlx)
        .filter(({ cte }) => offset >= cte.start && offset <= cte.end)
        .sort((a, b) => b.cte.start - a.cte.start)[0]?.choice;
}

/**
 * Finds `choice` among the statements of a script, in order: the index of the statement it is in, and the
 * statement that previews it, which ends in `LIMIT limit`. The occurrence counts across all the statements; when
 * there are fewer CTEs of the name than in the file as written (a CTE in a variant the compile did not choose,
 * say), the last one is taken. Undefined when no statement has a CTE of that name.
 */
export function cteStatement(statements: string[], choice: CteChoice, limit: number): { index: number; sql: string } | undefined {
    const found = statements.flatMap((sql, index) => previewableCtes(sql)
        .filter((cte) => cte.name.toLowerCase() === choice.name.toLowerCase())
        .map((cte) => ({ sql, index, cte })));
    const chosen = found[Math.min(choice.occurrence, found.length - 1)];
    if (!chosen) {
        return undefined;
    }
    const { sql, index, cte } = chosen;
    // A backtick-quoted name is selected quoted as it was written
    const name = sql[cte.start] === '`' ? sql.slice(cte.start, cte.nameEnd + 1) : cte.name;
    return { index, sql: `${sql.slice(cte.scopeStart, cte.end)}\nSELECT * FROM ${name} LIMIT ${limit}` };
}
