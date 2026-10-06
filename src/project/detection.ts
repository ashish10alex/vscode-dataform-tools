import fs from 'fs';
import path from 'path';

/*
 * Finds the Projects of a workspace: which folders are Dataform or dbt Projects, and which Project a file belongs to.
 * See "Project" and "Backend" in CONTEXT.md. No `vscode` import, so it runs in plain Node.
 */

/** The tool a Project is written for and compiled with */
export type BackendName = 'dataform' | 'dbt';

/** In the order they are listed to users */
export const BACKENDS: readonly BackendName[] = ['dataform', 'dbt'];

/** A settings file at the root of a directory makes it a Project of that Backend */
export const SETTINGS_FILES: Readonly<Record<BackendName, readonly string[]>> = {
    dataform: ['workflow_settings.yaml', 'dataform.json'],
    dbt: ['dbt_project.yml'],
};

export interface Project {
    /** Absolute path of the directory holding the settings file */
    root: string;
    backend: BackendName;
}

function hasSettingsFile(directory: string, backend: BackendName): boolean {
    return SETTINGS_FILES[backend].some((file) => {
        try {
            return fs.statSync(path.join(directory, file)).isFile();
        } catch {
            return false;
        }
    });
}

/**
 * The Projects rooted at `directory`: none, one, or one per Backend when it holds the settings files of both.
 * Looks in `directory` alone, never above or below it.
 */
export function detectProjects(directory: string): Project[] {
    return BACKENDS.filter((backend) => hasSettingsFile(directory, backend)).map((backend) => ({ root: directory, backend }));
}

/** The Projects of a workspace: a Project is only ever at the root of a workspace folder */
export function detectWorkspaceProjects(workspaceFolders: readonly string[]): Project[] {
    return workspaceFolders.flatMap(detectProjects);
}

/** Whether `filePath` is `root` or inside it */
function isWithin(root: string, filePath: string): boolean {
    const relative = path.relative(root, filePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** File types only one Backend has */
const BACKEND_BY_EXTENSION: Readonly<Record<string, BackendName>> = {
    '.sqlx': 'dataform',
    '.sql': 'dbt',
    '.csv': 'dbt',
    '.py': 'dbt',
};

export interface FileBackendHints {
    /** Whether that Backend's Compiled Graph lists the file (path relative to the root, with forward slashes) as defining an action */
    isListed?: (backend: BackendName, relativePath: string) => boolean;
    /** The Backend the user chose for files neither Backend claims */
    preferred?: BackendName;
}

/**
 * Which Backend a file belongs to in a directory that is the root of two Projects. The file decides: its type when only
 * one Backend has that type, else the one Compiled Graph that lists it, else the user's choice. Undefined when none of
 * these settles it, and the caller has to ask.
 */
export function backendForSharedRootFile(root: string, filePath: string, hints: FileBackendHints = {}): BackendName | undefined {
    const byExtension = BACKEND_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    if (byExtension) {
        return byExtension;
    }
    if (hints.isListed) {
        const relativePath = path.relative(root, filePath).split(path.sep).join('/');
        const listedBy = BACKENDS.filter((backend) => hints.isListed!(backend, relativePath));
        if (listedBy.length === 1) {
            return listedBy[0];
        }
    }
    return hints.preferred;
}

export type ProjectForFile =
    | { kind: 'project'; project: Project }
    /** The file is in a directory that is the root of two Projects and nothing says which it belongs to */
    | { kind: 'ambiguous'; candidates: Project[] }
    /** The file is outside every Project */
    | { kind: 'none' };

/**
 * The Project `filePath` belongs to, among `projects`. With workspace folders nested in one another the innermost
 * root wins.
 */
export function projectForFile(projects: readonly Project[], filePath: string, hints: FileBackendHints = {}): ProjectForFile {
    const containing = projects.filter((project) => isWithin(project.root, filePath));
    if (containing.length === 0) {
        return { kind: 'none' };
    }
    const innermost = containing.reduce((deepest, project) => (project.root.length > deepest.root.length ? project : deepest)).root;
    const candidates = containing.filter((project) => project.root === innermost);
    if (candidates.length === 1) {
        return { kind: 'project', project: candidates[0] };
    }
    const backend = backendForSharedRootFile(innermost, filePath, hints);
    const project = candidates.find((candidate) => candidate.backend === backend);
    return project ? { kind: 'project', project } : { kind: 'ambiguous', candidates };
}
