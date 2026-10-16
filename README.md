<!-- markdownlint-disable MD041 -->
<div align="center">
  <h1>Tools for Dataform and dbt</h1>
</div>

A VS Code extension for [Dataform](https://github.com/dataform-co/dataform) and [dbt™](https://www.getdbt.com/) projects on BigQuery. Officially recommended [VS Code extension for Dataform](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) by Google[^1] ✨. Supports Dataform versions 2.9.x and 3.x, dbt Core 1.8 and later, and dbt v2, in all major operating systems. Works in: VS Code, Cursor, Antigravity.

<div align="center">
  <a href="https://www.youtube.com/watch?v=nb_OFh6YgOc">
    <img src="https://img.shields.io/badge/Watch_Installation_&_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" height="25">
  </a>
  <a href="https://dataformtools.com">
    <img src="https://img.shields.io/badge/Try_the_live_demo-2563EB?style=for-the-badge&logoColor=white" alt="Try the live demo" height="25">
  </a>
</div>
<br>

![The compiled query of a Dataform model beside its file, with what a dry run says it will scan and cost](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_compiled_query_dataform_dark.png#gh-dark-mode-only)
![The compiled query of a Dataform model beside its file, with what a dry run says it will scan and cost](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_compiled_query_dataform_light.png#gh-light-mode-only)

![The compiled query of a dbt model beside its file: the same panel a Dataform file has](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_compiled_query_dbt_dark.png#gh-dark-mode-only)
![The compiled query of a dbt model beside its file: the same panel a Dataform file has](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_compiled_query_dbt_light.png#gh-light-mode-only)

These are pictures. You can click through the real panel, with made-up data, at [dataformtools.com](https://dataformtools.com).

---

## Features

A dash means not in a dbt project yet. Each name links to its description at [dataformtools.com/features](https://dataformtools.com/features).

| Feature | Dataform | dbt | What it does |
| --- | :---: | :---: | --- |
| [Compiled query and dry run](https://dataformtools.com/features#compilation) | ✅ | ✅ | Beside the file on save, with the size and cost of a dry run and the schema of the result |
| [Errors in the editor](https://dataformtools.com/features#diagnostics) | ✅ | ✅ | Compile errors and BigQuery's dry-run errors, on the line you wrote |
| [Preview query results](https://dataformtools.com/features#preview_query_results) | ✅ | ✅ | Runs the compiled query and shows its rows; for a dbt test, the rows that fail it |
| Scratch queries | ✅ | ✅ | `New scratch query` opens a file for ad hoc BigQuery SQL: run it with Cmd/Ctrl+Enter, with a dry run on save. `Query table in scratch query` starts one that selects from the open model's table |
| [Run files and tags](https://dataformtools.com/features#filetagruns) | ✅ | ✅ | With dependencies, dependents or a full refresh. Dataform: the CLI or the Dataform API. dbt: `dbt build` |
| [Run changed actions](https://dataformtools.com/features#run_changed_actions) | ✅ | ✅ | Runs only what differs from the default branch, like dbt's `state:modified`, with a tick per file |
| [Tests](https://dataformtools.com/features#test_actions) | ✅ | ✅ | Dataform assertions and `test` actions; the dbt tests of a model, beside its compiled query |
| [Dependency graph](https://dataformtools.com/features#depgraph) | ✅ | ✅ | The whole project as a graph, centred on the file in the editor |
| [Hover](https://dataformtools.com/features#hover) | ✅ | ✅ | A table's kind, location, description, partition, row count and columns; a column's type and description |
| [Go to definition](https://dataformtools.com/features#definition) | ✅ | ✅ | From a `ref()` to its file. Dataform: also JavaScript variables and modules. dbt: also `source()` and macro calls |
| [Completions](https://dataformtools.com/features#autocomplete) | ✅ | ✅ | Names inside `ref()` and `source()`, and the columns of the tables the file reads |
| [Column search](https://dataformtools.com/features#column_search) | ✅ | ✅ | Pick a column of a table by name, type or description |
| [Defer to production](https://dataformtools.com/features#defer_to_prod) | ✅ | ✅ | Reads upstream tables that are not built in dev from production, like dbt's `--defer`. In a dbt project dbt does it, and `dbtProdTarget` names prod |
| [Column lineage and impact](https://dataformtools.com/features#column_lineage) | ✅ | — | Columns dropped or retyped against prod, and who reads them downstream, from Dataplex |
| [Dependency inspector](https://dataformtools.com/features#dependency_inspector) | ✅ | — | One filter across a model and its dependencies, then dry run or run each |
| [Cost estimator](https://dataformtools.com/features#cost_estimator) | ✅ | — | What a tag will cost before you run it |
| [BigQuery jobs of a run](https://dataformtools.com/features#workflow_invocations) | ✅ | ✅ | Each job of an API or CLI run, or of a `dbt build`, live: state, duration, bytes billed and cost |
| [Formatting](https://dataformtools.com/features#formatting) | ✅ | — | Formats `.sqlx` files with [sqlfluff](https://github.com/sqlfluff/sqlfluff) |
| [Code actions](https://dataformtools.com/features#codeactions) | ✅ | — | Applies the fix a dry run suggests |
| Config block IntelliSense | ✅ | — | Completion, hover and warnings for `config {}` options, by action type |

The pictures below are taken from the [live demo](https://dataformtools.com) by `just website-demo`, of the extension's own panel.

### Errors, before anything runs

A dry run checks every save against BigQuery, and what it rejects is marked on the line you wrote, listed in Problems and told in the panel.

![A model with a typo: the dry-run error on its line, in Problems and in the compiled query panel](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_errors_dark.png#gh-dark-mode-only)
![A model with a typo: the dry-run error on its line, in Problems and in the compiled query panel](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_errors_light.png#gh-light-mode-only)

### Run a file and preview its rows

Run a file with the Dataform CLI, the Dataform API or `dbt build`, and preview the rows of its query.

![The panel after a run, with its bytes billed, and the query results below](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_run_and_results_dark.png#gh-dark-mode-only)
![The panel after a run, with its bytes billed, and the query results below](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_run_and_results_light.png#gh-light-mode-only)

### Hover over a table

The hover of a table is the same in a Dataform and a dbt project: its kind, location, description, partition, row count and columns.

![The card shown over a ref(): the table, its kind, location, description and columns](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_hover_dark.png#gh-dark-mode-only)
![The card shown over a ref(): the table, its kind, location, description and columns](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_hover_light.png#gh-light-mode-only)

### Defer to production

Each `${ref()}` says whether its table is read from production or is built in dev.

![Defer to prod on, with prod in a Google Cloud project of its own: beside each ref(), whether that table is read from prod or is built in dev; the panel lists the same](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_defer_to_prod_dark.png#gh-dark-mode-only)
![Defer to prod on, with prod in a Google Cloud project of its own: beside each ref(), whether that table is read from prod or is built in dev; the panel lists the same](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_defer_to_prod_light.png#gh-light-mode-only)

### Run changed actions

The panel lists the actions that differ from the default branch, and runs all of them or the files you tick.

![The Changed list in the compiled query panel: a new table and a view whose SQL changed, against the default branch](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_run_changed_dark.png#gh-dark-mode-only)
![The Changed list in the compiled query panel: a new table and a view whose SQL changed, against the default branch](https://raw.githubusercontent.com/ashish10alex/vscode-dataform-tools/main/media/images/demo_run_changed_light.png#gh-light-mode-only)

---

## Installation

1. Install the extension from the [marketplace](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode).

2. Install the CLI of your tool. The extension uses the one you have and installs nothing.

   | Dataform | dbt |
   | --- | --- |
   | `npm i -g @dataform/cli` | `pip install dbt-core dbt-bigquery` or `brew install dbt-labs/dbt/dbt` |
   | Needs [Node.js](https://nodejs.org/en/download). See [Dataform CLI](https://cloud.google.com/dataform/docs/use-dataform-cli). | dbt Core 1.8 or later, or dbt v2. See [which dbt is used](docs/dbt.md#which-dbt-is-used). |

3. [Install gcloud cli](https://cloud.google.com/sdk/docs/install) and sign in for BigQuery:

   ```bash
   gcloud init
   gcloud auth application-default login
   gcloud config set project <project_id> #replace with your gcp project id
   ```

4. **Open the folder that has `workflow_settings.yaml`, `dataform.json` or `dbt_project.yml`, or a folder above it.** The project of a file is the nearest folder above it that has a settings file, up to the folder you opened. So a project inside a larger repository works with the repository open. The extension does not look above the folder you opened.

5. Optional, to format `.sqlx` files: `pip install sqlfluff`.

> [!NOTE]
> Trouble installing or looking for a specific customization ? Please see [FAQ section](FAQ.md), if you are still stuck, please [raise an issue here](https://github.com/ashish10alex/vscode-dataform-tools/issues)

Videos: [installation on Windows](https://www.youtube.com/watch?v=8AsSwzmzhV4), [installation and demo on Ubuntu](https://www.youtube.com/watch?v=nb_OFh6YgOc), [a Dataform workspace run using the API](https://youtu.be/7Tt7KdssW3I?si=MjHukF26Y19kBPkj).

## Documentation

* [dbt projects](docs/dbt.md): which dbt is used, what each feature does in a dbt project, how it compiles, where BigQuery jobs run, a folder that is both kinds of project, settings, and remote hosts (Remote SSH, dev containers, WSL).
* [Dataform projects](docs/dataform.md): the BigQuery jobs of a CLI run, and Run Changed from a keybinding.
* [FAQ](FAQ.md): answers to common problems.
* [dataformtools.com/features](https://dataformtools.com/features): every feature, in words.

## Commands

Every command is in the Command Palette (<kbd>CTRL</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd>, or <kbd>CMD</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd> on Mac). Commands in the category "Dataform/dbt" work in both kinds of project; those in "Dataform" are for Dataform and are not listed while a file of a dbt project is in focus. The extension's **Feature Contributions** tab lists them with their ids, for keybindings.

---

## Products

| Name | Registry | Version | Description |
| --- | --- | --- | --- |
| Dataform Tools | [VS Code marketplace](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) | [![VS Code marketplace](https://img.shields.io/visual-studio-marketplace/v/ashishalex.dataform-lsp-vscode)![Downloads](https://img.shields.io/vscode-marketplace/i/ashishalex.dataform-lsp-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) | This extension. |
| Dataform Tools | [Open VSX](https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode) | [![Open VSX version](https://img.shields.io/open-vsx/v/ashishalex/dataform-lsp-vscode)![Open VSX downloads](https://img.shields.io/open-vsx/dt/ashishalex/dataform-lsp-vscode)](https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode) | The same build, for forks such as [Cursor](https://cursor.com) and [Antigravity](https://antigravity.google/). |
| `@ashishalex/dataform-graph` | [npm](https://www.npmjs.com/package/@ashishalex/dataform-graph) | [![NPM version](https://img.shields.io/npm/v/%40ashishalex%2Fdataform-graph)![NPM downloads](https://img.shields.io/npm/dm/%40ashishalex%2Fdataform-graph)](https://www.npmjs.com/package/@ashishalex/dataform-graph) | `dataform-graph` CLI: serves the dependency graph in your browser, without VS Code ([readme](./packages/dataform-graph-cli/README.md)). |
| `@ashishalex/dataform-tools` | [npm](https://www.npmjs.com/package/@ashishalex/dataform-tools) | [![NPM version](https://img.shields.io/npm/v/%40ashishalex%2Fdataform-tools)](https://www.npmjs.com/package/@ashishalex/dataform-tools) | Programmatic wrapper around the `@google-cloud/dataform` npm package. |
| `dataform-tools` | [PyPI](https://pypi.org/project/dataform-tools/) | [![PyPI version](https://img.shields.io/pypi/v/dataform-tools)](https://pypi.org/project/dataform-tools/) | Programmatic wrapper around the `google-cloud-dataform` Python package. |

---

## Support & Feedback

If this extension saves you time and makes working with Dataform or dbt easier, consider supporting the project:

* 📝 **Leave a review** on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode)
* ☕ **Buy me a coffee**:
  <a href="https://buymeacoffee.com/ashishalexj">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" height="25">
  </a>

---

dbt and dbt Core are trademarks of dbt Labs, LLC. This extension is a community project. It is not affiliated with, endorsed by or sponsored by dbt Labs or Google.

[^1]: [Link to confirmation of official recommendation by Google:](https://github.com/dataform-co/dataform/blob/main/vscode/README.md). Note that this is a community-led project and not an officially supported Google product.
