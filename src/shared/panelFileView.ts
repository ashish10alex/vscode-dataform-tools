import type { FileSlice, PanelAction } from './panelContract';

/*
 * What the compiled-query panel shows of a Dataform file, worked out from the `file` slice. The panel draws a
 * "model" for each action with SQL to show, and names an action's parts as the Dataform CLI does: `query`, `preOps`,
 * `postOps`. Drawing an action straight from its titled sections is for when the panel shows dbt too.
 */

/** An action as the panel draws it. A field that does not apply to the action's type is absent */
export interface FileModel {
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

/** The groups of actions, in the order the panel lists them */
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
        // Neither has SQL to show: declarations are listed apart, and a property graph has its own view
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

function legacyModel(action: PanelAction, group: Group, file: string): FileModel {
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
 * The slice's actions as the panel lists them: tables, views and incremental tables, then assertions,
 * operations, unit tests and notebooks. Each comes with the action it was made from.
 */
export function fileModels(slice: FileSlice): Array<{ model: FileModel; action: PanelAction }> {
    return GROUPS.flatMap((group) => slice.actions.filter((action) => groupOf(action) === group).map((action) => ({ model: legacyModel(action, group, slice.file), action })));
}

/** What the panel shows of the file */
export interface FileView {
    /** The actions with SQL to show, see `fileModels`. Empty when the file has none */
    models: FileModel[];
    /** What reads from the first model */
    dependents: Array<PanelAction['target']>;
    /** The types of the models, each once */
    actionTypes: string[];
    /** The file affects a compile and defines no action */
    isHelperFile: boolean;
    /** Set for a file that only declares tables made elsewhere */
    declarations: Array<{ target: PanelAction['target']; fileName: string }> | null;
    /** The SQL of each type of model as one script. The panel asks only whether there is any */
    tableOrViewQuery: string;
    assertionQuery: string;
    incrementalQuery: string;
    operationsQuery: string;
    testQuery: string;
    expectedOutputQuery: string;
}

/** The view of a file with nothing to show */
export const EMPTY_FILE_VIEW: FileView = {
    models: [], dependents: [], actionTypes: [], isHelperFile: false, declarations: null,
    tableOrViewQuery: '', assertionQuery: '', incrementalQuery: '', operationsQuery: '', testQuery: '', expectedOutputQuery: '',
};

/** The view of a `file` slice */
export function fileViewOf(slice: FileSlice): FileView {
    if (slice.role === 'helper' || slice.role === 'project settings') {
        return { ...EMPTY_FILE_VIEW, isHelperFile: slice.role === 'helper' };
    }
    const shown = fileModels(slice);
    if (shown.length === 0) {
        const declarations = slice.actions.filter((action) => action.kind === 'declaration');
        return declarations.length > 0 ? { ...EMPTY_FILE_VIEW, declarations: declarations.map((action) => ({ target: action.target, fileName: action.fileName })) } : EMPTY_FILE_VIEW;
    }

    const models = shown.map(({ model }) => model);
    const ofType = (...types: string[]) => models.filter((model) => types.includes(model.type));
    const tests = ofType('test');
    const testScript = (query: 'testQuery' | 'expectedOutputQuery') => tests
        .map((model, index) => (model[query] ? ` -- Test: [${index + 1}] ${model.name ?? ''} \n${model[query]}\n ;` : ''))
        .filter(Boolean)
        .join('\n');

    return {
        tableOrViewQuery: ofType('table', 'view').filter((model) => model.query).map((model) => `${model.query}\n;`).join('\n'),
        assertionQuery: ofType('assertion').map((model, index) => `\n -- Assertions: [${index + 1}] \n${model.query}; \n`).join(''),
        incrementalQuery: ofType('incremental').map((model) => model.incrementalQuery).join('\n'),
        operationsQuery: ofType('operations').map((model) => model.query).join(''),
        testQuery: testScript('testQuery'),
        expectedOutputQuery: testScript('expectedOutputQuery'),
        models,
        // Of the first model only, as the panel has always listed them
        dependents: models[0].target ? shown[0].action.dependents.map((dependent) => dependent.target) : [],
        actionTypes: [...new Set(models.map((model) => model.type))],
        isHelperFile: false,
        declarations: null,
    };
}
