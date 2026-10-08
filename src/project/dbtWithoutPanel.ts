import path from 'path';
import * as vscode from 'vscode';
import { logger } from '../logger';
import { fileSlice } from '../panel/slices';
import { slashPath } from '../shared/compiledGraph';
import { dbtActionsToDryRun, dbtCanAskBigQuery, dryRunDbtActions } from './dbtBigQuery';
import { compileDbtProject, dbtCompilePending, dbtCompileState } from './dbtCompile';
import { onDidChangeDbtTool } from './dbtTool';
import { fileBackendHints, projects } from './index';
import type { ProjectState } from './registry';

/*
 * What a dbt Project is given while the compiled query panel is closed (Step 7 of the build plan). The editor
 * features read the Project's latest graph, and a Project used to be read first when the panel opened. So a Project
 * is parsed when one of its files is first shown in an editor (piece 7.2): parsed, never compiled, by either engine,
 * through the Project's one compile loop, in which the latest request wins. Nothing here waits for the parse, and no
 * feature starts dbt itself.
 *
 * A save compiles the file on show and dry-runs its model and the tests of it, as the open panel does and through
 * the same code (piece 7.9), so that the dry-run errors are marked in the editor. The `dbtDryRunOnSave` setting turns
 * that off: a save then only parses the Project again.
 */

/** A file of a dbt Project */
export interface DbtFileOfProject {
    project: ProjectState;
    /** Relative to the Project root with forward slashes */
    file: string;
}

/** The dbt Project a document is of, and its file in it. Undefined for a document of no dbt Project */
export function dbtFileOfDocument(document: vscode.TextDocument | undefined): DbtFileOfProject | undefined {
    if (!document || document.uri.scheme !== 'file') {
        return undefined;
    }
    const found = projects.forFile(document.uri.fsPath, fileBackendHints(document.uri.fsPath));
    if (found.kind !== 'project' || found.project.backend !== 'dbt') {
        return undefined;
    }
    const project = found.project as ProjectState;
    return { project, file: slashPath(path.relative(project.root, document.uri.fsPath)) };
}

let enabled = true;
/** The Projects whose first parse has been asked for, so that one that failed is not run again at every change of editor */
const asked = new Set<string>();

/**
 * Parses the Project of the document, if it is of a dbt Project that has no graph yet and has not been asked for
 * one. Resolves when the parse has ended, or at once when none was started.
 */
export async function parseOnFirstShow(document: vscode.TextDocument | undefined): Promise<void> {
    const dbt = enabled ? dbtFileOfDocument(document) : undefined;
    if (!dbt || asked.has(dbt.project.root)) {
        return;
    }
    asked.add(dbt.project.root);
    // The panel, or a command, got there first: its compile gives the graph
    if (dbt.project.dbtBackend?.lastResult || dbtCompilePending(dbt.project.root)) {
        return;
    }
    // With no file, the Project is parsed
    await compileDbtProject(dbt.project, undefined, 'open');
}

/**
 * A file that affects a compile was saved while the panel was closed. The Project is compiled for the file on show
 * (`shown`, else the saved one) and what the panel would show of it is dry-run; or only parsed, when the setting
 * says so. A dbt v2 Project with on-run hooks is only parsed, as ever, and nothing is said of it here.
 */
export async function savedWithoutPanel(saved: DbtFileOfProject, shown: DbtFileOfProject | undefined): Promise<void> {
    if (!enabled) {
        return;
    }
    const { project } = saved;
    const { root, dbtBackend } = project;
    const dryRun = vscode.workspace.getConfiguration('vscode-dataform-tools', vscode.Uri.file(root)).get<boolean>('dbtDryRunOnSave') !== false;
    const file = shown?.project === project ? shown.file : saved.file;
    asked.add(root);
    await compileDbtProject(project, dryRun ? file : undefined, 'save');
    const last = dbtBackend?.lastResult;
    const state = dbtCompileState(root);
    const adapter = last?.dbt?.adapterType;
    // Replaced by a newer compile, failed, only parsed, or not a BigQuery Project: nothing to dry-run
    if (!dryRun || !dbtBackend || !last || last.parsedOnly || dbtCompilePending(root) || state.compiling || !state.compiled || (adapter && adapter !== 'bigquery')) {
        return;
    }
    // Without credentials there is nothing to ask, and nothing is said of it here: the panel says it when opened
    if (!(await dbtCanAskBigQuery())) {
        return;
    }
    const compile = project.compileNumber;
    if (dbtCompilePending(root)) {
        return;
    }
    const onShow = fileSlice(last.graph, dbtBackend, file, compile).actions.map((action) => action.id);
    const actions = dbtActionsToDryRun(last.graph, onShow);
    if (actions.length > 0) {
        await dryRunDbtActions(root, actions, compile).catch((error) => logger.error(`dbt: the dry runs of ${file} failed: ${error}`));
    }
}

/** Turns the work done without the panel off or on, for tests of the panel's own compile loop, which count dbt's runs */
export function setDbtWithoutPanel(on: boolean) {
    enabled = on;
    asked.clear();
}

export function initDbtWithoutPanel(context: vscode.ExtensionContext) {
    void parseOnFirstShow(vscode.window.activeTextEditor?.document);
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((editor) => void parseOnFirstShow(editor?.document)),
        // Another dbt found, or one found at last: the Project is worth asking again
        onDidChangeDbtTool((root) => asked.delete(root)),
    );
}
