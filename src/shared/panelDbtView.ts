import type { CompileError } from '../backend/backend';
import { namesMissingRef } from '../backend/dbt/place';
import type { DryRunResult } from '../bigquery/dryRunService';
import type { Kind, Target } from './compiledGraph';
import { isMadeUpTarget, isTestKind, kindHasTable, targetId } from './compiledGraph/graph';
import type { ActionReference, CompileStatus, FileSlice, PanelAction } from './panelContract';
import { PanelSlices, fileOnShow } from './panelState';

/*
 * What the compiled-query panel draws for a file of a dbt Project (decided in xf#52), worked out from the slices.
 * Which page, which tabs, which notices and which card are decided here, so that the components only draw, and so
 * that every state can be tested without a browser.
 */

export type DbtTab = 'compiled' | 'schema' | 'project';

/** The one line next to the file's name that says how the compile stands */
export type DbtStatusLine =
    /** Nothing is known yet: dbt is being looked for, or the first compile has not been asked for */
    | { kind: 'waiting'; text: string }
    /** A compile runs and there is nothing of this file to show meanwhile */
    | { kind: 'first compile'; text: string; startedAt: number; command?: string }
    /** A compile runs and the last result is on show, marked outdated */
    | { kind: 'recompiling'; text: string; startedAt: number; command?: string }
    | { kind: 'compiled'; compiledAt: number; durationMs?: number }
    | { kind: 'parsed'; compiledAt: number }
    | { kind: 'failed'; text: string };

/** A file with no SQL to show: what the thing is, and a few details */
export interface DbtCard {
    title: string;
    rows: Array<{ label: string; value: string }>;
    foot?: string;
}

export interface DbtView {
    /** `tool missing`: dbt was not found, and nothing else is drawn. `unsupported`: the dbt found is too old */
    page: 'panel' | 'tool missing' | 'unsupported';
    /** Where dbt was looked for, on the `tool missing` page */
    lookedIn: string[];
    /** What is wrong with the dbt found, on the `unsupported` page */
    unsupported?: string;
    /** The file the panel names, relative to the Project root. Empty before the host has named one */
    file: string;
    tabs: DbtTab[];
    status?: DbtStatusLine;
    /** The SQL on show is the last compile's, and another is running */
    outdated: boolean;
    /** Placeholder lines stand in for SQL that is being compiled */
    skeleton: boolean;
    /** The Project was only parsed because it has on-run hooks: the panel offers to compile with them */
    parsedOnly: boolean;
    /** The warehouse of a Project that is not a BigQuery one */
    otherWarehouse?: string;
    /** The file's errors, and those that name no file: each is drawn as a card */
    errors: CompileError[];
    /** Errors that name another file of the Project: one collapsed line at the bottom */
    errorsElsewhere: CompileError[];
    /** The actions drawn as sections, in order. Empty when a card is drawn instead */
    actions: PanelAction[];
    card?: DbtCard;
    /** The neighbours of the file's actions, each a link to its file. Unset when the file defines no action */
    lineage?: DbtLineage;
    /**
     * Run is offered: the file defines an action a run can execute, in a BigQuery Project. `targets` are those
     * actions; `blocked` while there is no fresh compile to run from, and says why.
     */
    run?: { targets: Target[]; blocked?: string };
}

/** A neighbour in the Data Lineage */
export interface LineageRow extends ActionReference {
    /** What dbt calls it */
    name: string;
    /** The installed package its file is in, when it is not the Project's own */
    package?: string;
    /** It builds a table at its Target, so a BigQuery link can be offered */
    buildsTable: boolean;
}

/** An action whose neighbours the Data Lineage lists */
export interface LineageSubject extends ActionReference {
    name: string;
    /** The open file defines it. False for the model that the file's test tests */
    own: boolean;
    dependencies: LineageRow[];
    /** What reads it, tests apart */
    dependents: LineageRow[];
    tests: LineageRow[];
}

