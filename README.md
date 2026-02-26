<!-- markdownlint-disable MD041 -->
<div align="center">
  <h1>Dataform Tools</h1>
</div>

<b>Officially recommended VS Code extension for Dataform by Google[^1]</b> ✨. Supports all major operating systems and both Dataform versions 2.9.x and 3.x. Works in: <a href="https://code.visualstudio.com/">VS Code</a>, <a href="https://cursor.com">Cursor</a>, <a href="https://antigravity.google/">Antigravity</a>.

<div align="center">
  <a href="https://www.youtube.com/watch?v=nb_OFh6YgOc">
    <img src="https://img.shields.io/badge/Watch_Installation_&_Demo-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" height="25" style="margin-right: 10px;">
  </a>
  <a href="https://buymeacoffee.com/ashishalexj">
    <img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy me a coffee" height="25">
  </a>
</div>
<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/compiled_query_preview_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/compiled_query_preview_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="compilation" src="media/images/compiled_query_preview.png">
</picture>

---

## Installation

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
      <td>Compiled query with dry run stats in a vertical split</td>
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
  </tbody>
</table>

### <a id="diagnostics">Inline diagnostics errors on `.sqlx` files</a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/diagnostics_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/diagnostics_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="diagnostics" src="media/images/diagnostics.png">
</picture>

### <a id="depgraph">Dependency graph</a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/dependancy_tree_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/dependancy_tree_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="depgraph" src="media/images/dependancy_tree.png">
</picture>

### <a id="preview_query_results">Preview query results</a>

<!-- ![preview_query_results](/media/images/preview_query_results.png) -->
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/preview_query_results_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/preview_query_results_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="preview_query_results" src="media/images/preview_query_results.png">
</picture>

### <a id="hover">BigQuery hover definition provider</a>

Hover over tables, columns, column types and BigQuery functions to see their documentation, syntax, and examples making it easier to understand and use them correctly without leaving your editor.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/table_hover_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/table_hover_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="table_hover" src="media/images/table_hover_dark.png">
</picture>

### <a id="cost_estimator">Estimate cost of running a Tag</a>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="media/images/tag_cost_estimator_dark.png">
  <source media="(prefers-color-scheme: light)" srcset="media/images/tag_cost_estimator_light.png">
  <!-- Fallback image if picture is not supported -->
  <img alt="cost_estimator" src="media/images/tag_cost_estimator.png">
</picture>

### <a id="definition">Go to definition</a>

Go to definition for source in `$ref{("my_source")}`. Takes you to `my_source.sqlx` or `sources.js` at the line where `my_source` is defined. There is also support for go to definiton
from a javascript variable/module from a `.sqlx` file to `js` block or `.js` file where the virable or module declaration exsists

![go-to-definition](media/images/go_to_definition.gif)

### <a id="autocomplete">Autocomplete model, tags, dependencies</a>

Auto completion of declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed and `dependencies` and `tags` in config block when `"` or `'` is typed.

![auto-completion](media/images/sources_autocompletion.gif)

### <a id="formatting">Formatting using sqlfluff</a>

![formatting](media/images/formatting.gif)

---

## Commands

Most features can be invoked via the Command Palette by pressing <kbd>CTRL</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd> or <kbd>CMD</kbd> + <kbd>SHIFT</kbd> + <kbd>P</kbd> on Mac and searching for the following. These key bindings can also be attached to a keybinding to further streamline your workflow.

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
  </tbody>
</table>

---

## Products

<table>
  <thead>
    <tr>
      <th>Registry</th>
      <th>Badge </th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode">VS Code marketplace</a></td>
      <td>
        <a href="https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode">
          <img src="https://img.shields.io/visual-studio-marketplace/v/ashishalex.dataform-lsp-vscode" alt="VS Code marketplace">
          <img src="https://img.shields.io/vscode-marketplace/i/ashishalex.dataform-lsp-vscode.svg" alt="Downloads">
        </a>
      </td>
      <td>Marketplace for VS Code editor</td>
    </tr>
    <tr>
      <td><a href="https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode">Open VSX marketplace</a></td>
      <td>
        <a href="https://open-vsx.org/extension/ashishalex/dataform-lsp-vscode">
          <img src="https://img.shields.io/open-vsx/v/ashishalex/dataform-lsp-vscode" alt="Open VSX Version">
          <img src="https://img.shields.io/open-vsx/dt/ashishalex/dataform-lsp-vscode" alt="Open VSX Version">
        </a>
      </td>
      <td>Marketplace for VS Code forks such as <a href="https://cursor.com">Cursor</a> and <a href="https://antigravity.google/">Antigravity</a></td>
    </tr>
    <tr>
      <td> <a href="https://pypi.org/project/dataform-tools/">PyPi</a></td>
      <td>
        <a href="https://pypi.org/project/dataform-tools/">
          <img src="https://img.shields.io/pypi/v/dataform-tools" alt="PyPI - Version">
        </a>
      </td>
      <td>wrapper for google-cloud-dataform python package</td>
    </tr>
    <tr>
      <td> <a href="https://www.npmjs.com/package/@ashishalex/dataform-tools">npm</a></td>
      <td>
        <a href="https://www.npmjs.com/package/@ashishalex/dataform-tools">
          <img src="https://img.shields.io/npm/v/%40ashishalex%2Fdataform-tools" alt="NPM Version">
        </a>
      </td>
      <td>wrapper for google-cloud/dataform npm package </td>
    </tr>
  </tbody>
</table>

---

## Known Issues

* [ ] Features such as go to definition / dependancy graph might not work with consistantly with `${ref("dataset", "table")}` or when it is multiline or a different format works best with `${ref('table_name')}` format

## TODO

* [ ] Add option to include dependents / dependencies when running cost estimator for tag
* [ ] Add hover docs for config block elements. e.g. Assertions, type etc
* [ ] Handle case where user is not connected to internet or on vpn where network request for dry run cannot be made

[^1]: [Link to confirmation of official recommendation by Google:](https://github.com/dataform-co/dataform/blob/main/vscode/README.md). Note that this is a community-led project and not an officially supported Google product.
