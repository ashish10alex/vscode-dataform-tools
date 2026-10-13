import { Action, hasIncrementalVariant } from '../shared/compiledGraph';
import type { SqlxBlockMetadata } from '../types';
import type { DryRunResult } from './dryRunService';

/*
 * Where the dry-run errors of a `.sqlx` file are marked in the file. A result places its error within a section of
 * the compiled SQL; this finds the block of the file that section came from. No `vscode` import.
 */

/** A marker in the source file. `line` and `column` start at 0, as an editor position does */
export interface SourceDiagnostic {
    line: number;
    column: number;
    message: string;
}

/** A pre-operation that only declares a temporary function fails a dry run on its own terms, not the user's */
const IGNORED_IN_PRE_OPERATIONS = ['CREATE TEMPORARY FUNCTION statements must be followed by an actual query.'];

const isPreOperations = (section: string | undefined) => section !== undefined && /^(incremental )?pre_operations/.test(section);
const isPostOperations = (section: string | undefined) => section !== undefined && /^(incremental )?post_operations/.test(section);
/** The sections written in the file's SQL block from its first line: a query, or an operation's first statement */
const startsSqlBlock = (section: string) => /^(incremental )?query$/.test(section) || /^operation( 1\/\d+)?$/.test(section);

/**
 * The markers for the dry-run errors of a `.sqlx` file.
 *
 * - An error in the query is marked on its own line and column of the SQL block. A section's first line is the SQL
 *   block's first line, and the lines after it correspond one for one, so no offset is involved. For an incremental
 *   table it is the incremental query's error that is marked.
 * - An error in the pre-operations or the post-operations is marked at the start of the first such block, named as
 *   such.
 * - An error in the first failing assertion of the file is marked at the top of the file, named as such.
 *
 * @param fileActions The actions the file defines, in display order
 * @param results Their dry-run results
 */
export function sqlxDiagnostics(fileActions: Action[], results: DryRunResult[], blocks: SqlxBlockMetadata): SourceDiagnostic[] {
    const diagnostics: SourceDiagnostic[] = [];
    const add = (line: number, column: number, message: string) => {
        if (!diagnostics.some((existing) => existing.line === line && existing.column === column && existing.message === message)) {
            diagnostics.push({ line: Math.max(0, line), column: Math.max(0, column), message });
        }
    };
    const failed = (action: Action) => results.filter((result) => result.action === action.id && result.error);

    // The action the file is about: its table, view, operation or assertion, not what is generated from that
    const main = fileActions.find((action) => !action.parent && action.kind !== 'unit test');
    if (main) {
        const incremental = hasIncrementalVariant(main);
        const sqlStart = Math.max(0, blocks.sqlBlock.startLine - 1);
        for (const result of failed(main)) {
            const { message, section, line, column } = result.error!;
            if (isPreOperations(section)) {
                if (!IGNORED_IN_PRE_OPERATIONS.some((ignored) => message.includes(ignored))) {
                    add((blocks.preOpsBlock.preOpsList[0]?.startLine ?? 1) - 1, 0, `(Pre-Ops): ${message}`);
                }
            } else if (isPostOperations(section) || (section === undefined && result.script === 'post_operations')) {
                add((blocks.postOpsBlock.postOpsList[0]?.startLine ?? 1) - 1, 0, `(Post-Ops): ${message}`);
            } else if (result.incremental === incremental) {
                const placed = section !== undefined && line !== undefined && column !== undefined && startsSqlBlock(section);
                add(placed ? sqlStart + line - 1 : sqlStart, placed ? column - 1 : 0, message);
            }
        }
    }

    const assertion = fileActions.find((action) => action.kind === 'assertion' && failed(action).length > 0);
    if (assertion) {
        add(0, 0, `(Assertion): ${failed(assertion)[0].error!.message}`);
    }
    return diagnostics;
}
