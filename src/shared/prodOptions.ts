/*
 * The prod compiler options split into the prod project (`--default-database`) and everything else, so the panel
 * and the defer to prod quick pick can ask for a project instead of a command-line flag.
 */

const FLAG = "--default-database";

/** The words of a command-line string, keeping a quoted value with its flag */
function words(options: string): string[] {
    return options.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

/** The `--default-database` of a command-line string of compiler options, and the other options as they were typed */
export function splitProdProject(options: string | undefined): { project: string; rest: string } {
    let project = "";
    const rest: string[] = [];
    for (const word of words(options ?? "")) {
        if (word.startsWith(`${FLAG}=`)) {
            project = word.slice(FLAG.length + 1).replace(/"/g, "");
        } else {
            rest.push(word);
        }
    }
    return { project, rest: rest.join(" ") };
}

/**
 * What a user typed as the prod project, as a project ID: the flag, quotes and spaces dropped, so pasting
 * `--default-database=my-prod` works as well as typing `my-prod`
 */
export function cleanProdProject(typed: string): string {
    return typed.trim().replace(new RegExp(`^${FLAG}=`), "").replace(/["'\s]/g, "");
}

/** The compiler options with the prod project and the other options given. An empty project drops the flag */
export function joinProdOptions(project: string, rest: string): string {
    const cleaned = cleanProdProject(project);
    return [cleaned && `${FLAG}=${cleaned}`, rest.trim()].filter(Boolean).join(" ");
}
