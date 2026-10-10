import * as vscode from 'vscode';
import { listDbtTargets } from '../backend/dbt';
import { logger } from '../logger';
import type { RunOptions } from '../shared/compiledGraph';
import { dbtOptions, dbtSettings } from './dbtCompile';
import type { ProjectState } from './registry';
import { createTerminalWhenReady, sendTextWhenReady } from '../utils/terminalReady';

/*
 * Runs of a dbt Project (xf#54): always `dbt build`, in a terminal of the extension, from the Project root, with the
 * same dbt, dbt target, variables and profiles directory as compiles. The extension starts the run and no more: the
 * user watches it in the terminal and stops it there.
 */

/** A run that was sent to the terminal */
export interface DbtRun {
    request: RunOptions;
    /** The command line, as it was sent */
    command: string;
    /** Epoch ms */
    startedAt: number;
}

const lastRuns = new Map<string, DbtRun>();
const changed = new vscode.EventEmitter<string>();
/** Fires with a Project's root when a run of it has been sent to the terminal */
export const onDidRunDbt = changed.event;
/** By Project root. A terminal the user closed is replaced */
const terminals = new Map<string, vscode.Terminal>();
/** The dbt targets, by Project root, that the user has agreed to build into in this window */
const confirmed = new Set<string>();

/** The last run of the Project sent to the terminal in this window */
export function lastDbtRun(root: string): DbtRun | undefined {
    return lastRuns.get(root);
}

/**
 * The dbt target a run of the Project uses, named even when dbt would choose it: the one chosen or set, else the one
 * the last compile said dbt used. Undefined when neither is known.
 */
export function dbtRunTarget(project: ProjectState): string | undefined {
    return dbtSettings(project.root).target ?? project.dbtBackend?.lastResult?.target;
}

/**
 * Whether a run against `target` must be confirmed first: it is not the default of the Project's profile, or the
 * profile cannot be read and the dbt target was chosen or set rather than left to dbt.
 */
export function needsConfirmation(target: string | undefined, profileDefault: string | undefined, chosen: boolean): boolean {
    if (!target) {
        return false;
    }
    return profileDefault ? target !== profileDefault : chosen;
}

function terminalFor(root: string): vscode.Terminal {
    let terminal = terminals.get(root);
    if (!terminal || terminal.exitStatus !== undefined || !vscode.window.terminals.includes(terminal)) {
        terminal = createTerminalWhenReady({ name: 'dbt', cwd: root });
        terminals.set(root, terminal);
    }
    return terminal;
}

/**
 * Sends a run of the Project to its terminal. The first run in a window against a dbt target that is not the
 * profile's default asks first, naming the dbt target and showing the command: a forgotten override must not build
 * into the wrong place unnoticed. Resolves to the run, or to undefined when nothing was run; the reason has then been
 * shown to the user.
 */
export async function runDbt(project: ProjectState, request: RunOptions): Promise<DbtRun | undefined> {
    const { root, dbtBackend } = project;
    const options = await dbtOptions(root);
    if (!dbtBackend?.runner || !options) {
        vscode.window.showErrorMessage('dbt was not found for this project, so nothing can be run. The compiled query panel says where it was looked for.');
        return undefined;
    }
    const adapter = dbtBackend.lastResult?.dbt?.adapterType;
    if (adapter && adapter !== 'bigquery') {
        vscode.window.showWarningMessage(`This project's profile targets ${adapter}. The extension runs BigQuery projects only.`);
        return undefined;
    }
    const target = dbtRunTarget(project);
    let command: string;
    try {
        command = dbtBackend.runner.command({ root, options: { ...options, target }, run: request });
    } catch (error) {
        vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        return undefined;
    }
    const settings = dbtSettings(root);
    const profileDefault = listDbtTargets(root, { profilesDir: settings.profilesDir })?.defaultName;
    const key = `${root}\n${target}`;
    if (needsConfirmation(target, profileDefault, settings.target !== undefined) && !confirmed.has(key)) {
        const why = profileDefault ? `This is not the profile's default dbt target (${profileDefault}).` : "The profile's default dbt target could not be read.";
        const answer = await vscode.window.showWarningMessage(`Build into ${target}?`, { modal: true, detail: `${why} Asked once per window.\n\n${command}` }, 'Run');
        if (answer !== 'Run') {
            return undefined;
        }
        confirmed.add(key);
    }
    const terminal = terminalFor(root);
    terminal.show();
    // A new terminal is waited on, so that a virtual environment activated in it does not cancel the run (#497)
    await sendTextWhenReady(terminal, command);
    const run: DbtRun = { request, command, startedAt: Date.now() };
    lastRuns.set(root, run);
    logger.info(`dbt: sent to the terminal, from ${root}: ${command}`);
    changed.fire(root);
    return run;
}

/** Sends the Project's last run to the terminal again, as it was asked for: the command is built anew, so it uses the dbt target of now */
export async function repeatDbtRun(project: ProjectState): Promise<DbtRun | undefined> {
    const last = lastRuns.get(project.root);
    if (!last) {
        vscode.window.showInformationMessage('No dbt run to repeat in this window yet.');
        return undefined;
    }
    return runDbt(project, last.request);
}

export function initDbtRuns(context: vscode.ExtensionContext) {
    context.subscriptions.push(changed, vscode.window.onDidCloseTerminal((closed) => {
        for (const [root, terminal] of terminals) {
            if (terminal === closed) {
                terminals.delete(root);
            }
        }
    }));
}
