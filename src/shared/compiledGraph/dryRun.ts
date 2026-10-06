import type { Action } from './graph';
import { hasIncrementalVariant, sectionsFor } from './sql';

/*
 * What to dry-run for an action: what BigQuery would plan when its tool runs it. Which sections take part is the
 * Backend's choice, made when it builds them (`SqlSection.dryRun`).
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
    /** Tells the two variants of an incremental table apart; empty for every other action */
    label: '' | 'full' | 'incremental';
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
 * The scripts to dry-run for the action: one made of its sections marked `dryRun`, in order, or one for each
 * variant of an action that has an incremental one. Empty when it has nothing to dry-run.
 */
export function dryRunScripts(action: Action): DryRunScript[] {
    const scripts: DryRunScript[] = [];
    const add = (label: DryRunScript['label'], incremental: boolean) => {
        const sections = sectionsFor(action, incremental).filter((section) => section.dryRun);
        const { sql, parts } = joinScript(sections.map((section) => section.sql));
        if (sql !== '') {
            scripts.push({ label, sql, parts: parts.map((part) => ({ ...part, source: sections[part.source].title })) });
        }
    };
    if (hasIncrementalVariant(action)) {
        add('full', false);
        add('incremental', true);
    } else {
        add('', false);
    }
    return scripts;
}