export interface DbtLineage {
    /** One for each action of the file that is not a test, and one for each action a test of the file tests */
    subjects: LineageSubject[];
    /** Over all subjects, a neighbour of two of them counted once */
    counts: { dependencies: number; dependents: number; tests: number };
}

export function targetText(target: Target): string {
    return [target.database, target.schema, target.name].filter(Boolean).join('.');
}

const hasGraph = (status: CompileStatus | undefined): status is Extract<CompileStatus, { status: 'compiled' | 'parsed only' }> =>
    status?.status === 'compiled' || status?.status === 'parsed only';

const errorsOf = (status: CompileStatus | undefined): CompileError[] => (status && (hasGraph(status) || status.status === 'failed') ? status.errors : []);

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** dbt's words for a dbt target that its profile does not have, in either engine */
const UNKNOWN_TARGET = /target named|does not have a target|target ['"][^'"]+['"] (?:was )?not found/i;

/**
 * What the panel says under a compile error (xf#65): whether it is marked in the editor, and what the user can do
 * where the error is not about a file. On dbt-core it also says that there may be more errors than this one.
 */
export function dbtErrorFoot(error: CompileError, flavour: 'dbt-core' | 'dbt v2' | undefined): string {
    const notes: string[] = [];
    if (flavour === 'dbt-core') {
        notes.push('dbt-core stops at the first error, so there may be more.');
    }
    if (!error.fileName) {
        notes.push(UNKNOWN_TARGET.test(error.message) ? 'Not about a file. Change the dbt target in the control above.' : 'Not about a file.');
    } else if (error.line !== undefined) {
        notes.push('Also marked in the editor on that line.');
    } else if (namesMissingRef(error)) {
        notes.push('dbt reported no line. It is marked in the editor on the ref() it names, if that is in the file.');
    } else {
        notes.push('dbt reported no line, so nothing is marked in the editor.');
    }
    return notes.join(' ');
}

/** What BigQuery has said of an action's compiled query */
export interface DbtDryRun {
    /** The dry run is out */
    running: boolean;
    /** Unset until it is back, and for an action that is never dry-run */
    result?: DryRunResult;
}

/**
 * The dry run of the action's query, if it is of the SQL on show: a result of another compile than the `file`
 * slice's is not.
 */
export function dbtDryRunOf(slices: Pick<PanelSlices, 'bigquery' | 'file'>, action: Pick<PanelAction, 'id'>): DbtDryRun {
    const { bigquery, file } = slices;
    if (!bigquery || !file || bigquery.compile !== file.compile) {
        return { running: false };
    }
    const result = bigquery.results.find((candidate) => candidate.action === action.id && candidate.compile === file.compile);
    return { running: !result && bigquery.dryRunning.some((key) => key.action === action.id), ...(result ? { result } : {}) };
}

/**
 * Which case of an incremental model dbt compiled, as far as BigQuery can tell: the incremental one when the model's
 * table exists, the full build when it does not. Undefined when BigQuery has not said.
 */
export function incrementalCase(slices: Pick<PanelSlices, 'bigquery' | 'file'>, action: Pick<PanelAction, 'id'>): 'incremental' | 'full build' | undefined {
    const table = slices.bigquery && slices.file && slices.bigquery.compile === slices.file.compile ? slices.bigquery.tables[action.id] : undefined;
    if (!table) {
        return undefined;
    }
    return table.missing ? 'full build' : table.lastModified !== undefined ? 'incremental' : undefined;
}

/** What dbt calls the action: its name there when that differs from its Target's, e.g. a source's */
export function dbtNameOf(slices: Pick<PanelSlices, 'dbt'>, action: Pick<PanelAction, 'id' | 'target'>): string {
    return slices.dbt?.names[action.id] ?? action.target.name;
}

/** Where `dbt deps` installs packages (src/backend/dbt/graph.ts) */
const PACKAGE_FILE = /^dbt_packages\/([^/]+)\//;

