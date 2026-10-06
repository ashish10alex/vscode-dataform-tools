/**
 * Writes a file path a tool printed with forward slashes, on every OS: Dataform and dbt-core print backslashes on
 * Windows, dbt v2 prints forward slashes, and a Compiled Graph holds one style so that comparing, joining and
 * matching file names works the same everywhere. Convert back before touching the filesystem.
 */
export function slashPath(filePath: string): string {
    return filePath.replaceAll('\\', '/');
}
