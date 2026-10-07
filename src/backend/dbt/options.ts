/*
 * The dbt Backend's options. The host resolves them from settings and passes them in with every request (see
 * `BackendRequest`), so the Backend never reads a setting.
 */
export interface DbtOptions {
    /** The dbt to run: a path, or a name to find on PATH */
    binary: string;
    /** The dbt target to compile and run with (`--target`). Unset lets dbt choose: `$DBT_TARGET`, else the profile's default */
    target?: string;
    /** Variables for the Project (`--vars`), as the user typed them: YAML or JSON */
    vars?: string;
    /** Where dbt looks for `profiles.yml` (`--profiles-dir`). Unset lets dbt look where it does */
    profilesDir?: string;
    /**
     * Where dbt writes its `target/` and its logs for this Project, binary and dbt target: a directory of the
     * extension's own, so a compile never touches the Project's `target/`, which the user's runs and `--state`
     * comparisons rely on, and each engine keeps its own partial-parse state. It is made when missing.
     */
    artifactDir: string;
    /** The environment dbt runs in. Unset gives it this process's */
    env?: NodeJS.ProcessEnv;
}