/**
 * The Data Lineage of the file: the neighbours of each action it defines. A test's neighbours say little (it reads
 * the model it tests, and nothing reads it), so a test stands aside for the action it tests; a test that tests no
 * single action is listed for itself.
 */
export function lineageOf(slices: Pick<PanelSlices, 'dbt'>, file: FileSlice): DbtLineage | undefined {
    const subjects: PanelAction[] = [];
    for (const action of file.actions.filter((candidate) => candidate.fileName === file.file)) {
        const home = action.home && file.actions.find((candidate) => candidate.id === targetId(action.home!));
        const subject = isTestKind(action.kind) && home ? home : action;
        if (!subjects.includes(subject)) {
            subjects.push(subject);
        }
    }
    if (subjects.length === 0) {
        return undefined;
    }
    const bigQuery = slices.dbt?.bigQuery !== false;
    const among = new Set(subjects.map((subject) => subject.id));
    const rows = (neighbours: ActionReference[]): LineageRow[] => {
        const seen = new Set<string>();
        return neighbours.flatMap((neighbour) => {
            const id = targetId(neighbour.target);
            // A file's own actions are not each other's neighbours here
            if (seen.has(id) || (subjects.length > 1 && among.has(id))) {
                return [];
            }
            seen.add(id);
            const inPackage = PACKAGE_FILE.exec(neighbour.fileName)?.[1];
            return [{
                ...neighbour,
                name: dbtNameOf(slices, { id, target: neighbour.target }),
                ...(inPackage ? { package: inPackage } : {}),
                buildsTable: bigQuery && kindHasTable(neighbour.kind) && !isMadeUpTarget(neighbour.target),
            }];
        });
    };
    const listed = subjects.map((subject): LineageSubject => ({
        target: subject.target, kind: subject.kind, fileName: subject.fileName,
        name: dbtNameOf(slices, subject),
        own: subject.fileName === file.file,
        dependencies: rows(subject.dependencies),
        dependents: rows(subject.dependents.filter((dependent) => !isTestKind(dependent.kind))),
        tests: rows(subject.dependents.filter((dependent) => isTestKind(dependent.kind))),
    }));
    const count = (group: 'dependencies' | 'dependents' | 'tests') => new Set(listed.flatMap((subject) => subject[group].map((row) => targetId(row.target)))).size;
    return { subjects: listed, counts: { dependencies: count('dependencies'), dependents: count('dependents'), tests: count('tests') } };
}

/** The card of a file whose actions have no SQL: a seed, sources, exposures */
function cardOfActions(slices: Pick<PanelSlices, 'dbt'>, file: FileSlice): DbtCard {
    const kinds = [...new Set(file.actions.map((action) => action.kind))];
    const fileRow = { label: 'File', value: file.file };
    if (file.actions.length === 1 && kinds[0] === 'seed') {
        const [seed] = file.actions;
        return {
            title: `Seed: ${dbtNameOf(slices, seed)}`,
            rows: [
                { label: 'What it is', value: 'A CSV file dbt loads as a table' },
                fileRow,
                { label: 'Target', value: targetText(seed.target) },
            ],
            foot: 'No SQL, so no dry run, cost, schema or preview.',
        };
    }
    if (kinds.length === 1 && kinds[0] === 'source') {
        return {
            title: 'Sources defined in this file',
            rows: [...file.actions.map((source) => ({ label: dbtNameOf(slices, source), value: targetText(source.target) })), fileRow],
            foot: 'Sources are read, not built. Nothing to run.',
        };
    }
    if (kinds.length === 1 && kinds[0] === 'exposure') {
        return {
            title: file.actions.length === 1 ? `Exposure: ${dbtNameOf(slices, file.actions[0])}` : 'Exposures defined in this file',
            rows: [
                ...file.actions.map((exposure) => ({
                    label: file.actions.length === 1 ? 'Reads' : dbtNameOf(slices, exposure),
                    value: exposure.dependencies.map((dependency) => dependency.target.name).join(', ') || 'nothing',
                })),
                fileRow,
            ],
            foot: 'An exposure is something downstream of the Project, such as a dashboard. It builds nothing.',
        };
    }
    return {
        title: 'Defined in this file',
        rows: [
            ...file.actions.map((action) => ({ label: `${action.kind} ${dbtNameOf(slices, action)}`, value: action.buildsNothing ? 'builds nothing' : targetText(action.target) })),
            fileRow,
        ],
        foot: 'None of these has SQL to show.',
    };
}

