import type { Action } from './graph';
import { hasIncrementalVariant, sectionsFor } from './sql';

/*
 * What to dry-run for an action: what BigQuery would plan when its tool runs it. Which sections take part, and in
 * which script, is the Backend's choice, made when it builds them (`SqlSection.dryRun`).
 */

/** Places one section, or one statement, within a script */
export interface ScriptPart<Source> {
    /** What the part came from: a section's title in a `DryRunScript`, a statement's index from `joinScript` */
    source: Source;
    /**
     * `start` is where the part begins in the script. `origin` is where its untrimmed text would begin, so an offset
     * `o` in the script is `o - origin` in the text as given.
     */
    start: number;
    origin: number;
}

export interface DryRunScript {
    /** The script's name, as its sections give it in `SqlSection.dryRun`. Unique within a variant of its action */
    name: string;
    /** Whether the script is of the action's incremental variant, see `SqlSection.incremental` */
    incremental: boolean;
    sql: string;
    /** Where each section sits in `sql`, so an error's position can be given within its section */
    parts: ScriptPart<string>[];
}

/**
 * Joins statements into one BigQuery script, each ending in a semicolon, one per line; empty ones are left out. A
 * single statement is returned as it is, trimmed. Everything that dry-runs an action builds its text here, so the
 * same action always sends the same SQL.
 */
export function joinScript(statements: string[]): { sql: string; parts: ScriptPart<number>[] } {
    const kept = statements
        .map((statement, index) => ({ index, text: statement.trim(), lead: statement.length - statement.trimStart().length }))
        .filter((statement) => statement.text !== '');
    let sql = '';
    const parts: ScriptPart<number>[] = [];
    for (const [position, statement] of kept.entries()) {
        if (position > 0) {
            sql += '\n';
        }
        parts.push({ source: statement.index, start: sql.length, origin: sql.length - statement.lead });
        sql += statement.text;
        if (kept.length > 1 && !statement.text.endsWith(';')) {
            sql += ';';
        }
    }
    return { sql, parts };
}

/**
 * The scripts to dry-run for the action: for each name its sections give in `dryRun`, the sections that give it,
 * joined in order. An action with an incremental variant has the scripts of both variants. Empty when the action has
 * nothing to dry-run.
 */
export function dryRunScripts(action: Pick<Action, 'sections'>): DryRunScript[] {
    const scripts: DryRunScript[] = [];
    for (const incremental of hasIncrementalVariant(action) ? [false, true] : [false]) {
        const sections = sectionsFor(action, incremental);
        const names = new Set(sections.flatMap((section) => section.dryRun));
        for (const name of names) {
            const members = sections.filter((section) => section.dryRun.includes(name));
            const { sql, parts } = joinScript(members.map((section) => section.sql));
            if (sql !== '') {
                scripts.push({ name, incremental, sql, parts: parts.map((part) => ({ ...part, source: members[part.source].title })) });
            }
        }
    }
    return scripts;
}

/**
 * The title of the section a preview of the action shows, of the variant asked for: the one that ends the variant's
 * first dry-run script, which is the script whose rows are the action's. Undefined when the action has nothing to
 * dry-run, and for the incremental variant of an action that has none.
 */
export function previewSection(action: Pick<Action, 'sections'>, incremental = false): string | undefined {
    const script = dryRunScripts(action).find((candidate) => candidate.incremental === incremental);
    return script?.parts[script.parts.length - 1].source;
}

/** A place in a section's SQL. Lines and columns start at 1, as BigQuery counts them */
export interface SectionPosition {
    section: string;
    line: number;
    column: number;
}

/**
 * Where a position in a dry-run script falls in the SQL of the section it came from: BigQuery reports an error at a
 * line and column of the script it was sent, and the panel shows it in the section. Undefined when the position is
 * outside the script.
 */
export function positionInSection(action: Action, script: DryRunScript, line: number, column: number): SectionPosition | undefined {
    const lines = script.sql.split('\n');
    if (line < 1 || line > lines.length || column < 1) {
        return undefined;
    }
    const offset = lines.slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0) + column - 1;
    const part = script.parts.filter((candidate) => candidate.start <= offset).pop();
    const section = part && action.sections.find((candidate) => candidate.title === part.source);
    if (!part || !section) {
        return undefined;
    }
    // A position on the semicolon the script added falls just past the end of the section's own text
    const before = section.sql.slice(0, Math.min(offset - part.origin, section.sql.length)).split('\n');
    return { section: section.title, line: before.length, column: before[before.length - 1].length + 1 };
}
