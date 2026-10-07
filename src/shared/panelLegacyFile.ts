import type { FileSlice, PanelAction } from './panelContract';

/*
 * The `file` slice as the flat fields the panel's components still read (see panelLegacyState.ts). The flat state is
 * Dataform's: it names an action's parts as the Dataform CLI does and calls an action a model. It goes with the rest
 * of the adapter, when the components read actions and SQL sections themselves.
 */

/** The flat fields that arrive only through the `file` slice */
export const MIGRATED_FILE_FIELDS = [
    'tableOrViewQuery', 'assertionQuery', 'preOperations', 'postOperations', 'incrementalPreOpsQuery', 'incrementalQuery',
    'nonIncrementalQuery', 'operationsQuery', 'testQuery', 'expectedOutputQuery', 'models', 'targetTablesOrViews',
    'dependents', 'modelType', 'actionTypes', 'isHelperFile', 'declarations',
] as const;

/** An action as the flat state has it. A field that does not apply to the action's type is absent */
export interface LegacyModel {
    type: string;
    /** A unit test has a name and no target */
    name?: string;
    target?: PanelAction['target'];
    fileName: string;
    tags?: string[];
    query?: string;
    preOps?: string[];
    postOps?: string[];
    incrementalQuery?: string;
    incrementalPreOps?: string[];
    testQuery?: string;
    expectedOutputQuery?: string;
    hasOutput?: boolean;
    dependencyTargets?: Array<PanelAction['target']>;
    actionDescriptor?: { description?: string; columns?: PanelAction['columns'] };
}

