import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { execFile, execSync } from 'child_process';
import util from 'util';
import { logger } from '../logger';
import { perfCount } from '../perf';
import { cacheDurationMs } from '../constants';
import { ExecutablePathCache, ExecutablePathInfo, ExecutableSource } from '../types';
import { extensionConfiguration } from '../project/settings';

const executablePathCache: ExecutablePathCache = new Map<string, ExecutablePathInfo>();
const execFilePromise = util.promisify(execFile);

/** Lookups differ per Project: a path setting can be set for one workspace folder only */
function cacheKeyFor(executableName: string, workspaceFolder?: string): string {
    return `${executableName}:${process.platform}:${workspaceFolder ?? ''}`;
}

/** A found path stays cached until a setting that affects it changes; a miss is retried after cacheDurationMs. */
function getCachedExecutable(cacheKey: string): ExecutablePathInfo | undefined {
    const cached = executablePathCache.get(cacheKey);
    if (cached && (cached.path !== null || (Date.now() - cached.timestamp) < cacheDurationMs)) {
        return cached;
    }
    return undefined;
}

function rememberExecutable(cacheKey: string, foundPath: string | null, foundBy?: ExecutableSource): ExecutablePathInfo {
    const info: ExecutablePathInfo = { path: foundPath, foundBy: foundPath ? foundBy : undefined, timestamp: Date.now() };
    executablePathCache.set(cacheKey, info);
    return info;
}

/**
 * Resolves an executable like findExecutableInPaths, but searches PATH without blocking the extension host.
 * Called at activation so later synchronous lookups hit the cache.
 */
