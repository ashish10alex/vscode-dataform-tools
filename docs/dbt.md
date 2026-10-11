# dbt projects

From version 2.0.0 the extension works in a dbt™ project on BigQuery, beside Dataform. It uses the dbt you have installed: dbt Core 1.8 or later with the BigQuery adapter, or dbt v2. It installs nothing.

Set-up is in the [README](../README.md#installation). The features that work in a dbt project are in the [table of features](../README.md#features).

## Which dbt is used

The extension looks for dbt in this order and uses the first it finds: the `dbtExecutablePath` setting, `$DBT_BIN`, the project's `.venv` then `venv`, the environment the Python extension has selected, `PATH`, then common install directories. The panel's **Project** tab says which dbt is in use and how it was found.

A project in a sub-folder keeps the `vscode-dataform-tools.*` settings of its own `.vscode/settings.json`; other settings in that file, such as the colour theme, apply only when the project's folder is opened or added to the workspace.

## In the panel

| | In a dbt project |
| --- | --- |
| Compiled query | The model in the editor with the tests that read it, each in its own section. Hooks are shown as written. |
| Dry run | Size and cost of each compiled query, and BigQuery's error at its line and column. |
| Schema | The columns and types of the compiled query, with the descriptions from your YAML. |
| Preview | Runs the compiled query and shows the rows. For a test, the rows that fail it. |
| Run | `dbt build` in a terminal, for the file, with dependencies, with dependents, as a full refresh, or by tag. |
| Run Changed | The actions that differ from the merge-base with the default branch, as dbt finds them (`state:modified`). The panel lists them by file with why each changed, and runs all of them or the files you tick. |
| Defer to prod | With **Defer to prod** on, an upstream table that is not built in your dbt target is read from prod, as dbt's `--defer` does: in the compiled query, its dry run and preview, and in runs. The panel lists which tables were read from prod, and a label after each `ref()` says the same. Needs `dbtProdTarget`. |
| dbt target | Shown in the panel. Pick another there; the choice is yours alone and is kept for the workspace. |
| Compile errors | Shown in the panel with a link to the file, and marked in the editor where dbt gave a line. |
| Dry-run errors | BigQuery's errors are marked in the editor too. See [In the editor](#in-the-editor). |
| Go to definition | From a `ref()` to its model, seed or snapshot; from a `source()` to its table in the YAML file; from a macro call to its `{% macro %}` line. Also from a `ref()` or `source()` written in a YAML file. |
| Hover | On a `ref()`, a `source()` or a plain `project.dataset.table` id: the same hover as in a Dataform project, with the table in BigQuery, its kind, location, description, partitioning, row count and columns, and a link to search its columns. On a column name: its type and description, in each table the file reads that has it. |
| Search columns | *Search columns in a model*, from the hover, the right-click menu or the command palette: pick a column of the table under the cursor, or of a table the file reads, by name, type or description. |
| Completions | Model, seed and snapshot names inside `ref('`; sources and their tables inside `source('`; column names after an alias and a dot, and of every table the file reads. |
| Other files | A seed, a file of sources, a macro file and `dbt_project.yml` each show what they are. |
| Dependency graph | **Graph** in the panel, or *Show dependency graph*. Every model, seed, snapshot, source, test and exposure, centred on the file in the editor. Tests are hidden until you tick *Show tests*. Read from a parse of the project, so nothing needs compiling first. |

Not in a dbt project yet: the dependency inspector, column lineage, running through an API, the cost estimate of a tag, the BigQuery jobs of a run, formatting, code actions, and hover and completions for macros.

## In the editor

Go to definition, hover and completions work in the `.sql` files of a dbt project as soon as one is open in the editor: the extension parses the project then, in the background, without the panel.

* **The language of your `.sql` files is not changed.** The extension claims no language, grammar or file icon for `.sql`. It answers for the files under the folder that has `dbt_project.yml`, whatever SQL extension colours them.
* **Beside another dbt extension these features stand down.** VS Code shows what every extension offers, so two dbt extensions would give each hover and suggestion twice. While the dbt extension of dbt Labs or Power User for dbt is installed and enabled, go to definition, hover and completions of this extension are off, and the output channel says so. Set `vscode-dataform-tools.dbtEditorFeatures` to `on` to have both, or to `off` to never have these.
* **Schemas are read from BigQuery once per compile.** The first hover or completion that needs a table asks BigQuery for it. The answer is kept in memory until the project is next parsed or compiled, so a save reads it afresh.
* **Dry-run errors.** BigQuery reports an error at a line of the compiled query. When that line is in your file unchanged, the error is marked there. When Jinja built the line, the error is marked on the first line of the file and says where it is in the compiled query; the panel shows it in place. An error in a generic test is marked on the line of the YAML file that declares the test.
* **A save without the panel.** A save opens the panel unless `showCompiledQueryInVerticalSplitOnSave` is off. When the panel stays closed, a save still compiles the file and dry-runs its model and tests, so the errors are marked. Set `vscode-dataform-tools.dbtDryRunOnSave` to `false` to have such a save only parse the project. Without BigQuery credentials nothing is dry-run and nothing is marked.

## How it compiles

* **dbt Core and dbt v2** compile the file you are looking at, with its tests, and never the whole project. A file you have not looked at since the last save is compiled when you open it.
* **A dbt v2 project with `on-run-start` or `on-run-end` hooks is only parsed**, because dbt v2 runs those hooks against the warehouse on every compile. The panel then shows the SQL as written and offers to compile with hooks.
* dbt writes its artifacts for these compiles into the extension's storage, not into your project's `target/`.
* **Run Changed needs no manifest from you.** The extension takes the merge-base with `defaultBranch` out of git, parses it with your dbt, dbt target and variables, and keeps that manifest by commit in its own storage. It runs `dbt build --select state:modified --state <that manifest>`. The list is worked out when you open the button's popover, not in the background.
* **Defer to prod needs no manifest from you either.** Set `dbtProdTarget` to the dbt target of your profile that builds prod, and turn **Defer to prod** on in the panel or the status bar. The extension parses the same merge-base with that dbt target, keeps that manifest by commit too, and gives it to every compile of a file and every run as `--defer --defer-state <that manifest>`. dbt then decides: an upstream table that is not selected and is not built in your dbt target is read from prod. Run Changed still compares with the manifest of your own dbt target (`--state`). The parse connects to nothing; you need read access to the prod tables when a query runs. dbt Core and dbt v2 both do this. `--favor-state` is not passed.
* **A label after each `ref()` says where it was read from.** With defer to prod on, a `ref()` in a `.sql` file is followed by `→ deferred to prod` or `✓ dev · built in dev`, and a hover on it gives the two tables and a link to the one in prod. The labels come from the file's own last compile, so they are as old as its last save, and a file keeps them while you look at another. A `ref()` that dbt did not read (an ephemeral model, a model that is new on your branch, a branch of Jinja that was not taken) has no label. The age of a table in your dbt target (`built 12 min ago`) is shown once a hover or a completion has asked BigQuery for that table; no query is made for the labels. They show beside another dbt extension too. `vscode-dataform-tools.deferToProdEditorHints` turns them off.

## Where BigQuery jobs run

A dry run or a preview is a BigQuery job, and a job runs in a GCP project. There are two rules:

* **In a dbt project**, a job runs in the project of the table it is for, and BigQuery picks the location.
* **In a Dataform project**, a job runs in the default project of your credentials, as it always has.

The settings `gcpProjectId` and `gcpLocation` override both.

## A folder that is both a Dataform and a dbt project

A folder that has `workflow_settings.yaml` or `dataform.json`, and also `dbt_project.yml`, is two projects. There, the file says which project it belongs to:

| File | Project |
| --- | --- |
| `.sqlx` | Dataform |
| `.sql`, `.csv`, `.py` | dbt |
| YAML, `.js`, `.json` | The one that compiles an action from it. |
| A file that neither claims | The `vscode-dataform-tools.backend` setting. Left empty, the extension asks once and remembers the answer for the workspace. |

## Settings for dbt

| Setting | What it is |
| --- | --- |
| `vscode-dataform-tools.dbtExecutablePath` | The dbt to use, when you do not want the one the extension finds. |
| `vscode-dataform-tools.dbtTarget` | The dbt target for everyone who uses the workspace. Empty lets dbt choose. |
| `vscode-dataform-tools.dbtProdTarget` | The dbt target that builds prod. Defer to prod reads from it. Empty, defer to prod is not applied. |
| `vscode-dataform-tools.dbtVars` | dbt's `--vars`, for compiles and runs. |
| `vscode-dataform-tools.dbtProfilesDir` | dbt's `--profiles-dir`, for compiles and runs. |
| `vscode-dataform-tools.dbtCompileWithHooks` | Compile a dbt v2 project that has on-run hooks. The hooks then run on every save. |
| `vscode-dataform-tools.dbtEditorFeatures` | Go to definition, hover and completions in dbt files: `auto` (off beside another dbt extension), `on` or `off`. |
| `vscode-dataform-tools.dbtDryRunOnSave` | Compile and dry-run a dbt file on save while the panel is closed. Off, a save only parses. |
| `vscode-dataform-tools.backend` | Only for a folder that is both a Dataform and a dbt project: which one a file belongs to when its type does not say. |

## Remote hosts

The extension works over Remote SSH, in dev containers and in WSL, for both Dataform and dbt: it runs where your project is, and uses the dbt, the Dataform CLI and the credentials of that machine. A dev container with a dbt project is in [`.devcontainer/dbt`](../.devcontainer/dbt/README.md).

---

dbt and dbt Core are trademarks of dbt Labs, LLC. This extension is a community project. It is not affiliated with, endorsed by or sponsored by dbt Labs or Google.
