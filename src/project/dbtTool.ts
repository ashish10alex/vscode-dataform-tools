import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { DbtProbe, probeDbt } from '../backend/dbt';
import { findDbt } from '../backend/dbt/find';
import { logger } from '../logger';
import { onDidChangeActiveProject, projects } from './index';
import { extensionConfiguration } from './settings';

/*
 * The dbt of each dbt Project (xf#49): found in the background once the extension has started, probed once, and
 * looked for again when the path setting changes, when the Python extension selects another environment, or when
 * the file that was found is gone. The extension never installs anything.
 */

export type DbtTool =
    /** The search or the probe has not finished */
    | { status: 'looking' }
    | { status: 'found'; path: string; foundBy: string; probe: DbtProbe }
    /** A dbt was found and `dbt --version` could not be run or read */
    | { status: 'unusable'; path: string; foundBy: string; reason: string }
    /** No dbt anywhere. `looked` lists the places, for the panel to show */
    | { status: 'missing'; looked: string[] };

const PYTHON_EXTENSION = 'ms-python.python';

const tools = new Map<string, { tool: DbtTool; settled: Promise<DbtTool> }>();
const changed = new vscode.EventEmitter<string>();
/** Fires with a Project's root when what is known of its dbt changes */
export const onDidChangeDbtTool = changed.event;

/** One `dbt --version` per binary as it is on disk: a new file at the same path, as an upgrade leaves, is probed again */
const probes = new Map<string, Promise<DbtProbe>>();

function probeOnce(binary: string): Promise<DbtProbe> {
    let stamp = '';
    try {
        const stat = fs.statSync(binary);
        stamp = `${stat.size}:${stat.mtimeMs}`;
    } catch {
        // Probed anyway: the probe says what is wrong
    }
    const key = `${binary}:${stamp}`;
    let probe = probes.get(key);
    if (!probe) {
        probe = probeDbt(binary);
        probes.set(key, probe);
        probe.catch(() => probes.delete(key));
    }
    return probe;
}

/**
 * Where the Python environment that the Python extension has selected for the Project keeps its executables. A soft
 * dependency: undefined when the extension is not installed, or its API is not what is expected.
 */
async function pythonEnvironmentBin(root: string): Promise<string | undefined> {
    const extension = vscode.extensions.getExtension(PYTHON_EXTENSION);
    if (!extension) {
        return undefined;
    }
    try {
        const api = extension.isActive ? extension.exports : await extension.activate();
        const environmentPath = api?.environments?.getActiveEnvironmentPath(vscode.Uri.file(root));
        const environment = environmentPath && (await api.environments.resolveEnvironment(environmentPath));
        const executable: string | undefined = environment?.executable?.uri?.fsPath;
        return executable ? path.dirname(executable) : undefined;
    } catch (error) {
        logger.debug(`dbt: the Python extension gave no environment: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
    }
}

async function resolve(root: string): Promise<DbtTool> {
    const settingPath = extensionConfiguration(vscode.Uri.file(root)).get<string>('dbtExecutablePath') || undefined;
    const { found, looked } = findDbt({ root, settingPath, pythonEnvironmentBin: await pythonEnvironmentBin(root) });
    if (!found) {
        logger.info(`dbt: none found for ${root}. Looked in: ${looked.join('; ')}`);
        return { status: 'missing', looked };
    }
    try {
        const probe = await probeOnce(found.path);
        logger.info(`dbt: ${probe.label} at ${found.path}, found by ${found.foundBy}`);
        return { status: 'found', ...found, probe };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(`dbt: ${found.path}, found by ${found.foundBy}, could not be probed: ${reason}`);
        return { status: 'unusable', ...found, reason };
    }
}

/** Looks for the Project's dbt again, replacing what was known */
export function lookForDbt(root: string): Promise<DbtTool> {
    const entry: { tool: DbtTool; settled: Promise<DbtTool> } = { tool: { status: 'looking' }, settled: undefined as never };
    entry.settled = resolve(root).then((tool) => {
        // A later look may have replaced this one
        if (tools.get(root) === entry) {
            entry.tool = tool;
            changed.fire(root);
        }
        return tool;
    });
    tools.set(root, entry);
    changed.fire(root);
    return entry.settled;
}

/** What is known of the Project's dbt right now, without waiting. Undefined for a Project never looked at */
export function dbtToolNow(root: string): DbtTool | undefined {
    return tools.get(root)?.tool;
}

/**
 * The Project's dbt, once the search and the probe have finished. A dbt whose file has since gone is looked for
 * again first.
 */
export function dbtTool(root: string): Promise<DbtTool> {
    const known = tools.get(root);
    if (!known) {
        return lookForDbt(root);
    }
    const { tool } = known;
    if ((tool.status === 'found' || tool.status === 'unusable') && !fs.existsSync(tool.path)) {
        return lookForDbt(root);
    }
    return known.settled;
}

function lookForAll(onlyNew = false) {
    for (const project of projects.projects) {
        if (project.backend === 'dbt' && !(onlyNew && tools.has(project.root))) {
            void lookForDbt(project.root);
        }
    }
}

/** Finds and probes the dbt of every dbt Project in the background, and keeps what is known current */
export function initDbtTools(context: vscode.ExtensionContext) {
    lookForAll();
    context.subscriptions.push(
        changed,
        // A dbt Project that appears later, e.g. a folder added to the workspace
        onDidChangeActiveProject(() => lookForAll(true)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('vscode-dataform-tools.dbtExecutablePath')) {
                lookForAll();
            }
        }),
    );
    // The Python extension says when another environment is selected. Not activated for this: if it is not running
    // yet, the first look activates it
    const python = vscode.extensions.getExtension(PYTHON_EXTENSION);
    const listen = () => {
        try {
            const subscription = python?.exports?.environments?.onDidChangeActiveEnvironmentPath?.(() => lookForAll());
            if (subscription) {
                context.subscriptions.push(subscription);
            }
        } catch (error) {
            logger.debug(`dbt: cannot listen to the Python extension: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    if (python?.isActive) {
        listen();
    } else if (python && projects.projects.some((project) => project.backend === 'dbt')) {
        python.activate().then(listen, () => undefined);
    }
}
