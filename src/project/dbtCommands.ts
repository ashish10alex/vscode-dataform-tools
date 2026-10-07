import * as vscode from 'vscode';
import type { Action, CompiledGraph, RunOptions } from '../shared/compiledGraph';
import { actionsInFile, isRunnable, isTestKind, previewSection, siblingsOf } from '../shared/compiledGraph';
import { previewDbtAction } from './dbtBigQuery';
import { compileDbtProject } from './dbtCompile';
import { repeatDbtRun, runDbt } from './dbtRun';
import type { ProjectState } from './registry';

/*
 * The extension's commands in a dbt Project (xf#63): the sixteen that work for both Backends, as they act on dbt.
 * Each takes the file of a dbt Project it is for; the caller finds it (the editor in focus, else the file the panel
 * shows) and falls through to Dataform when there is none.
 */

/** A file of a dbt Project: what a command acts on */
export interface DbtFile {
    project: ProjectState;
    /** Relative to the Project root with forward slashes */
    file: string;
}

export interface RunScope {
    includeDependencies: boolean;
    includeDependents: boolean;
    fullRefresh: boolean;
}

/** The Project's graph, compiled first when there is none yet, or when `file`'s actions were not compiled */
async function graphFor({ project, file }: DbtFile, withSql = false): Promise<CompiledGraph | undefined> {
    if (!project.dbtBackend?.lastResult || withSql) {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'dbt: compiling' }, () => compileDbtProject(project, file, 'switch'));
    }
    const graph = project.dbtBackend?.lastResult?.graph;
    if (!graph) {
        vscode.window.showErrorMessage('The dbt project could not be compiled. Open the compiled query panel to see why.');
    }
    return graph;
}

/** The actions a run of the file executes: those it defines that a run can execute */
export function runnableInFile(graph: CompiledGraph, file: string): Action[] {
    return actionsInFile(graph, file).filter(isRunnable);
}

/** The tests attached to the actions the file defines: what "run assertions / tests in the current model" builds */
export function testsOfFile(graph: CompiledGraph, file: string): Action[] {
    const own = actionsInFile(graph, file);
    const tests: Action[] = [];
    for (const action of own.filter((candidate) => !isTestKind(candidate.kind))) {
        for (const sibling of siblingsOf(graph, action)) {
            if (isTestKind(sibling.kind) && isRunnable(sibling) && !tests.includes(sibling)) {
                tests.push(sibling);
            }
        }
    }
    return tests;
}

/** `dbt build` of the file's actions */
export async function dbtRunFile(target: DbtFile, scope: RunScope) {
    const graph = await graphFor(target);
    if (!graph) {
        return;
    }
    const actions = runnableInFile(graph, target.file);
    if (actions.length === 0) {
        vscode.window.showInformationMessage(`Nothing in ${target.file} can be run: a run builds models, seeds, snapshots and tests.`);
        return;
    }
    await runDbt(target.project, { actions: actions.map((action) => action.id), tags: [], ...scope });
}

/** `dbt build` of the tests attached to the model in the file, and of nothing else */
export async function dbtRunTestsOfFile(target: DbtFile) {
    const graph = await graphFor(target);
    if (!graph) {
        return;
    }
    const tests = testsOfFile(graph, target.file);
    if (tests.length === 0) {
        vscode.window.showInformationMessage(`No test is attached to a model in ${target.file}.`);
        return;
    }
    await runDbt(target.project, { actions: tests.map((test) => test.id), tags: [], includeDependencies: false, includeDependents: false, fullRefresh: false });
}

function tagsOf(graph: CompiledGraph): string[] {
    return [...new Set(Object.values(graph.actions).flatMap((action) => action.tags))].sort();
}

/** `dbt build --select tag:<name>` of a tag the user picks */
export async function dbtRunTag(target: DbtFile, scope: RunScope) {
    const graph = await graphFor(target);
    if (!graph) {
        return;
    }
    const tags = tagsOf(graph);
    if (tags.length === 0) {
        vscode.window.showInformationMessage('The dbt project has no tags.');
        return;
    }
    const tag = await vscode.window.showQuickPick(tags, { placeHolder: 'Select a tag to run' });
    if (tag) {
        await runDbt(target.project, { actions: [], tags: [tag], ...scope });
    }
}

/**
 * The picker of "Run file(s) / tag(s) with options" for dbt: what to run, how far the run reaches, and whether it
 * is a full refresh. As Dataform's, without the choice of CLI or API.
 */
export async function dbtRunWithOptions(target: DbtFile) {
    const graph = await graphFor(target);
    if (!graph) {
        return;
    }
    const what = await vscode.window.showQuickPick(['run current file', 'run a tag', 'run multiple files', 'run multiple tags'], { placeHolder: 'Select an option' });
    if (!what) {
        return;
    }
    let selection: Pick<RunOptions, 'actions' | 'tags'> | undefined;
    if (what === 'run current file') {
        const actions = runnableInFile(graph, target.file);
        if (actions.length === 0) {
            vscode.window.showInformationMessage(`Nothing in ${target.file} can be run: a run builds models, seeds, snapshots and tests.`);
            return;
        }
        selection = { actions: actions.map((action) => action.id), tags: [] };
    } else if (what === 'run a tag') {
        const tag = await vscode.window.showQuickPick(tagsOf(graph), { placeHolder: 'Select a tag' });
        selection = tag ? { actions: [], tags: [tag] } : undefined;
    } else if (what === 'run multiple tags') {
        const tags = await vscode.window.showQuickPick(tagsOf(graph), { placeHolder: 'Select tags', canPickMany: true });
        selection = tags?.length ? { actions: [], tags } : undefined;
    } else {
        const files = [...new Set(Object.values(graph.actions).filter((action) => isRunnable(action) && action.fileName).map((action) => action.fileName))].sort();
        const picked = await vscode.window.showQuickPick(files, { placeHolder: 'Select files', canPickMany: true });
        const actions = (picked ?? []).flatMap((file) => runnableInFile(graph, file));
        selection = actions.length ? { actions: actions.map((action) => action.id), tags: [] } : undefined;
    }
    if (!selection) {
        return;
    }
    const reach = await vscode.window.showQuickPick(['default', 'include dependents', 'include dependencies'], { placeHolder: 'select run type' });
    if (!reach) {
        return;
    }
    const refresh = await vscode.window.showQuickPick(['no', 'yes'], { placeHolder: 'full refresh' });
    if (!refresh) {
        return;
    }
    await runDbt(target.project, { ...selection, includeDependencies: reach === 'include dependencies', includeDependents: reach === 'include dependents', fullRefresh: refresh === 'yes' });
}

/** Sends the Project's last run to the terminal again */
export async function dbtRerun(target: DbtFile) {
    await repeatDbtRun(target.project);
}

/** Runs the compiled query of the file's first action that has one, and shows its rows */
export async function dbtPreviewFile(target: DbtFile) {
    const graph = await graphFor(target, true);
    if (!graph) {
        return;
    }
    for (const action of actionsInFile(graph, target.file)) {
        const section = action.sqlPresent ? previewSection(action) : undefined;
        if (section) {
            await previewDbtAction(graph, action.target, section);
            return;
        }
    }
    vscode.window.showInformationMessage(`${target.file} has no compiled query to preview.`);
}
