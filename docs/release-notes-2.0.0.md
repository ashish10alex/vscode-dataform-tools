# Release notes for 2.0.0

The text for the 2.0.0 entry of `CHANGELOG.md`, which `just release` starts from the commits. Paste the part below the line under the release's heading, in place of the list of commits or above it. The website's changelog page reads `CHANGELOG.md`, so it shows the same text.

The 1.19.x pre-release can carry the same text with "pre-release" in its first line.

---

The extension is now **Tools for Dataform and dbt**. It works in dbt™ projects on BigQuery beside Dataform, with the dbt you have installed: dbt Core 1.8 or later with the BigQuery adapter, or dbt v2.

### Features

* **dbt projects**: open a folder that has `dbt_project.yml`, at its root or in a sub-folder.
  * **Compiled query**: the model in the editor with the tests that read it, each in its own section; hooks shown as written; a card for a seed, a file of sources, a macro file and `dbt_project.yml`.
  * **Dry run, cost and schema** for every compiled query, with BigQuery's error at its line and column.
  * **Preview** of a compiled query; for a test, the rows that fail it.
  * **Run**: `dbt build` in a terminal for the file, with dependencies, with dependents, as a full refresh, or by tag. The button names the dbt target, and the first run against a dbt target that is not the profile's default asks first.
  * **Run Changed**: `dbt build --select state:modified` against the merge-base with the default branch, with the same button as Dataform's: the changed actions by file, why each changed (new, SQL, config, macro), and a tick per file. The extension parses the merge-base itself, so no production manifest is needed. Also the command "Run changed actions (vs default branch)".
  * **dbt target control** in the panel, with a private choice per workspace; settings `dbtTarget`, `dbtVars`, `dbtProfilesDir`.
  * **Compile errors** in the panel with links, and marked in the editor where dbt gave a line.
  * **In the editor**: go to definition from a `ref()`, a `source()` and a macro call; hover on a `ref()` or `source()` with the table's description, partitioning, row count and columns, and on a column name with its type and description; completions for model, source and column names. The language of `.sql` files is not changed. These stand down beside the dbt extension of dbt Labs or Power User for dbt, unless `dbtEditorFeatures` is `on`.
  * **Dry-run errors in the editor**: on the line of your file when it is in the compiled query unchanged, else on the first line with the place in the compiled query. A save dry-runs also while the panel is closed; `dbtDryRunOnSave` turns that off.
  * **Finding dbt**: the `dbtExecutablePath` setting, `$DBT_BIN`, the project's `.venv` or `venv`, the Python extension's environment, `PATH`, common install directories. The panel says which was found.
  * **dbt v2 projects with on-run hooks are only parsed** unless `dbtCompileWithHooks` is on, because dbt v2 runs those hooks on every compile.
* **Several projects in one window**: the project follows the file in the editor. A folder may be a Dataform project, a dbt project, or both.
* **Projects in sub-folders**, for Dataform and dbt: the project of a file is the nearest folder above it that has `workflow_settings.yaml`, `dataform.json` or `dbt_project.yml`, up to the folder you opened. The panel names the project when it is in a sub-folder or when the window has several. Folders in `files.exclude` and `search.exclude` are not searched for projects.
* **Remote hosts**: Remote SSH, dev containers and WSL are supported for both tools. A dev container with a dbt project is in `.devcontainer/dbt`.

### Changes for Dataform users

* `gcloud` no longer blocks the compiled query panel. Missing credentials show when a BigQuery call fails.
* The "Not a Dataform workspace" warning is gone.
* With several workspace folders, the project follows the active editor instead of being picked once per window. "Select workspace folder" is now a project picker, listed only when a window has more than one project.
* The extension also activates in a workspace that has a `dbt_project.yml`, and in one that has a settings file in a sub-folder.
* A Dataform project in a sub-folder of its git repository compiles in CLI mode. API mode says that the Dataform API needs the settings file at the top of the repository.
* A file in no project gets one message that names the settings files of both tools.
* Seventeen commands change category from "Dataform" to "Dataform/dbt". "Run assertions in the current model" is now "Run assertions / tests in the current model".
* The bottom panel that shows query results is named "BigQuery Results", and the compiled query panel's tab is named "Compiled Query".
* No command id or setting id changed.

### Not in a dbt project yet

The dependency graph, column lineage, defer to prod, runs through an API, the cost estimate of a tag, formatting, and hover and completions for macros.

dbt and dbt Core are trademarks of dbt Labs, LLC.
