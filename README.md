<!-- markdownlint-disable MD041 -->
<div align="center">
  <h1>Tools for Dataform and dbt</h1>
</div>

A VS Code extension for [Dataform](https://github.com/dataform-co/dataform) and [dbt™](https://www.getdbt.com/) projects on BigQuery. Officially recommended [VS Code extension for Dataform](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) by Google[^1] ✨. Supports Dataform versions 2.9.x and 3.x, dbt Core 1.8 and later, and dbt v2, in all major operating systems. Works in: VS Code, Cursor, Antigravity.

<div align="center">
  <a href="https://www.youtube.com/watch?v=nb_OFh6YgOc">
    <img src="https://img.shields.io/badge/Watch_Installation_&_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" height="25">
  </a>
</div>
<br>

![compilation](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/compiled_query_preview_dark.png#gh-dark-mode-only)

---

## Installation

These steps are for a Dataform project. For a dbt project, see [dbt projects](#dbt-projects).

1. Install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode).
2. [Install Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)

   ```bash
   # requires nodejs & npm - https://nodejs.org/en/download
   npm i -g @dataform/cli
   ```

   Run `dataform compile` from the root of your Dataform project to ensure that you are able to use the cli.

3. [Install gcloud cli](https://cloud.google.com/sdk/docs/install) and run

   ```bash
   gcloud init
   gcloud auth application-default login
   gcloud config set project <project_id> #replace with your gcp project id
   ```

4. [Install sqlfluff](https://github.com/sqlfluff/sqlfluff) (optional, for formatting)

   ```bash
   # install python and run
   pip install sqlfluff
   ```

> [!NOTE]
> Trouble installing or looking for a specific customization ? Please see [FAQ section](FAQ.md), if you are still stuck, please [raise an issue here](https://github.com/ashish10alex/vscode-dataform-tools/issues)

* ️▶️ [Installation on Windows](https://www.youtube.com/watch?v=8AsSwzmzhV4)
* ️▶️ [Installation and demo on Ubuntu](https://www.youtube.com/watch?v=nb_OFh6YgOc)
* ️▶️ [Dataform workspace run using API demo and technical details](https://youtu.be/7Tt7KdssW3I?si=MjHukF26Y19kBPkj)

---

## dbt projects

From version 2.0.0 the extension works in a dbt project on BigQuery, beside Dataform. It uses the dbt you have installed: dbt Core 1.8 or later with the BigQuery adapter, or dbt v2. It installs nothing.

### Set-up

1. Install dbt, in one of these ways:

   ```bash
   pip install dbt-core dbt-bigquery
   ```

   ```bash
   brew install dbt-labs/dbt/dbt
   ```

2. Sign in for BigQuery, as for Dataform:

   ```bash
   gcloud auth application-default login
   ```

3. **Open the folder that has `dbt_project.yml`, or a folder above it.** The project of a file is the nearest folder above it that has a settings file, up to the folder you opened. So a dbt project inside a larger repository works with the repository open. The extension does not look above the folder you opened.

The extension looks for dbt in this order and uses the first it finds: the `dbtExecutablePath` setting, `$DBT_BIN`, the project's `.venv` then `venv`, the environment the Python extension has selected, `PATH`, then common install directories. The panel's **Project** tab says which dbt is in use and how it was found.

### What works

| | In a dbt project |
| --- | --- |
| Compiled query | The model in the editor with the tests that read it, each in its own section. Hooks are shown as written. |
| Dry run | Size and cost of each compiled query, and BigQuery's error at its line and column. |
| Schema | The columns and types of the compiled query, with the descriptions from your YAML. |
| Preview | Runs the compiled query and shows the rows. For a test, the rows that fail it. |
| Run | `dbt build` in a terminal, for the file, with dependencies, with dependents, as a full refresh, or by tag. |
| Run Changed | The actions that differ from the merge-base with the default branch, as dbt finds them (`state:modified`). The panel lists them by file with why each changed, and runs all of them or the files you tick. |
| dbt target | Shown in the panel. Pick another there; the choice is yours alone and is kept for the workspace. |
| Compile errors | Shown in the panel with a link to the file, and marked in the editor where dbt gave a line. |
| Dry-run errors | BigQuery's errors are marked in the editor too. See [In the editor](#in-the-editor). |
| Go to definition | From a `ref()` to its model, seed or snapshot; from a `source()` to its table in the YAML file; from a macro call to its `{% macro %}` line. Also from a `ref()` or `source()` written in a YAML file. |
| Hover | On a `ref()` or `source()`: the table in BigQuery, its description, partitioning, row count and columns. On a column name: its type and description, in each table the file reads that has it. |
| Completions | Model, seed and snapshot names inside `ref('`; sources and their tables inside `source('`; column names after an alias and a dot, and of every table the file reads. |
| Other files | A seed, a file of sources, a macro file and `dbt_project.yml` each show what they are. |
| Dependency graph | **Graph** in the panel, or *Show dependency graph*. Every model, seed, snapshot, source, test and exposure, centred on the file in the editor. Tests are hidden until you tick *Show tests*. Read from a parse of the project, so nothing needs compiling first. |

Not in a dbt project yet: the dependency inspector, column lineage, defer to prod, running through an API, the cost estimate of a tag, formatting, and hover and completions for macros.

### In the editor

Go to definition, hover and completions work in the `.sql` files of a dbt project as soon as one is open in the editor: the extension parses the project then, in the background, without the panel.

* **The language of your `.sql` files is not changed.** The extension claims no language, grammar or file icon for `.sql`. It answers for the files under the folder that has `dbt_project.yml`, whatever SQL extension colours them.
* **Beside another dbt extension these features stand down.** VS Code shows what every extension offers, so two dbt extensions would give each hover and suggestion twice. While the dbt extension of dbt Labs or Power User for dbt is installed and enabled, go to definition, hover and completions of this extension are off, and the output channel says so. Set `vscode-dataform-tools.dbtEditorFeatures` to `on` to have both, or to `off` to never have these.
* **Schemas are read from BigQuery once per compile.** The first hover or completion that needs a table asks BigQuery for it. The answer is kept in memory until the project is next parsed or compiled, so a save reads it afresh.
* **Dry-run errors.** BigQuery reports an error at a line of the compiled query. When that line is in your file unchanged, the error is marked there. When Jinja built the line, the error is marked on the first line of the file and says where it is in the compiled query; the panel shows it in place. An error in a generic test is marked on the line of the YAML file that declares the test.
* **A save without the panel.** A save opens the panel unless `showCompiledQueryInVerticalSplitOnSave` is off. When the panel stays closed, a save still compiles the file and dry-runs its model and tests, so the errors are marked. Set `vscode-dataform-tools.dbtDryRunOnSave` to `false` to have such a save only parse the project. Without BigQuery credentials nothing is dry-run and nothing is marked.

### How it compiles

* **dbt Core and dbt v2** compile the file you are looking at, with its tests, and never the whole project. A file you have not looked at since the last save is compiled when you open it.
* **A dbt v2 project with `on-run-start` or `on-run-end` hooks is only parsed**, because dbt v2 runs those hooks against the warehouse on every compile. The panel then shows the SQL as written and offers to compile with hooks.
* dbt writes its artifacts for these compiles into the extension's storage, not into your project's `target/`.
* **Run Changed needs no manifest from you.** The extension takes the merge-base with `defaultBranch` out of git, parses it with your dbt, dbt target and variables, and keeps that manifest by commit in its own storage. It runs `dbt build --select state:modified --state <that manifest>`. The list is worked out when you open the button's popover, not in the background. It does not defer: an upstream table that is not built in your dbt target must be built first, which the `+Deps` switch does.

### Where BigQuery jobs run

A dry run or a preview is a BigQuery job, and a job runs in a GCP project. There are two rules:

* **In a dbt project**, a job runs in the project of the table it is for, and BigQuery picks the location.
* **In a Dataform project**, a job runs in the default project of your credentials, as it always has.

The settings `gcpProjectId` and `gcpLocation` override both.

### Settings for dbt

| Setting | What it is |
| --- | --- |
| `vscode-dataform-tools.dbtExecutablePath` | The dbt to use, when you do not want the one the extension finds. |
| `vscode-dataform-tools.dbtTarget` | The dbt target for everyone who uses the workspace. Empty lets dbt choose. |
| `vscode-dataform-tools.dbtVars` | dbt's `--vars`, for compiles and runs. |
| `vscode-dataform-tools.dbtProfilesDir` | dbt's `--profiles-dir`, for compiles and runs. |
| `vscode-dataform-tools.dbtCompileWithHooks` | Compile a dbt v2 project that has on-run hooks. The hooks then run on every save. |
| `vscode-dataform-tools.dbtEditorFeatures` | Go to definition, hover and completions in dbt files: `auto` (off beside another dbt extension), `on` or `off`. |
| `vscode-dataform-tools.dbtDryRunOnSave` | Compile and dry-run a dbt file on save while the panel is closed. Off, a save only parses. |
| `vscode-dataform-tools.backend` | Only for a folder that is both a Dataform and a dbt project: which one a file belongs to when its type does not say. |

### Remote hosts

The extension works over Remote SSH, in dev containers and in WSL, for both Dataform and dbt: it runs where your project is, and uses the dbt, the Dataform CLI and the credentials of that machine. A dev container with a dbt project is in [`.devcontainer/dbt`](.devcontainer/dbt/README.md).

---

## ✨ Features / Previews

<table>
  <thead>
    <tr>
      <th>Feature</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="#compilation">Compiled Query & Dry run stats</a></td>
      <td>Compiled query with dry run stats in a vertical split, with the option to switch between backends for compilation (CLI or Dataform API)</td>
    </tr>
    <tr>
      <td><a href="#diagnostics">Inline diagnostics on <code>.sqlx</code> file</a> 🚨</td>
      <td>Native LSP like experience with diagnostics being directly put on sqlx file</td>
    </tr>
    <tr>
      <td><a href="#depgraph">Dependancy graph</a></td>
      <td>Interative dependancy graph with external sources higlighted in distinct colors</td>
    </tr>
    <tr>
      <td><a href="#preview_query_results">Preview query results</a></td>
      <td>Preview query results in a table by running the file</td>
    </tr>
    <tr>
      <td>Defer to production</td>
      <td>Develop without rebuilding upstream tables in dev. Like dbt's <code>--defer</code>, automatically resolves unbuilt dependencies against production tables (via <code>vscode-dataform-tools.prodCompilerOptions</code>) for dry runs, previews, and runs (via proxy views), with in-editor hints on <code>${ref()}</code></td>
    </tr>
    <tr>
      <td>Run changed actions</td>
      <td>Run only the actions whose compiled SQL or materialization changed vs the default branch, like dbt's <code>state:modified</code>. Includes interactive file selection and daily-cached merge-base compiles</td>
    </tr>
    <tr>
      <td>Column impact &amp; lineage</td>
      <td>Inspect column-level lineage and downstream impact directly from the compiled view. Highlights columns dropped or retyped against prod and maps downstream consumers via Dataplex lineage, with PR markdown export</td>
    </tr>
    <tr>
      <td><a href="#hover">BigQuery hover provider</a></td>
      <td>Hover definition for tables, columns, column descriptions, types and common BigQuery functions</td>
    </tr>
    <tr>
      <td><a href="#cost_estimator">Cost estimator</a> </td>
      <td>Estimate the cost of running a Tag</td>
    </tr>
    <tr>
      <td><a href="#definition">Go to definition</a></td>
      <td>Go to definition for source in <code>$ref{("my_source")}</code> and javascript blocks in <code>.sqlx</code> files</td>
    </tr>
    <tr>
      <td><a href="#autocomplete">Auto-completion</a></td>
      <td>
        <ul>
          <li>Column names of current model</li>
          <li>Dependencies and declarations in <code>${ref("..")}</code> trigger when <code>$</code> character is typed</li>
          <li>Dependencies when <code>"</code> or <code>'</code> is typed inside the config block which has <code>dependencies</code> keyword is in the line prefix</li>
          <li><code>tags</code> when <code>"</code> or <code>'</code> is typed inside the config block which has <code>tags</code> keyword is in the line prefix</li>
        </ul>
      </td>
    </tr>
    <tr>
      <td><a href="#codeactions">Code actions</a></td>
      <td>Apply dry run suggestions at the speed of thought</td>
    </tr>
    <tr>
      <td>Config block IntelliSense</td>
      <td>Completion, hover docs and as-you-type warnings with quick fixes for <code>config {}</code> options, based on the action <code>type</code>. Catches typos like <code>partitonBy</code> and options that don't apply, like <code>uniqueKey</code> on a view</td>
    </tr>
    <tr>
      <td><a href="#filetagruns">Run file(s)/tag(s)</a></td>
      <td>Run file(s)/tag(s), optionally with dependencies/dependents/full refresh using cli or <a href="https://cloud.google.com/nodejs/docs/reference/dataform/latest/dataform/v1beta1.dataformclient">Dataform API</a></td>
    </tr>
    <tr>
      <td><a href="#formatting">Format using Sqlfluff</a> 🪄</td>
      <td>Format <code>.sqlx</code> files using <a href="https://github.com/sqlfluff/sqlfluff">sqlfluff</a></td>
    </tr>
    <tr>
      <td><a href="#snippets">BigQuery snippets</a></td>
      <td>Code snippets for generic BigQuery functions taken from <a href="https://github.com/shinichi-takii/vscode-language-sql-bigquery">vscode-language-sql-bigquery</a> extension</td>
    </tr>
    <tr>
      <td><a href="#tests">Tests</a></td>
      <td>Support to view and run tests. Running test is currently only supported via Dataform CLI.</td>
    </tr>
    <tr>
      <td><a href="#dependency_inspector">Dependency Inspector</a></td>
      <td>Inspect model dependencies, apply filters and run dry runs/queries</td>
    </tr>
  </tbody>
</table>

### <a id="diagnostics">Inline diagnostics errors on `.sqlx` files</a>

![diagnostics](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/diagnostics_dark.png#gh-dark-mode-only)

### <a id="depgraph">Dependency graph</a>

![depgraph](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/dependancy_tree_dark.png#gh-dark-mode-only)

### <a id="preview_query_results">Preview query results</a>

<!-- ![preview_query_results](/media/images/preview_query_results.png) -->
![preview_query_results](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/preview_query_results_dark.png#gh-dark-mode-only)

### <a id="hover">BigQuery hover definition provider</a>

Hover over tables, columns, column types and BigQuery functions to see their documentation, syntax, and examples making it easier to understand and use them correctly without leaving your editor.

![table_hover](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/table_hover_dark.png#gh-dark-mode-only)

### <a id="cost_estimator">Estimate cost of running a Tag</a>

![cost_estimator](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/tag_cost_estimator_dark.png#gh-dark-mode-only)

### <a id="definition">Go to definition</a>

Go to definition for source in `$ref{("my_source")}`. Takes you to `my_source.sqlx` or `sources.js` at the line where `my_source` is defined. There is also support for go to definiton
from a javascript variable/module from a `.sqlx` file to `js` block or `.js` file where the virable or module declaration exsists

![go-to-definition](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/go_to_definition.gif)

### <a id="autocomplete">Autocomplete model, tags, dependencies</a>

Auto completion of declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed and `dependencies` and `tags` in config block when `"` or `'` is typed.

![auto-completion](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/sources_autocompletion.gif)

### <a id="formatting">Formatting using sqlfluff</a>

![formatting](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/formatting.gif)

### <a id="dependency_inspector">Dependency Inspector</a>

Interactive inspector to explore dependencies, apply a common filter across all nested dependencies and perform dry runs or run the queries in BigQuery.

![dependency_inspector_one](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/dependency_inspector_one.png#gh-dark-mode-only)

![dependency_inspector_two](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/dependency_inspector_two.png#gh-dark-mode-only)

---

## Commands

Most features can be invoked via the Command Palette by pressing <kbd>CTRL</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd> or <kbd>CMD</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd> on Mac and searching for the following. Commands in the category "Dataform/dbt" work in both kinds of project; the others are for Dataform and are not listed while a file of a dbt project is in focus. These key bindings can also be attached to a keybinding to further streamline your workflow.

<table>
  <thead>
    <tr>
      <th>Command</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>vscode-dataform-tools.showCompiledQueryInWebView</code></td>
      <td>Show compiled Query in web view</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFile</code></td>
      <td>Run current file</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFileWtDeps</code></td>
      <td>Run current file with dependencies</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFileWtDownstreamDeps</code></td>
      <td>Run current file with dependents</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runQuery</code></td>
      <td>Preview query results</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runTag</code></td>
      <td>Run a tag</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runTagWtDeps</code></td>
      <td>Run a tag with dependencies</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runTagWtDownstreamDeps</code></td>
      <td>Run a tag with dependents</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runFilesTagsWtOptions</code></td>
      <td>Run file(s) / tag(s) with options</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runFilesTagsWtOptionsApi</code></td>
      <td>Run file(s) / tag(s) with options using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runFilesTagsWtOptionsInRemoteWorkspace</code></td>
      <td>Run file(s) / tag(s) with options using API in remote workspace [beta]</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.dependencyGraphPanel</code></td>
      <td>Show dependency graph</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runTagWtApi</code></td>
      <td>Run a tag using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runTagWtDependenciesApi</code></td>
      <td>Run tag with dependencies using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFileWtApi</code></td>
      <td>Run current file using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFileWtDependenciesApi</code></td>
      <td>Run current file with dependencies using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runCurrentFileWtDependentsApi</code></td>
      <td>Run current file with dependents using API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.clearExtensionCache</code></td>
      <td>Clear extension cache</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.openLastWorkflowExecution</code></td>
      <td>Open last workflow execution in browser</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.rerunLastExecution</code></td>
      <td>Rerun last execution (same files/tags, options and mode as the previous run)</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runChangedActions</code></td>
      <td>Run only the actions changed vs the default branch, after previewing them. In a keybinding, pass <code>"args": { "includeDependents": true, "fullRefresh": false }</code> (also <code>includeDependencies</code>) to skip the prompts</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.runChangedActionsApi</code></td>
      <td>Same as above, using the Dataform API</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.toggleDeferToProd</code></td>
      <td>Toggle defer to prod</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.removeProxyViews</code></td>
      <td>Remove defer to prod proxy views</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.columnLineage</code></td>
      <td>Show column lineage and impact</td>
    </tr>
    <tr>
      <td><code>vscode-dataform-tools.columnImpactOfChanges</code></td>
      <td>Show column impact of branch changes</td>
    </tr>
  </tbody>
</table>

---

## Products

<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Registry</th>
      <th>Badge</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="2">Dataform Tools</td>
      <td><a href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode">VS Code marketplace</a></td>
      <td>
        <a href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode">
          <img src="https://img.shields.io/visual-studio-marketplace/v/ashishalex.dataform-lsp-vscode" alt="VS Code marketplace">
          <img src="https://img.shields.io/vscode-marketplace/i/ashishalex.dataform-lsp-vscode.svg" alt="Downloads">
        </a>
      </td>
      <td rowspan="2">VS Code extension — dependency graph, compiled query preview, dry-run stats, inline diagnostics, go-to-definition, autocomplete, formatting, and more. Same build is published to both the VS Code marketplace and Open VSX (for forks such as <a href="https://cursor.com">Cursor</a> and <a href="https://antigravity.google/">Antigravity</a>).</td>
    </tr>
    <tr>
      <td><a href="https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode">Open VSX marketplace</a></td>
      <td>
        <a href="https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode">
          <img src="https://img.shields.io/open-vsx/v/ashishalex/dataform-lsp-vscode" alt="Open VSX Version">
          <img src="https://img.shields.io/open-vsx/dt/ashishalex/dataform-lsp-vscode" alt="Open VSX Version">
        </a>
      </td>
    </tr>
    <tr>
      <td><code>@ashishalex/dataform-graph</code></td>
      <td><a href="https://www.npmjs.com/package/@ashishalex/dataform-graph">npm</a></td>
      <td>
        <a href="https://www.npmjs.com/package/@ashishalex/dataform-graph">
          <img src="https://img.shields.io/npm/v/%40ashishalex%2Fdataform-graph" alt="NPM Version">
          <img src="https://img.shields.io/npm/dm/%40ashishalex%2Fdataform-graph" alt="NPM Downloads">
        </a>
      </td>
      <td><code>dataform-graph</code> CLI — serves the dependency graph in your browser; no VS Code required (<a href="./packages/dataform-graph-cli/README.md">readme</a>).</td>
    </tr>
    <tr>
      <td><code>@ashishalex/dataform-tools</code></td>
      <td><a href="https://www.npmjs.com/package/@ashishalex/dataform-tools">npm</a></td>
      <td>
        <a href="https://www.npmjs.com/package/@ashishalex/dataform-tools">
          <img src="https://img.shields.io/npm/v/%40ashishalex%2Fdataform-tools" alt="NPM Version">
        </a>
      </td>
      <td>Programmatic wrapper around the <code>@google-cloud/dataform</code> npm package.</td>
    </tr>
    <tr>
      <td><code>dataform-tools</code></td>
      <td><a href="https://pypi.org/project/dataform-tools/">PyPI</a></td>
      <td>
        <a href="https://pypi.org/project/dataform-tools/">
          <img src="https://img.shields.io/pypi/v/dataform-tools" alt="PyPI - Version">
        </a>
      </td>
      <td>Programmatic wrapper around the <code>google-cloud-dataform</code> Python package.</td>
    </tr>
  </tbody>
</table>

---

## Support & Feedback

If this extension saves you time and makes working with Dataform or dbt easier, consider supporting the project:

* 📝 **Leave a review** on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode)
* ☕ **Buy me a coffee**:
  <a href="https://buymeacoffee.com/ashishalexj">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" height="25">
  </a>

---

## Known Issues

* [ ] Features such as go to definition / dependancy graph might not work with consistantly with `${ref("dataset", "table")}` or when it is multiline or a different format works best with `${ref('table_name')}` format

## TODO

* [ ] Handle case where user is not connected to internet or on vpn where network request for dry run cannot be made

---

dbt and dbt Core are trademarks of dbt Labs, LLC. This extension is a community project. It is not affiliated with, endorsed by or sponsored by dbt Labs or Google.

[^1]: [Link to confirmation of official recommendation by Google:](https://github.com/dataform-co/dataform/blob/main/vscode/README.md). Note that this is a community-led project and not an officially supported Google product.