export async function prefetchExecutablePath(executableName: string, workspaceFolder?: string): Promise<string | null> {
    const cacheKey = cacheKeyFor(executableName, workspaceFolder);
    const cached = getCachedExecutable(cacheKey);
    if (cached !== undefined) {
        return cached.path;
    }
    const specificPath = getSpecificExecutablePath(executableName, workspaceFolder);
    if (specificPath) {
        return rememberExecutable(cacheKey, specificPath, 'setting').path;
    }
    try {
        const command = isRunningOnWindows ? 'where' : 'which';
        const { stdout } = await execFilePromise(command, [executableName], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const firstPath = stdout.trim().split('\n')[0]?.trim();
        if (firstPath && isValidExecutablePath(firstPath)) {
            return rememberExecutable(cacheKey, firstPath, 'path').path;
        }
    } catch (error) {
        logger.debug(`System PATH search failed for ${executableName}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return rememberExecutable(cacheKey, findExecutableInCommonLocations(executableName), 'commonLocation').path;
}

/**
 * The executable a Project would run, and which step of the lookup found it: the Project's own
 * `node_modules/.bin` for a `local` dataformCliScope, else the path setting, PATH, then common install locations.
 */
export function resolveExecutable(name: string, workspaceFolder?: string): { path: string | null, foundBy?: ExecutableSource } {
    if (name === 'dataform' && workspaceFolder && extensionConfiguration(vscode.Uri.file(workspaceFolder)).get('dataformCliScope') === 'local') {
        const localPath = path.join(workspaceFolder, 'node_modules', '.bin', isRunningOnWindows ? 'dataform.cmd' : 'dataform');
        return isValidExecutablePath(localPath) ? { path: localPath, foundBy: 'projectLocal' } : { path: null };
    }
    const { path: foundPath, foundBy } = lookUpExecutable(name, workspaceFolder);
    return { path: foundPath, foundBy };
}

export function executableIsAvailable(name: string, showErrorOnNotFound: boolean = false, workspaceFolder?: string): boolean {
    const foundPath = resolveExecutable(name, workspaceFolder).path;

    if (!foundPath && showErrorOnNotFound) {
        vscode.window.showErrorMessage(`${name} cli not found`, "Installation Guide").then(selection => {
            if (selection === "Installation Guide") {
                vscode.env.openExternal(vscode.Uri.parse("https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#installation"));
            }
        });
    }

    return !!foundPath;
}

/** The Dataform CLI to run for a workspace: `<workspace>/node_modules/.bin/dataform` when dataformCliScope is `local`, otherwise the one found on PATH or in common locations. */
export function getDataformCliCmdBasedOnScope(workspaceFolder: string): string {
    const dataformCliBase = isRunningOnWindows ? 'dataform.cmd' : 'dataform';
    const dataformCliScope: string | undefined = extensionConfiguration().get('dataformCliScope');
    logger.debug(`Dataform CLI scope setting: ${dataformCliScope || 'not set (using global)'}`);

    if (dataformCliScope === 'local') {
        const fullLocalPath = path.join(workspaceFolder, 'node_modules', '.bin', dataformCliBase);
        logger.debug(`Using local dataform CLI: ${fullLocalPath}`);
        return fullLocalPath;
    }

    const resolvedPath = findExecutableInPaths('dataform', workspaceFolder) || dataformCliBase;
    logger.debug(`Using global dataform CLI: ${resolvedPath}`);
    return resolvedPath;
}

// Find executable using built-in detection + user overrides
export function findExecutableInPaths(executableName: string, workspaceFolder?: string): string | null {
    return lookUpExecutable(executableName, workspaceFolder).path;
}

function lookUpExecutable(executableName: string, workspaceFolder?: string): ExecutablePathInfo {
    const cacheKey = cacheKeyFor(executableName, workspaceFolder);
    const cached = getCachedExecutable(cacheKey);
    if (cached !== undefined) {
        logger.debug(`Binary path cache hit for ${executableName}: ${cached.path}`);
        return cached;
    }

    logger.debug(`Binary path cache miss for ${executableName}, searching...`);

    // 1. Check user-specified exact path first (highest priority)
    const specificPath = getSpecificExecutablePath(executableName, workspaceFolder);
    if (specificPath) {
        logger.debug(`Found ${executableName} via user config: ${specificPath}`);
        return rememberExecutable(cacheKey, specificPath, 'setting');
    }

    // 2. Check system PATH with enhanced detection
    const systemPath = findExecutableInSystemPath(executableName);
    if (systemPath) {
        logger.debug(`Found ${executableName} via system PATH: ${systemPath}`);
        return rememberExecutable(cacheKey, systemPath, 'path');
    }

    // 3. Check common tool manager and installation locations
    const commonPath = findExecutableInCommonLocations(executableName);
    if (commonPath) {
        logger.debug(`Found ${executableName} via common locations: ${commonPath}`);
    } else {
        logger.debug(`${executableName} not found in any location`);
    }
    return rememberExecutable(cacheKey, commonPath, 'commonLocation');
}

// Get user-specified exact path for executable
function getSpecificExecutablePath(executableName: string, workspaceFolder?: string): string | null {
    try {
        const vscodeConfig = extensionConfiguration(workspaceFolder ? vscode.Uri.file(workspaceFolder) : undefined);
        const configKey = `${executableName}ExecutablePath`;
        const specificPath = vscodeConfig.get<string>(configKey);

        logger.debug(`Checking user config for ${executableName} at key '${configKey}': ${specificPath || 'not set'}`);

        if (specificPath && isValidExecutablePath(specificPath)) {
            logger.debug(`Validated user-specified path for ${executableName}: ${specificPath}`);
            return specificPath;
        }

        if (specificPath && !isValidExecutablePath(specificPath)) {
            logger.debug(`Invalid user-specified path for ${executableName}: ${specificPath}`);
        }

        return null;
    } catch (error) {
        logger.debug(`Configuration error for ${executableName}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

// Enhanced system PATH search
function findExecutableInSystemPath(executableName: string): string | null {
    try {
        const command = isRunningOnWindows ? 'where' : 'which';
        logger.debug(`Searching for ${executableName} using '${command}' command`);

        perfCount('which.execSync');
        const result = execSync(`${command} ${executableName}`, {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true
        }).trim();

        if (result) {
            const firstPath = result.split('\n')[0].trim();
            logger.debug(`System PATH search result for ${executableName}: ${firstPath}`);

            if (isValidExecutablePath(firstPath)) {
                logger.debug(`Validated system PATH for ${executableName}: ${firstPath}`);
                return firstPath;
            } else {
                logger.debug(`Invalid system PATH result for ${executableName}: ${firstPath}`);
            }
        } else {
            logger.debug(`No system PATH result for ${executableName}`);
        }
    } catch (error) {
        logger.debug(`System PATH search failed for ${executableName}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return null;
}

// Check common tool manager and installation locations
function findExecutableInCommonLocations(executableName: string): string | null {
    const commonPaths = getCommonExecutablePaths(executableName);
    logger.debug(`Searching ${commonPaths.length} common locations for ${executableName}`);

    for (const testPath of commonPaths) {
        logger.debug(`Testing common location: ${testPath}`);
        if (isValidExecutablePath(testPath)) {
            logger.debug(`Found ${executableName} at common location: ${testPath}`);
            return testPath;
        }
    }

    logger.debug(`${executableName} not found in any common location`);
    return null;
}

// Get common paths where executables might be installed
function getCommonExecutablePaths(executableName: string): string[] {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const extensions = getExecutableExtensions();
    const paths: string[] = [];

    // Common tool manager locations
    const toolManagerDirs = [
        `${homeDir}/.local/share/mise/shims`,
        `${homeDir}/.asdf/shims`,
        `${homeDir}/.nvm/current/bin`,
        `${homeDir}/.nodenv/shims`,
        `${homeDir}/.rbenv/shims`,
        `${homeDir}/.pyenv/shims`,
        `${homeDir}/.local/bin`,
        `${homeDir}/bin`,
        `${homeDir}/.cargo/bin`,
        // Homebrew
        '/opt/homebrew/bin',
        '/usr/local/bin',
        // Standard system locations
        '/usr/bin',
        '/bin'
    ];

    // Executable-specific locations
    if (executableName === 'gcloud') {
        toolManagerDirs.push(
            `${homeDir}/google-cloud-sdk/bin`,
            '/usr/local/google-cloud-sdk/bin',
            '/usr/local/opt/google-cloud-sdk/bin',
            '/snap/bin'
        );
    }

    // Generate full paths with extensions
    for (const dir of toolManagerDirs) {
        for (const ext of extensions) {
            paths.push(path.join(dir, executableName + ext));
        }
    }

    return paths;
}

// Cross-platform executable extensions
function getExecutableExtensions(): string[] {
    return isRunningOnWindows ? ['.exe', '.cmd', '.bat', ''] : [''];
}

// Cross-platform executable validation
function isValidExecutablePath(filePath: string): boolean {
    try {
        const stats = fs.statSync(filePath);

        if (!stats.isFile()) {
            return false;
        }

        if (isRunningOnWindows) {
            // On Windows, check file extension or try to access
            const ext = path.extname(filePath).toLowerCase();
            return ['.exe', '.cmd', '.bat'].includes(ext) || ext === '';
        } else {
            // On Unix systems, check if file is executable
            try {
                fs.accessSync(filePath, fs.constants.F_OK | fs.constants.X_OK);
                return true;
            } catch {
                return false;
            }
        }
    } catch {
        return false;
    }
}

// Clear cache when needed (for testing or configuration changes)
export function clearExecutablePathCache(): void {
    executablePathCache.clear();
}

// Debug function for troubleshooting executable detection issues
export function debugExecutablePaths(): void {
    // Clear cache for fresh testing
    clearExecutablePathCache();

    const executables: string[] = ['dataform', 'gcloud'];
    const results: string[] = [];

    executables.forEach(exe => {
        const { path: foundPath, foundBy } = resolveExecutable(exe);
        results.push(`${exe}: ${foundPath ? `${foundPath} (${foundBy})` : 'Not found'}`);
    });

    // Show concise results to user
    const message = `Executable Detection Results:\n\n${results.join('\n')}`;
    vscode.window.showInformationMessage('Debug Results', 'Show Details').then(selection => {
        if (selection === 'Show Details') {
            vscode.window.showInformationMessage(message);
        }
    });
}

export function getSqlfluffConfigPathFromSettings() {
    let defaultSqlfluffConfigPath = ".vscode-dataform-tools/.sqlfluff";
    let sqlfluffConfigPath: string | undefined = extensionConfiguration().get('sqlfluffConfigPath');
    if (sqlfluffConfigPath) {
        if (isRunningOnWindows) {
            sqlfluffConfigPath = path.win32.normalize(sqlfluffConfigPath);
        }
        return sqlfluffConfigPath;
    }
    if (!isRunningOnWindows) {
        return defaultSqlfluffConfigPath;
    }
    return path.win32.normalize(defaultSqlfluffConfigPath);
}

export function getSqlfluffExecutablePathFromSettings() {
    let defaultSqlfluffExecutablePath = "sqlfluff";
    let sqlfluffExecutablePath: string | undefined = extensionConfiguration().get('sqlfluffExecutablePath');
    logger.debug(`sqlfluffExecutablePath: ${sqlfluffExecutablePath}`);
    if (sqlfluffExecutablePath !== defaultSqlfluffExecutablePath && sqlfluffExecutablePath !== undefined) {
        if (isRunningOnWindows) {
            return sqlfluffExecutablePath = path.win32.normalize(sqlfluffExecutablePath);
        } else {
            return sqlfluffExecutablePath;
        }
    }
    if (!isRunningOnWindows) {
        return defaultSqlfluffExecutablePath;
    }
    return path.win32.normalize(defaultSqlfluffExecutablePath);
}
