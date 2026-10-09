import fs from 'fs';
import os from 'os';
import path from 'path';
import { load as loadYaml } from 'js-yaml';

/*
 * The dbt targets of a Project (xf#50): the names a user can choose from, read from the Project's profile, and the
 * one dbt used, read from its log. Only key names are read from a profile, never a value: it holds credentials.
 */

export interface DbtTargets {
    /** The profile `dbt_project.yml` names */
    profile: string;
    /** The `profiles.yml` it was read from */
    profilesFile: string;
    /** The profile's dbt targets: the keys of its `outputs`, in the file's order */
    names: string[];
    /** The one the profile names as its default (`target:`), when that is one of `names` and not a Jinja expression */
    defaultName?: string;
}

/**
 * Where dbt looks for `profiles.yml`, in its order: the profiles-directory option, `$DBT_PROFILES_DIR`, the
 * Project root, then `~/.dbt`.
 */
export function profilesDirectories(root: string, options: { profilesDir?: string; env?: NodeJS.ProcessEnv; homeDir?: string } = {}): string[] {
    const env = options.env ?? process.env;
    const absolute = (dir: string) => path.resolve(root, dir);
    return [
        ...(options.profilesDir ? [absolute(options.profilesDir)] : []),
        ...(env.DBT_PROFILES_DIR ? [absolute(env.DBT_PROFILES_DIR)] : []),
        root,
        path.join(options.homeDir ?? os.homedir(), '.dbt'),
    ];
}

function readYaml(file: string): Record<string, unknown> | undefined {
    try {
        const parsed = loadYaml(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
        // Missing, or not YAML as it stands: a profile may have Jinja statements in it
        return undefined;
    }
}

/**
 * The dbt targets of the Project at `root`. Undefined when they cannot be told: no `profile` in `dbt_project.yml`,
 * no `profiles.yml` where dbt looks, a file that does not parse, or a profile with no `outputs`. The host then lets
 * the user type a name.
 */
export function listDbtTargets(root: string, options: { profilesDir?: string; env?: NodeJS.ProcessEnv; homeDir?: string } = {}): DbtTargets | undefined {
    const projectFile = path.join(root, 'dbt_project.yml');
    // dbt takes the first profiles.yml it finds, and does not look further when the profile is not in it
    const profilesFile = profilesDirectories(root, options).map((dir) => path.join(dir, 'profiles.yml')).find((file) => fs.existsSync(file));
    const stamp = `${stampOf(projectFile)}\n${profilesFile ? stampOf(profilesFile) : ''}`;
    const known = held.get(root);
    if (known?.stamp === stamp) {
        return known.targets;
    }
    const targets = readDbtTargets(projectFile, profilesFile);
    held.set(root, { stamp, targets });
    return targets;
}

/** By Project root: the dbt targets as last read, and the state of the two files they were read from. Read again only when a file has changed */
const held = new Map<string, { stamp: string; targets: DbtTargets | undefined }>();

function stampOf(file: string): string {
    try {
        const stat = fs.statSync(file);
        return `${file} ${stat.size} ${stat.mtimeMs}`;
    } catch {
        return file;
    }
}

function readDbtTargets(projectFile: string, profilesFile: string | undefined): DbtTargets | undefined {
    const profile = readYaml(projectFile)?.profile;
    if (typeof profile !== 'string' || profile === '') {
        return undefined;
    }
    const entry = profilesFile ? readYaml(profilesFile)?.[profile] : undefined;
    if (!profilesFile || !entry || typeof entry !== 'object') {
        return undefined;
    }
    const { outputs, target } = entry as { outputs?: unknown; target?: unknown };
    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
        return undefined;
    }
    const names = Object.keys(outputs);
    if (names.length === 0) {
        return undefined;
    }
    const targets: DbtTargets = { profile, profilesFile, names };
    if (typeof target === 'string' && names.includes(target)) {
        targets.defaultName = target;
    }
    return targets;
}

/**
 * The dbt target a command ran with, from its JSON log on stdout. dbt v2 names it when a command ends ("Finished
 * 'compile' successfully for target 'dev'"); dbt-core names it when a compile starts (`target_name` of its
 * ConcurrencyLine event) and not at all when it only parses. Undefined when the log does not say.
 */
export function activeDbtTarget(stdout: string): string | undefined {
    let active: string | undefined;
    for (const line of stdout.split('\n')) {
        if (!line.includes('target')) {
            continue;
        }
        let event: { info?: { msg?: string; name?: string }; data?: { target_name?: unknown } };
        try {
            event = JSON.parse(line);
        } catch {
            continue;
        }
        if (typeof event?.data?.target_name === 'string' && event.data.target_name) {
            active = event.data.target_name;
        } else if (event?.info?.name === 'CommandCompleted') {
            active = /for target '([^']+)'/.exec(event.info.msg ?? '')?.[1] ?? active;
        }
    }
    return active;
}