/** The flat state's groups of actions, in the order it lists them */
const GROUPS = ['table', 'assertion', 'operations', 'test', 'notebook'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(action: PanelAction): Group | undefined {
    switch (action.kind) {
        case 'assertion':
            return 'assertion';
        case 'operation':
            return 'operations';
        case 'unit test':
            return 'test';
        case 'notebook':
            return 'notebook';
        // Neither has SQL to show: the flat state lists declarations apart and property graphs not at all
        case 'declaration':
        case 'property graph':
            return undefined;
        default:
            return 'table';
    }
}

/** The SQL of the sections with the title, which is numbered when there are several: "pre_operations 1/2" */
function sqlOf(action: PanelAction, title: string): string[] {
    return action.sections.filter((section) => section.title === title || section.title.startsWith(`${title} `)).map((section) => section.sql);
}

const unlessEmpty = <T>(items: T[]): T[] | undefined => (items.length > 0 ? items : undefined);

function legacyModel(action: PanelAction, group: Group, file: string): LegacyModel {
    if (group === 'test') {
        return { type: 'test', name: action.target.name, fileName: file, testQuery: sqlOf(action, 'test query')[0], expectedOutputQuery: sqlOf(action, 'expected output')[0] };
    }
    const common = { tags: unlessEmpty(action.tags), target: action.target, dependencyTargets: unlessEmpty(action.dependencies.map((dependency) => dependency.target)) };
    if (group === 'notebook') {
        // A notebook is shown as a pointer to its file, not as its contents
        return { type: 'notebook', ...common, fileName: action.fileName, query: `Open: ${action.fileName} \n` };
    }
    if (group === 'operations') {
        const query = sqlOf(action, 'operation').map((sql, index) => `\n -- Operations: [${index + 1}] \n${sql}\n`).join('');
        return { type: 'operations', ...common, fileName: file, hasOutput: action.buildsTable || undefined, query, incrementalQuery: '', incrementalPreOps: [] };
    }
    if (group === 'assertion') {
        return { type: 'assertion', ...common, fileName: file, query: sqlOf(action, 'query')[0] ?? '', incrementalQuery: '', incrementalPreOps: [] };
    }
    const described = action.description !== undefined || action.columns !== undefined;
    return {
        type: action.kind,
        ...common,
        fileName: file,
        query: sqlOf(action, 'query')[0] ?? '',
        preOps: unlessEmpty(sqlOf(action, 'pre_operations')),
        postOps: unlessEmpty(sqlOf(action, 'post_operations')),
        incrementalQuery: sqlOf(action, 'incremental query')[0] ?? '',
        incrementalPreOps: sqlOf(action, 'incremental pre_operations'),
        actionDescriptor: described ? { description: action.description, columns: action.columns } : undefined,
    };
}

/**
 * The slice's actions as the flat state lists them: tables, views and incremental tables, then assertions,
 * operations, unit tests and notebooks. Each comes with the action it was made from.
 */
export function legacyModels(slice: FileSlice): Array<{ model: LegacyModel; action: PanelAction }> {
    return GROUPS.flatMap((group) => slice.actions.filter((action) => groupOf(action) === group).map((action) => ({ model: legacyModel(action, group, slice.file), action })));
}

/** Operations of several statements as one script: each list ends in a new line, and the script in a semicolon */
function operationsScript(lists: Array<string[] | undefined>): string {
    let script = '';
    for (const list of lists) {
        if (list?.length) {
            script += (script ? '\n' : '') + list.join('\n') + '\n';
        }
    }
    return script === '' || /;\s*$/.test(script) ? script : `${script.trimEnd()};\n`;
}

const NO_QUERIES = {
    tableOrViewQuery: null, assertionQuery: null, preOperations: null, postOperations: null, incrementalPreOpsQuery: null,
    incrementalQuery: null, nonIncrementalQuery: null, operationsQuery: null,
};

/** The flat fields of a `file` slice. A file with nothing to show clears the fields the flat state always cleared for it */
export function legacyStateFromFileSlice(slice: FileSlice): Record<string, unknown> {
    if (slice.role === 'helper' || slice.role === 'project settings') {
        return { isHelperFile: slice.role === 'helper', declarations: null, ...NO_QUERIES };
    }
    const shown = legacyModels(slice);
    if (shown.length === 0) {
        const declarations = slice.actions.filter((action) => action.kind === 'declaration');
        if (declarations.length > 0) {
            return { isHelperFile: false, declarations: declarations.map((action) => ({ target: action.target, fileName: action.fileName })) };
        }
        return { isHelperFile: false, declarations: null, models: null, ...NO_QUERIES, testQuery: null, expectedOutputQuery: null };
    }

    const models = shown.map(({ model }) => model);
    const ofType = (...types: string[]) => models.filter((model) => types.includes(model.type));
    const tables = ofType('table', 'view', 'incremental');
    const incrementals = ofType('incremental');
    const tests = ofType('test');
    const testScript = (query: 'testQuery' | 'expectedOutputQuery') => tests
        .map((model, index) => (model[query] ? ` -- Test: [${index + 1}] ${model.name ?? ''} \n${model[query]}\n ;` : ''))
        .filter(Boolean)
        .join('\n');

    const isJs = slice.file.endsWith('.js');
    let modelType = models[0].type;
    if (ofType('notebook').length > 0) {
        modelType = 'notebook';
    } else if (isJs && tests.length < models.length) {
        modelType = 'js';
    }

    return {
        tableOrViewQuery: ofType('table', 'view').filter((model) => model.query).map((model) => `${model.query}\n;`).join('\n'),
        assertionQuery: ofType('assertion').map((model, index) => `\n -- Assertions: [${index + 1}] \n${model.query}; \n`).join(''),
        preOperations: operationsScript(tables.map((model) => model.preOps)),
        postOperations: operationsScript(tables.map((model) => model.postOps)),
        incrementalPreOpsQuery: operationsScript(incrementals.map((model) => model.incrementalPreOps)),
        incrementalQuery: incrementals.map((model) => model.incrementalQuery).join('\n'),
        nonIncrementalQuery: incrementals.map((model) => model.query).join('\n'),
        operationsQuery: ofType('operations').map((model) => model.query).join(''),
        testQuery: testScript('testQuery'),
        expectedOutputQuery: testScript('expectedOutputQuery'),
        models,
        targetTablesOrViews: models,
        // Of the first action only, as the flat state has always had it
        dependents: models[0].target ? shown[0].action.dependents.map((dependent) => dependent.target) : undefined,
        modelType,
        actionTypes: [...new Set(models.map((model) => model.type))],
        isHelperFile: false,
        declarations: null,
    };
}
