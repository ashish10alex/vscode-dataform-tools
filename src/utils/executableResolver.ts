import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../logger';
import { cacheDurationMs } from '../constants';
import { ExecutablePathCache, ExecutablePathInfo } from '../types';

const executablePathCache: ExecutablePathCache = new Map<string, ExecutablePathInfo>();

export function executableIsAvailable(name: string, showErrorOnNotFound: boolean = false): boolean {
    const foundPath = findExecutableInPaths(name);

    if (!foundPath && showErrorOnNotFound) {
        vscode.window.showErrorMessage(`${name} cli not found`, "Installation Guide").then(selection => {
            if (selection === "Installation Guide") {
                vscode.env.openExternal(vscode.Uri.parse("https://github.com/ashish10alex/vscode-dataform-tools?tab=readme-ov-file#installation"));
            }
        });
    }

    return !!foundPath;
}

// Find executable using built-in detection + user overrides
export function findExecutableInPaths(executableName: string): string | null {
    const cacheKey = `${executableName}:${process.platform}`;
    const cached = executablePathCache.get(cacheKey);

    // Return cached result if still valid
    if (cached && (Date.now() - cached.timestamp) < cacheDurationMs) {
        logger.debug(`Binary path cache hit for ${executableName}: ${cached.path}`);
        return cached.path;
    }

    logger.debug(`Binary path cache miss for ${executableName}, searching...`);

    // 1. Check user-specified exact path first (highest priority)
    const specificPath = getSpecificExecutablePath(executableName);
    if (specificPath) {
        logger.debug(`Found ${executableName} via user config: ${specificPath}`);
        executablePathCache.set(cacheKey, { path: specificPath, timestamp: Date.now() });
        return specificPath;
    }

    // 2. Check system PATH with enhanced detection
    const systemPath = findExecutableInSystemPath(executableName);
    if (systemPath) {
        logger.debug(`Found ${executableName} via system PATH: ${systemPath}`);
        executablePathCache.set(cacheKey, { path: systemPath, timestamp: Date.now() });
        return systemPath;
    }

    // 3. Check common tool manager and installation locations
    const commonPath = findExecutableInCommonLocations(executableName);
    if (commonPath) {
        logger.debug(`Found ${executableName} via common locations: ${commonPath}`);
    } else {
        logger.debug(`${executableName} not found in any location`);
    }
    executablePathCache.set(cacheKey, { path: commonPath, timestamp: Date.now() });
    return commonPath;
}

// Get user-specified exact path for executable
function getSpecificExecutablePath(executableName: string): string | null {
    try {
        const vscodeConfig = vscode.workspace.getConfiguration('vscode-dataform-tools');
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
        const foundPath = findExecutableInPaths(exe);
        results.push(`${exe}: ${foundPath || 'Not found'}`);
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
    let sqlfluffConfigPath: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sqlfluffConfigPath');
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
    let sqlfluffExecutablePath: string | undefined = vscode.workspace.getConfiguration('vscode-dataform-tools').get('sqlfluffExecutablePath');
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
