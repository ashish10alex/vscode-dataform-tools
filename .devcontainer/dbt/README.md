# A dev container with a dbt Project

For trying a release of the extension on a remote host before it ships. The window opens at the example dbt Project (`src/test/fixtures/xf-examples/projects/dbt`), with dbt-core and dbt v2 installed outside it.

## Open it

1. Install Docker and the Dev Containers extension.
2. In VS Code, open this repository and run **Dev Containers: Reopen in Container**. Select **dbt Project, to try the extension in**.
3. Wait for the set-up to finish. Its last lines say which dbt versions it installed.
4. In the container's terminal, sign in for BigQuery:

   ```bash
   gcloud auth application-default login
   ```

The example Project builds in the GCP project `alex-personal-dev-01`. To use another project, set `XF_GCP_PROJECT` before you sign in. Your account must have permission to create BigQuery jobs in that project, or each dry run shows "Access Denied".

## Which build is tried

The container installs the latest release from the Marketplace. To try a build that is not published:

1. On your machine, run `just package` (or `just download-vsix` for a build that CI made).
2. In the container window, open the Extensions view, select **...**, then **Install from VSIX...**, and select the file. The repository is at `/workspaces/<its name>`.

## Which dbt is used

| Engine | Where | How the extension finds it |
|---|---|---|
| dbt v2 | `~/.local/bin/dbt` | On `PATH`, or as a known install directory. This is the default. |
| dbt-core, with the BigQuery adapter | `/opt/dbt-core/bin/dbt` (also `dbt-core` on `PATH`) | Only by the setting `vscode-dataform-tools.dbtExecutablePath`. |

To try dbt-core, set `vscode-dataform-tools.dbtExecutablePath` to `/opt/dbt-core/bin/dbt`. The panel's **Project** tab says which dbt is in use and how it was found.

To see the page for a missing dbt, set the setting to a path that does not exist, and move `~/.local/bin/dbt` away.

## What to try

Each line is something the automated tests do not cover.

1. Open `models/marts/fct_orders.sql` and show the compiled query (the button in the editor title). The model is shown with its tests collapsed beneath it.
2. The header shows the dbt version, the dbt target `dev` and **Run → dev**.
3. Each section gets a size from its dry run. The **Schema** tab shows columns and types.
4. Select **Preview**. The rows appear in the results view at the bottom.
5. Save the file. The SQL is dimmed and marked outdated while dbt compiles.
6. Open `seeds/country_codes.csv`, `models/staging/_sources.yml`, `macros/audit.sql` and `dbt_project.yml`. Each shows a card, never a blank panel.
7. In the dbt target control, select `ci`. The Project compiles again. Select **Run**: a confirmation names `ci`. Cancel it. Select **Back to the default**.
8. Select **Run → dev**. A terminal named `dbt` runs `dbt build` from the Project's folder, and the panel shows the command with **Repeat**.
9. Write `{{ ref('nope') }}` in a model and save. The error card links to the line, and the line is marked in the editor. Undo and save: the marker goes.
10. Open the command palette and type "Dataform". The commands with the category "Dataform/dbt" are listed; "Dataform: Toggle defer to prod" is not.
11. Repeat steps 1 to 5 with dbt-core. On dbt-core each file is compiled when it is first shown.

The Project `../dbt-hooks` has on-run hooks. Open that folder to see the "Parsed, not compiled" notice with dbt v2. Do not select **Compile with hooks** unless you want the hooks to run against BigQuery.
