import * as vscode from 'vscode';
import type { Action, CompiledGraph, RunOptions } from '../shared/compiledGraph';
import { actionsInFile, isRunnable, isTestKind, previewSection, siblingsOf } from '../shared/compiledGraph';
import { previewDbtAction } from './dbtBigQuery';
import { compileDbtProject } from './dbtCompile';
import { describeComparison } from '../shared/changeComparison';
import { noChangesMessage } from '../changedActions';
import { DbtChangesResult, listDbtChangedActions, repeatLastDbtRun, runDbtChangedActions } from './dbtChanges';
import { runDbt } from './dbtRun';
import type { ProjectState } from './registry';

/*
 * The extension's commands in a dbt Project (xf#63): the seventeen that work for both Backends, as they act on dbt. The
 * eighteenth, the dependency graph, is drawn by ../views/depedancyGraphPanel.ts.
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
    await repeatLastDbtRun(target.project);
}

type ChangedRunItem = vscode.QuickPickItem & { scope?: Pick<RunScope, 'includeDependencies' | 'includeDependents'> };

/**
 * Asks how far a run of what changed reaches, in a picker that also lists what changed, as Dataform's does. The rows
 * of actions are only to read: accepting one keeps the picker open.
 */
function pickChangedRun(result: DbtChangesResult): Promise<ChangedRunItem['scope']> {
    const count = result.changed.length;
    const items: ChangedRunItem[] = [
        { label: '$(play) Run', description: `${count} changed action${count === 1 ? '' : 's'}`, scope: { includeDependencies: false, includeDependents: false } },
        { label: '$(play) Run with dependents', scope: { includeDependencies: false, includeDependents: true } },
        { label: '$(play) Run with dependencies', scope: { includeDependencies: true, includeDependents: false } },
    ];
    let file: string | undefined;
    for (const action of result.changed) {
        if (action.fileName !== file) {
            file = action.fileName;
            items.push({ label: action.fileName, kind: vscode.QuickPickItemKind.Separator });
        }
        items.push({ label: action.target.name, description: `${action.kind} · ${action.reasons.join(', ')}` });
    }
    for (const action of result.deleted) {
        items.push({ label: `$(trash) ${action.target.name}`, description: 'removed on this branch, not run' });
    }
    const picker = vscode.window.createQuickPick<ChangedRunItem>();
    picker.title = `Changed actions ${describeComparison(result.headRef, result.baseRef)} @ ${result.mergeBaseSha.slice(0, 7)} (${result.headLabel})`;
    picker.placeholder = 'Select run type';
    picker.items = items;
    picker.matchOnDescription = true;
    return new Promise((resolve) => {
        let accepted: ChangedRunItem['scope'];
        picker.onDidAccept(() => {
            const scope = picker.selectedItems[0]?.scope;
            if (scope) {
                accepted = scope;
                picker.hide();
            }
        });
        picker.onDidHide(() => {
            picker.dispose();
            resolve(accepted);
        });
        picker.show();
    });
}

/**
 * "Run changed actions" for dbt: asks dbt what changed since the merge-base with the default branch, shows it, and
 * sends `dbt build --select state:modified` to the terminal. With `scope`, from a keybinding's arguments, nothing
 * is asked.
 */
export async function dbtRunChanged(target: DbtFile, scope?: Partial<RunScope>) {
    let result: DbtChangesResult | undefined;
    try {
        result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Working out changed actions…' }, () => listDbtChangedActions(target.project));
    } catch (error) {
        vscode.window.showErrorMessage(`Could not work out changed actions: ${error instanceof Error ? error.message : String(error)}`);
        return;
    }
    if (!result) {
        return;
    }
    if (result.changed.length === 0) {
        vscode.window.showInformationMessage(noChangesMessage(result));
        return;
    }
    if (scope && (scope.includeDependencies !== undefined || scope.includeDependents !== undefined || scope.fullRefresh !== undefined)) {
        await runDbtChangedActions(target.project, { includeDependencies: !!scope.includeDependencies, includeDependents: !!scope.includeDependents, fullRefresh: !!scope.fullRefresh }, result);
        return;
    }
    const reach = await pickChangedRun(result);
    if (!reach) {
        return;
    }
    const refresh = await vscode.window.showQuickPick(['no', 'yes'], { placeHolder: 'full refresh' });
    if (!refresh) {
        return;
    }
    await runDbtChangedActions(target.project, { ...reach, fullRefresh: refresh === 'yes' }, result);
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
