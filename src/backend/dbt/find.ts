import fs from 'fs';
import os from 'os';
import path from 'path';

/*
 * Where the dbt of a Project is (xf#49). The steps are tried in order and the first that has a dbt wins, so a
 * Project's own dbt is used before one installed for the whole machine. Plain data in, plain data out: the host
 * supplies the setting and the Python extension's environment.
 */

export interface DbtSearch {
    /** The Project's root */
    root: string;
    /** The `dbtExecutablePath` setting */
    settingPath?: string;
    /** The directory that holds the executables of the Python environment the Python extension has selected for the Project */
    pythonEnvironmentBin?: string;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    homeDir?: string;
    /** Whether the path is a file that can be run. For tests */
    isFile?: (file: string) => boolean;
}

export interface FoundDbt {
    path: string;
    /** Which step found it, for the user: "the dbtExecutablePath setting", "the Project's .venv" */
    foundBy: string;
}

export interface DbtSearchResult {
    found?: FoundDbt;
    /** The places looked, in order, up to and including the one that had a dbt: what the panel lists when there is none */
    looked: string[];
}

function isRunnableFile(file: string): boolean {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/** The file names a dbt goes by in a directory of executables. Not `dbt.cmd` or `dbt.bat`: dbt is run without a shell, and Node runs no batch file so */
function names(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['dbt.exe'] : ['dbt'];
}

/** Finds the Project's dbt */
export function findDbt(search: DbtSearch): DbtSearchResult {
    const env = search.env ?? process.env;
    const platform = search.platform ?? process.platform;
    const home = search.homeDir ?? os.homedir();
    const isFile = search.isFile ?? isRunnableFile;
    const looked: string[] = [];
    const inDirectory = (directory: string) => names(platform).map((name) => path.join(directory, name)).find(isFile);
    const pathDirectories = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
    /** A path as given, or a bare name looked up on PATH */
    const asGiven = (value: string) => {
        if (value.includes('/') || value.includes('\\')) {
            const file = path.resolve(search.root, value);
            return isFile(file) ? file : undefined;
        }
        return pathDirectories.map((directory) => path.join(directory, value)).find(isFile);
    };
    const venv = (name: string) => path.join(search.root, name, platform === 'win32' ? 'Scripts' : 'bin');

    const steps: Array<{ foundBy: string; where: string; find: () => string | undefined; skip?: boolean }> = [
        { foundBy: 'the dbtExecutablePath setting', where: `the dbtExecutablePath setting (${search.settingPath})`, find: () => asGiven(search.settingPath!), skip: !search.settingPath },
        { foundBy: '$DBT_BIN', where: `$DBT_BIN (${env.DBT_BIN})`, find: () => asGiven(env.DBT_BIN!), skip: !env.DBT_BIN },
        { foundBy: "the Project's .venv", where: "the Project's .venv", find: () => inDirectory(venv('.venv')) },
        { foundBy: "the Project's venv", where: "the Project's venv", find: () => inDirectory(venv('venv')) },
        {
            foundBy: "the Python extension's environment",
            where: `the Python extension's environment (${search.pythonEnvironmentBin})`,
            find: () => inDirectory(search.pythonEnvironmentBin!),
            skip: !search.pythonEnvironmentBin,
        },
        { foundBy: 'PATH', where: 'PATH', find: () => pathDirectories.map(inDirectory).find(Boolean) },
        {
            foundBy: 'a known install directory',
            where: knownDirectories(platform, home).join(', '),
            find: () => knownDirectories(platform, home).map(inDirectory).find(Boolean),
        },
    ];
    for (const step of steps) {
        if (step.skip) {
            continue;
        }
        looked.push(step.where);
        const found = step.find();
        if (found) {
            return { found: { path: found, foundBy: step.foundBy }, looked };
        }
    }
    return { looked };
}

/** Where dbt is installed when it is not on the PATH the extension was started with, as happens when VS Code is started from the Dock */
function knownDirectories(platform: NodeJS.Platform, home: string): string[] {
    if (platform === 'win32') {
        return [path.join(home, '.local', 'bin')];
    }
    return [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
}
