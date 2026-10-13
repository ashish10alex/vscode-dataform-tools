/** Says which files under a Project's root affect its compile */
export interface CompileFiles {
    /** The directories at the root whose files count, at any depth. Unset means every directory at the root except `skip` */
    directories?: readonly string[];
    /** Directories at the root left out when `directories` is unset, such as build output */
    skip?: readonly string[];
    /** The file types that count under those directories, lower case with the dot: `.sqlx` */
    extensions: readonly string[];
    /** The files directly in the root that count */
    rootFiles: readonly string[];
}

const isIgnoredName = (name: string) => name === 'node_modules' || name.startsWith('.');

/**
 * Whether a change to `fileName` affects a compile. `fileName` is relative to the Project root with forward slashes,
 * as file names in a Compiled Graph are. Nothing under `node_modules` or a dot directory counts.
 */
export function affectsCompile(files: CompileFiles, fileName: string): boolean {
    const segments = fileName.split('/');
    const base = segments.pop()!;
    if (segments.length === 0) {
        return files.rootFiles.includes(base);
    }
    if (segments[0] === '..' || isIgnoredName(base) || segments.some(isIgnoredName)) {
        return false;
    }
    const watched = files.directories ? files.directories.includes(segments[0]) : !(files.skip ?? []).includes(segments[0]);
    const dot = base.lastIndexOf('.');
    return watched && dot >= 0 && files.extensions.includes(base.slice(dot).toLowerCase());
}
