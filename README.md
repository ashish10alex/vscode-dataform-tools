# Dataform tools - a vscode extension

[![Version](https://img.shields.io/github/v/release/ashish10alex/vscode-dataform-tools)](https://github.com/ashish10alex/vscode-dataform-tools/releases)
![Installs](https://img.shields.io/vscode-marketplace/i/ashishalex.dataform-lsp-vscode.svg)
![Linux](https://img.shields.io/badge/Linux-supported-success)
![macOS](https://img.shields.io/badge/macOS-supported-success)
![Windows](https://img.shields.io/badge/windows-supported-success)

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://buymeacoffee.com/ashishalexj)

⚠️ ***This is not an officially supported Google product.***


[VS Code extension](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) for [Dataform](https://github.com/dataform-co/dataform) with following features


| Feature | Description |
|---------|-------------|
| [Compiled Query & Dry run stats](#compilation) | Compiled query in a vertical split |
| [Dependancy graph](#depgraph) | Interative dependancy graph with external sources higlighted in distinct colors |
| [Inline diagnostics on `.sqlx` file](#diagnostics) ❗ | Native lsp like experience with diagnostics being directly put on both the sqlx file & compiled query |
| [Preview query results](#preview_query_results) | Preview query results in a table by running the file |
| [Go to definition](#definition) | Go to definition for source in `$ref{("my_source")}` and javascript blocks in `.sqlx` files  |
| [Auto-completion](#autocomplete) | - declarations in `${ref("..")}` trigger when `$` character is typed <br><br> - Dependencies when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix <br><br> - `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix |
| [Code actions](#codeactions) | Apply dry run suggestions at the speed of thought |
| [Run file(s)/tag(s)](#filetagruns) | Run file(s)/tag(s), optionally with dependencies/dependents/full refresh using vscode command pallet / menu icons |
| [Format using Sqlfluff](#formatting) 🪄 | Fromat `.sqlx` files using [sqlfluff](https://github.com/sqlfluff/sqlfluff)|
| [BigQuery snippets](#snippets) | Code snippets for generic BigQuery functions taken from [vscode-langauge-sql-bigquery](https://github.com/shinichi-takii/vscode-language-sql-bigquery) extension |

## Requirements

1. [Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)

   `npm i -g @dataform/cli`

   Run `dataform compile` from the root of your Dataform project to ensure that you are able to use the cli

2. [Install gcloud cli](https://cloud.google.com/sdk/docs/install) and run

   ```bash
   gcloud init
   ```
   ```bash
   gcloud auth application-default login
   ```


3. To enable formatting using [sqlfluff](https://github.com/sqlfluff/sqlfluff) install [sqlfluff](https://github.com/sqlfluff/sqlfluff)

   ```bash
   # install python and run
   pip install sqlfluff
   ```


4. To enable prettier diagnostics install [Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) extension [ **optional** ]

> [!NOTE]
Trouble installing ? Please see [FAQ section](FAQ.md), if you are still stuck, please [raise an issue here](https://github.com/ashish10alex/vscode-dataform-tools/issues)

## Features

### <a id="compilation">Compiled query & Dry run stats</a>
![compilation](media/images/compiled_query_preview.png)

### <a id="depgraph">Dependency graph</a>
![depgraph](/media/images/dependancy_tree.png)

### <a id="diagnostics">Inline diagnostics errors on `.sqlx` files ❗</a>
![diagnostics](media/images/diagnostics.png)

### <a id="preview_query_results">Preview query results</a>
![preview_query_results](/media/images/preview_query_results.png)


### <a id="definition">Go to definition</a>
Go to definition for source in `$ref{("my_source")}`. Takes you to `my_source.sqlx` or `sources.js` at the line where `my_source` is defined. There is also support for go to definiton
from a javascript variable/module from a `.sqlx` file to `js` block or `.js` file where the virable or module declaration exsists

![go-to-definition](media/images/go_to_definition.gif)

### <a id="autocomplete">Autocomplete model, tags, dependencies</a>

Auto completion support for `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix

![auto-completion](media/images/dependencies_autocompletion.gif)

Declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed

![auto-completion](media/images/sources_autocompletion.gif)

Auto completion support for `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix

![auto-completion](media/images/tags_autocompletion.gif)

### <a id="formatting">Formatting using sqlfluff</a>

![formatting](media/images/formatting.gif)



### <a id="filetagruns">Run file/tag with dependencies/dependents</a>

Open vscode command pallet by pressing <kbd>CTLR</kbd> + <kbd>SHIFT</kbd> + <kbd>p</kbd> or <kbd>CMD</kbd> + <kbd>SHIFT</kbd> + <kbd>p</kbd> on mac and run one of the required commands

| Commands                                               |
|------------------------------------------------------  |
| `Dataform: Run current file`                           |
| `Dataform: Run current file with dependencies`         |
| `Dataform: Run current file with dependents`           |
| `Dataform: Run current tag`                            |
| `Dataform: Run current tag with dependencies`          |
| `Dataform: Run current tag with dependents`            |
| `Dataform: Format current file`                        |
| `Dataform: Run file(s) / tag(s) with options`          |

## Known Issues

- [ ] Features such as go to definition / dependancy graph might not work with consistantly with `${ref("dataset", "table")}` or when it is multiline or a different format works best with `${ref('table_name')}` format

## TODO

- [ ] Handle case where user is not connected to internet or on vpn where network request for dry run cannot be made


