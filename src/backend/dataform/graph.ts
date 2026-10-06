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

// A statement that runs before the query, so that what it declares resolves, is dry-run with it
const DRY_RUN = { compiled: true, dryRun: true };
// Shown, never dry-run: post-operations are left out of the cost, as the extension has always left them out
const SHOWN = { compiled: true, dryRun: false };

function tableKind(raw: RawAction): Kind {
    return raw.type === 'view' || raw.type === 'incremental' ? raw.type : 'table';
}

function tableSections(raw: RawAction, kind: Kind): SqlSection[] {
    const sections = [
        ...titledSections('pre_operations', raw.preOps ?? [], DRY_RUN),
        ...titledSections('query', [raw.query], DRY_RUN),
        ...titledSections('post_operations', raw.postOps ?? [], SHOWN),
    ];
    // An incremental table has a second variant, for the run that updates the table once it exists
    if (kind === 'incremental' && (raw.incrementalQuery || raw.incrementalPreOps?.length)) {
        const postOps = raw.incrementalPostOps?.length ? raw.incrementalPostOps : raw.postOps ?? [];
        sections.push(
            ...titledSections('incremental pre_operations', raw.incrementalPreOps ?? [], { ...DRY_RUN, incremental: true }),
            ...titledSections('incremental query', [raw.incrementalQuery], { ...DRY_RUN, incremental: true }),
            ...titledSections('incremental post_operations', postOps, { ...SHOWN, incremental: true }),
        );
    }
    return sections;
}

function sectionsOf(raw: RawAction, kind: Kind): SqlSection[] {
    switch (kind) {
        case 'operation':
            return titledSections('operation', raw.queries ?? [], DRY_RUN);
        case 'assertion':
            return titledSections('query', [raw.query], DRY_RUN);
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
 * is dry-run alone. `dataform run` cannot run it; `dataform test` does.
 */
function unitTest(test: DataformCompiledJson['tests'][number]): Action {
    const target = madeUpTarget('unit test', test.name);
    const alone = { ...DRY_RUN, dryRunAlone: true };
    return {
        id: targetId(target),
        target,
        kind: 'unit test',
        fileName: slashPath(test.fileName ?? ''),
        tags: [],
        sections: [...titledSections('test query', [test.testQuery], alone), ...titledSections('expected output', [test.expectedOutputQuery], alone)],
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
