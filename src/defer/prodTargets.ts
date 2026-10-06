import * as vscode from 'vscode';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../logger';
import { Target } from '../types';
import { baseCacheDay } from '../changedActions';
import { compileDataform, createCompilerOptionsObjectForApi, parseCompiledString } from '../utils/dataformCompiler';
import { compileRemoteHeadWithConfig } from '../utils/remoteCompiler';
import { buildProdTargetMap } from './deferRules';
import { getDataformCompilerOptions, isRemoteMode, resolveDataformOptions } from '../project/dataformOptions';

/*
 * The Prod Target of every action comes from compiling the project with the Prod Options. A compile takes a
 * few seconds, so the map is cached per Prod Options, project settings file and day (includes/ often derive
 * values from the current date) and only recompiled when an action is missing from it.
 */

type ProdTargetEntry = {
    targets: Map<string, Target>;
    /** Keys still missing after a recompile, so they do not trigger another one */
    knownMissing: Set<string>;
};

let storageRoot: string | undefined;
const memoryCache = new Map<string, ProdTargetEntry>();
const inFlight = new Map<string, Promise<ProdTargetEntry>>();

export function initProdTargets(context: vscode.ExtensionContext) {
    storageRoot = path.join(context.globalStorageUri.fsPath, 'defer-to-prod');
}

/**
 * The compiler options that point at prod: the `prodCompilerOptions` setting, else the project defaults
 * (compiling with no options, i.e. without the dev overrides). Undefined when neither setting is set, as
 * dev and prod are then the same tables.
 */
export function getProdCompilerOptions(workspaceFolder: string): string | undefined {
    const explicit = vscode.workspace.getConfiguration('vscode-dataform-tools', vscode.Uri.file(workspaceFolder)).get<string>('prodCompilerOptions')?.trim();
    if (explicit) {
        return explicit;
    }
    return getDataformCompilerOptions().trim() ? "" : undefined;
}

function hash(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex').slice(0, 12);
}

function readProjectSettings(workspaceFolder: string): string {
    for (const file of ['workflow_settings.yaml', 'dataform.json']) {
        try {
            return fs.readFileSync(path.join(workspaceFolder, file), 'utf8');
        } catch {
            // Try the next settings file
        }
    }
    return "";
}

function cacheKey(workspaceFolder: string, prodOptions: string): string {
    const backend = isRemoteMode() ? "api" : "cli";
    return hash([path.resolve(workspaceFolder), backend, prodOptions, readProjectSettings(workspaceFolder), baseCacheDay()].join("\n"));
}

function cacheFile(key: string): string | undefined {
    return storageRoot ? path.join(storageRoot, `${key}.json`) : undefined;
}

async function readCachedEntry(key: string): Promise<ProdTargetEntry | undefined> {
    const file = cacheFile(key);
    if (!file) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { targets: [string, Target][] };
        return { targets: new Map(parsed.targets), knownMissing: new Set() };
    } catch {
        return undefined;
    }
}

async function saveEntry(key: string, entry: ProdTargetEntry) {
    const file = cacheFile(key);
    if (!file) {
        return;
    }
    try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, JSON.stringify({ targets: [...entry.targets.entries()] }));
    } catch (error) {
        logger.error(`Defer to prod: could not cache prod targets: ${error}`);
    }
}

async function compileProdTargets(workspaceFolder: string, prodOptions: string, key: string): Promise<ProdTargetEntry> {
    if (isRemoteMode()) {
        const graph = await compileRemoteHeadWithConfig(workspaceFolder, resolveDataformOptions(workspaceFolder, 'api'), createCompilerOptionsObjectForApi([prodOptions]), `prod-${hash(prodOptions)}`);
        return { targets: buildProdTargetMap(graph), knownMissing: new Set() };
    }
    const { compiledString, errors } = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "Compiling with prod options for defer to prod" },
        () => compileDataform(workspaceFolder, resolveDataformOptions(workspaceFolder, 'cli'), prodOptions),
    );
    if (!compiledString) {
        const details = (errors ?? []).slice(0, 3).map((e) => (e.fileName ? `${e.fileName}: ${e.error}` : e.error)).join('\n');
        throw new Error(`Compiling with prod options failed: ${details || 'unknown error'}`);
    }
    const entry = { targets: buildProdTargetMap(parseCompiledString(compiledString)), knownMissing: new Set<string>() };
    await saveEntry(key, entry);
    return entry;
}

function compileOnce(workspaceFolder: string, prodOptions: string, key: string): Promise<ProdTargetEntry> {
    const pending = inFlight.get(key);
    if (pending) {
        return pending;
    }
    const compile = compileProdTargets(workspaceFolder, prodOptions, key)
        .then((entry) => {
            memoryCache.set(key, entry);
            return entry;
        })
        .finally(() => inFlight.delete(key));
    inFlight.set(key, compile);
    return compile;
}

/**
 * Prod Targets keyed by `prodKey`. Recompiles when one of `requiredKeys` is missing, e.g. an action added since
 * the last prod compile. In remote mode the pushed commit is compiled, which a recompile would not change.
 */
export async function getProdTargets(workspaceFolder: string, prodOptions: string, requiredKeys: string[] = []): Promise<Map<string, Target>> {
    const key = cacheKey(workspaceFolder, prodOptions);
    let entry = memoryCache.get(key) ?? await inFlight.get(key);
    if (!entry) {
        entry = await readCachedEntry(key);
        if (entry) {
            memoryCache.set(key, entry);
        }
    }
    if (!entry) {
        return (await compileOnce(workspaceFolder, prodOptions, key)).targets;
    }

    const missing = requiredKeys.filter((required) => !entry!.targets.has(required) && !entry!.knownMissing.has(required));
    if (missing.length > 0 && !isRemoteMode()) {
        logger.debug(`Defer to prod: ${missing.length} action(s) missing from the prod targets, recompiling`);
        entry = await compileOnce(workspaceFolder, prodOptions, key);
        missing.filter((required) => !entry!.targets.has(required)).forEach((required) => entry!.knownMissing.add(required));
    }
    return entry.targets;
}

/** Starts the prod compile alongside a fresh dev compile, so the first deferral does not wait for both in turn. */
export function prefetchProdTargets(workspaceFolder: string, prodOptions: string) {
    const key = cacheKey(workspaceFolder, prodOptions);
    if (memoryCache.has(key) || inFlight.has(key)) {
        return;
    }
    getProdTargets(workspaceFolder, prodOptions).catch((error) => logger.error(`Defer to prod: prefetch failed: ${error?.message}`));
}

/** Forgets every cached prod compile, so the next deferral compiles with the Prod Options again. */
export async function clearProdTargetCache() {
    memoryCache.clear();
    if (storageRoot) {
        await fsp.rm(storageRoot, { recursive: true, force: true }).catch((error) => logger.error(`Defer to prod: could not clear the cache: ${error}`));
    }
}