/** In the order the panel lists them, with the words it uses */
const COUNTED: Array<[Kind[], string]> = [
    [['table', 'view', 'incremental', 'materialized view', 'ephemeral'], 'model'],
    [['seed'], 'seed'],
    [['snapshot'], 'snapshot'],
    [['test'], 'test'],
    [['unit test'], 'unit test'],
    [['source'], 'source'],
    [['exposure'], 'exposure'],
    [['analysis'], 'analysis'],
    [['operation'], 'on-run hook'],
];

function countsText(actions: Partial<Record<Kind, number>>): string {
    const parts: string[] = [];
    for (const [kinds, word] of COUNTED) {
        const count = kinds.reduce((sum, kind) => sum + (actions[kind] ?? 0), 0);
        if (count > 0) {
            parts.push(word === 'analysis' ? `${count} ${count === 1 ? 'analysis' : 'analyses'}` : plural(count, word));
        }
    }
    return parts.join(' · ') || 'none';
}

/** The card of a file that defines no action */
function cardOfRole(slices: Pick<PanelSlices, 'dbt'>, file: FileSlice): DbtCard {
    const fileRow = { label: 'File', value: file.file };
    const block = slices.dbt;
    if (file.role === 'project settings') {
        return {
            title: block?.project?.name ? `dbt Project: ${block.project.name}` : 'dbt Project',
            rows: [
                { label: 'What it is', value: "The Project's settings file" },
                fileRow,
                ...(block?.project?.profile ? [{ label: 'Profile', value: block.project.profile }] : []),
                ...(block?.project ? [{ label: 'Actions', value: countsText(block.project.actions) }] : []),
            ],
        };
    }
    const macros = block?.macros ?? [];
    if (macros.length > 0) {
        return {
            title: `Macros: ${macros.join(', ')}`,
            rows: [{ label: 'What it is', value: 'A file of Jinja macros' }, fileRow, { label: 'Defines', value: macros.join(', ') }],
            foot: 'Defines no action, so there is no SQL to show.',
        };
    }
    if (file.role === 'helper') {
        return {
            title: 'No action is defined in this file',
            rows: [{ label: 'What it is', value: 'A file dbt reads when it compiles the Project' }, fileRow],
            foot: 'A save of it compiles the Project again.',
        };
    }
    return {
        title: 'This file is not part of the compile',
        rows: [{ label: 'What it is', value: 'A file in the Project that dbt does not read' }, fileRow],
    };
}

