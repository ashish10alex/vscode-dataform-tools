import { parseCompilationStack } from '../../parseCompilationStack';
import { Action, CompiledGraph, Kind, SqlSection, Target, buildCompiledGraph, madeUpTarget, slashPath, targetId, titledSections } from '../../shared/compiledGraph';
import type { DataformCompiledJson } from '../../types';
import type { CompileError } from '../backend';

/*
 * Builds the Compiled Graph of a Dataform Project from what `dataform compile --json` or the Dataform API returned.
 * A port of xf's `internal/backend/dataform/graph.go`, plus the unit tests, which xf leaves out.
 */

/**
 * The fields of a compiled action that the graph is built from. One shape covers every array of the compile result:
 * a field that does not apply to a Kind is absent.
 */
interface RawAction {
    type?: string;
    target: Target;
    fileName?: string;
    tags?: string[];
    disabled?: boolean;
    query?: string;
    incrementalQuery?: string;
    preOps?: string[];
    postOps?: string[];
    incrementalPreOps?: string[];
    incrementalPostOps?: string[];
    queries?: string[];
    hasOutput?: boolean;
    dependencyTargets?: Target[];
    parentAction?: Target;
    notebookContents?: string;
    graphBody?: string;
    actionDescriptor?: { description?: string; columns?: Array<{ path: string[]; description?: string }> };
}

/*
 * The dry-run scripts of a table, as the extension has always had them: its query after its pre-operations, which is
 * what its cost and schema come from, and its post-operations after its pre-operations, which is only looked at for
 * errors. What the pre-operations declare resolves in both.
 */
const QUERY = { compiled: true, dryRun: ['query'] };
const PRE_OPERATIONS = { compiled: true, dryRun: ['query', 'post_operations'] };
const POST_OPERATIONS = { compiled: true, dryRun: ['post_operations'] };
const SHOWN = { compiled: true, dryRun: [] };

function tableKind(raw: RawAction): Kind {
    return raw.type === 'view' || raw.type === 'incremental' ? raw.type : 'table';
}

function tableSections(raw: RawAction, kind: Kind): SqlSection[] {
    const hasText = (statements: string[] | undefined) => (statements ?? []).some((statement) => statement?.trim());
    // The pre-operations join the post-operations' script only when there are post-operations to dry-run
    const variant = (prefix: string, preOps: string[] | undefined, query: string | undefined, postOps: string[] | undefined, flags: { incremental?: boolean }) => [
        ...titledSections(`${prefix}pre_operations`, preOps ?? [], { ...(hasText(postOps) ? PRE_OPERATIONS : QUERY), ...flags }),
        ...titledSections(`${prefix}query`, [query], { ...QUERY, ...flags }),
        ...titledSections(`${prefix}post_operations`, postOps ?? [], { ...POST_OPERATIONS, ...flags }),
    ];
    const sections = variant('', raw.preOps, raw.query, raw.postOps, {});
    // An incremental table has a second variant, for the run that updates the table once it exists
    if (kind === 'incremental' && (raw.incrementalQuery || raw.incrementalPreOps?.length)) {
        const postOps = raw.incrementalPostOps?.length ? raw.incrementalPostOps : raw.postOps;
        sections.push(...variant('incremental ', raw.incrementalPreOps, raw.incrementalQuery, postOps, { incremental: true }));
    }
    return sections;
}

function sectionsOf(raw: RawAction, kind: Kind): SqlSection[] {
    switch (kind) {
        case 'operation':
            return titledSections('operation', raw.queries ?? [], { compiled: true, dryRun: ['operation'] });
        case 'assertion':
            return titledSections('query', [raw.query], QUERY);
        case 'notebook':
            return titledSections('notebook', [raw.notebookContents], SHOWN);
        case 'property graph':
            return titledSections('property graph', [raw.graphBody], SHOWN);
        case 'declaration':
            return [];
        default:
            return tableSections(raw, kind);
    }
}

function toAction(raw: RawAction, kind: Kind): Action {
    const target: Target = { database: raw.target.database ?? '', schema: raw.target.schema, name: raw.target.name };
    const action: Action = {
        id: targetId(target),
        target,
        kind,
        fileName: slashPath(raw.fileName ?? ''),
        tags: raw.tags ?? [],
        sections: sectionsOf(raw, kind),
        sqlPresent: true,
        dependencyTargets: raw.dependencyTargets ?? [],
    };
    if (raw.disabled) {
        action.disabled = true;
    }
    if (raw.hasOutput) {
        action.hasOutput = true;
    }
    if (raw.actionDescriptor?.description) {
        action.description = raw.actionDescriptor.description;
    }
    if (raw.actionDescriptor?.columns?.length) {
        action.columns = raw.actionDescriptor.columns.map((column) => ({ path: column.path, description: column.description ?? '' }));
    }
    if (raw.parentAction) {
        action.parent = raw.parentAction;
    }
    return action;
}

/**
 * A unit test builds nothing, so its Target is made up from its name. Its two queries never run as one script: each
 * is a dry-run script of its own. `dataform run` cannot run it; `dataform test` does.
 */
function unitTest(test: DataformCompiledJson['tests'][number]): Action {
    const target = madeUpTarget('unit test', test.name);
    return {
        id: targetId(target),
        target,
        kind: 'unit test',
        fileName: slashPath(test.fileName ?? ''),
        tags: [],
        sections: [
            ...titledSections('test query', [test.testQuery], { compiled: true, dryRun: ['test query'] }),
            ...titledSections('expected output', [test.expectedOutputQuery], { compiled: true, dryRun: ['expected output'] }),
        ],
        sqlPresent: true,
        dependencyTargets: [],
        noRun: true,
    };
}

/** The Compiled Graph of a compile result */
export function buildDataformGraph(compiled: DataformCompiledJson): CompiledGraph {
    const actions: Action[] = [];
    const add = (items: readonly unknown[] | undefined, kind: Kind | ((raw: RawAction) => Kind)) => {
        for (const item of (items ?? []) as RawAction[]) {
            actions.push(toAction(item, typeof kind === 'function' ? kind(item) : kind));
        }
    };
    add(compiled.tables, tableKind);
    add(compiled.operations, 'operation');
    add(compiled.assertions, 'assertion');
    add(compiled.notebooks, 'notebook');
    add(compiled.propertyGraphs, 'property graph');
    add(compiled.declarations, 'declaration');
    actions.push(...(compiled.tests ?? []).map(unitTest));
    return buildCompiledGraph(actions);
}

/** A compile error as Dataform reports it: in a compile result's `graphErrors`, or when the compile gave no result */
export interface RawCompileError {
    message: string;
    fileName?: string;
    /** The JavaScript stack. A syntax error's starts with the failing file and line */
    stack?: string;
}

export function toCompileError(raw: RawCompileError): CompileError {
    const error: CompileError = { message: raw.message };
    if (raw.fileName) {
        error.fileName = slashPath(raw.fileName);
    }
    const line = parseCompilationStack(raw.stack).lineNumber;
    if (line !== undefined) {
        error.line = line;
    }
    return error;
}