/** What the panel draws for the dbt file on show */
export function dbtView(slices: Pick<PanelSlices, 'compile' | 'settled' | 'file' | 'dbt'>): DbtView {
    const { compile, settled, dbt: block } = slices;
    const named = fileOnShow(slices) ?? '';
    // The `file` slice may still be the last file's while the compile for this one runs
    const file = slices.file && slices.file.file === named ? slices.file : undefined;
    const compiling = compile?.status === 'compiling' ? compile : undefined;
    const last = compiling ? settled : compile;
    const graph = hasGraph(last);
    const view: DbtView = {
        page: 'panel', lookedIn: [], file: named, tabs: ['compiled', 'project'],
        outdated: false, skeleton: false, parsedOnly: false, errors: [], errorsElsewhere: [], actions: [],
    };

    if (!compiling && compile?.status === 'tool not found') {
        return { ...view, page: 'tool missing', lookedIn: compile.lookedIn, tabs: [] };
    }
    if (!compiling && compile?.status === 'version unsupported') {
        return { ...view, page: 'unsupported', unsupported: compile.message };
    }
    if (block && !block.bigQuery && block.warehouse) {
        view.otherWarehouse = block.warehouse;
    }

    const withSql = file?.actions.filter((action) => action.sections.length > 0) ?? [];
    const allErrors = errorsOf(last);
    // With no SQL of the file to show, an error anywhere is why: dbt-core stops at the first, whichever file it is in
    const own = allErrors.filter((error) => withSql.length === 0 || !error.fileName || error.fileName === named);
    view.errors = own;
    view.errorsElsewhere = allErrors.filter((error) => !own.includes(error));

    // A file is compiled when it is shown: until then its actions are in the graph without their SQL. A Project
    // parsed for its hooks stays as written, whatever is compiling
    const awaitsSql = last?.status !== 'parsed only' && withSql.some((action) => action.fileName === named && !action.sqlPresent);
    view.skeleton = !!compiling && (!file || !graph || awaitsSql);
    view.outdated = !!compiling && !view.skeleton;

    if (graph && file && !view.skeleton) {
        if (file.role === 'actions') {
            view.lineage = lineageOf(slices, file);
        }
        if (withSql.length > 0) {
            view.actions = file.actions;
        } else if (file.role === 'actions') {
            view.card = cardOfActions(slices, file);
        } else if (own.length === 0) {
            view.card = cardOfRole(slices, file);
        }
    }

    view.parsedOnly = last?.status === 'parsed only' && block?.hooksNotice !== false;
    const dryRun = withSql.some((action) => action.sections.some((section) => section.dryRun.length > 0));
    if (last?.status === 'compiled' && view.actions.length > 0 && dryRun && !view.otherWarehouse) {
        view.tabs = ['compiled', 'schema', 'project'];
    }

    const runnable = file?.actions.filter((action) => action.fileName === named && action.runnable) ?? [];
    if (graph && runnable.length > 0 && !view.otherWarehouse) {
        const blocked = compiling ? 'Wait for the compile to end'
            : last?.status === 'parsed only' || withSql.some((action) => action.fileName === named && !action.sqlPresent) ? 'The Project is not compiled'
            : view.errors.length > 0 ? 'The compile left errors'
            : undefined;
        view.run = { targets: runnable.map((action) => action.target), ...(blocked ? { blocked } : {}) };
    }

    if (compiling) {
        const running = { startedAt: compiling.startedAt, ...(compiling.command ? { command: compiling.command } : {}) };
        view.status = view.skeleton
            ? { kind: 'first compile', text: graph ? 'Compiling this file for the first time since the last save…' : 'Compiling the Project…', ...running }
            : { kind: 'recompiling', text: 'Recompiling… showing the previous result', ...running };
    } else if (last?.status === 'compiled') {
        if (view.errors.length > 0 && view.actions.length === 0) {
            view.status = { kind: 'failed', text: 'Compile failed' };
        } else if (withSql.length > 0 && withSql.every((action) => !action.sqlPresent)) {
            // dbt v2 stops at a parse when the Project has errors: the SQL on show is as written
            view.status = { kind: 'parsed', compiledAt: last.compiledAt };
        } else {
            view.status = { kind: 'compiled', compiledAt: last.compiledAt, ...(last.durationMs === undefined ? {} : { durationMs: last.durationMs }) };
        }
    } else if (last?.status === 'parsed only') {
        view.status = { kind: 'parsed', compiledAt: last.compiledAt };
    } else if (last?.status === 'failed' && last.errors.length > 0) {
        view.status = { kind: 'failed', text: 'Compile failed' };
    } else {
        view.status = { kind: 'waiting', text: block?.looking ? 'Looking for dbt…' : 'Waiting for the first compile…' };
    }
    return view;
}
