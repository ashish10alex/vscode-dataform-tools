# Dataform tools - a vscode extension

[![Version](https://img.shields.io/github/v/release/ashish10alex/vscode-dataform-tools)](https://github.com/ashish10alex/vscode-dataform-tools/releases)
![Linux](https://img.shields.io/badge/Linux-supported-success)
![macOS](https://img.shields.io/badge/macOS-supported-success)
![Windows](https://img.shields.io/badge/windows-supported-success)

⚠️ ***This is not an officially supported Google product.***


[Dataform vscode extension](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) which supports


| Feature | Description |
|---------|-------------|
| [Dependancy graph](#depgraph) | Interative dependancy graph with external sources higlighted in distinct colors |
| [Go to definition](#definition) | Go to definition for source in `$ref{("MY_SOURCE")}`. Takes you to `MY_SOURCE.sqlx` or `sources.js` at the line where `MY_SOURCE` is defined |
| [Inline diagnostics on `.sqlx` file](#diagnostics) ❗ | Native lsp like experience with diagnostics being directly put on both the sqlx file & compiled query |
| [Auto-completion](#autocomplete) | - declarations in `${ref("..")}` trigger when `$` character is typed <br><br> - Dependencies when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix <br><br> - `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix |
| [Code actions](#codeactions) | Apply dry run suggestions at the speed of thought |
| [Compilation & Dry run stats](#compilation) | - Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your `.sqlx` file <br><br> - Data processed by query on bottom right on successful dry run |
| [Run a specific file/tag](#filetagruns) | Run a file/tag, optionally with dependencies/dependents with vscode command pallet / menu icons |
| [Format using Sqlfluff](#formatting) 🪄 | Fromat `.sqlx` files based on [sqlfluff](https://github.com/sqlfluff/sqlfluff) config using [formatdataform](https://github.com/ashish10alex/formatdataform) cli |


## Requirements

1. [Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)

   `npm i -g @dataform/cli`

2. [Setup default application credentials for GCP](https://cloud.google.com/docs/authentication/provide-credentials-adc)


3. To enable formatting using [sqlfluff](https://github.com/sqlfluff/sqlfluff) config install [formatdataform](https://github.com/ashish10alex/formatdataform) extension [ **optional** ]

   ```bash
   # install python and run
   pip install sqlfluff

   # install formatdataform cli
   curl -sSfL https://raw.githubusercontent.com/ashish10alex/formatdataform/main/install_latest.sh | bash
   ```

    You can verify if `formatdataform` is installed correctly by running
    ```bash
    formatdataform --help
    ```


4. To enable prettier diagnostics install [Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) extension [ **optional** ]

## Features

### <a id="depgraph">Dependency graph</a>
![depgraph](/media/images/dependancy_tree.png)


### <a id="autocomplete">Autocomplete model, tags, dependencies</a>

Auto completion support for `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix
![auto-completion](media/images/dependencies_autocompletion.gif)

* declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed
![auto-completion](media/images/sources_autocompletion.gif)

* Auto completion support for `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix
![auto-completion](media/images/tags_autocompletion.gif)


### <a id="definition">Go to definition</a>
Go to definition for source in `$ref{("MY_SOURCE")}`. Takes you to `MY_SOURCE.sqlx` or `sources.js` at the line where `MY_SOURCE` is defined
![go-to-definition](media/images/go_to_definition.gif)


### <a id="diagnostics">Inline diagnostics errors on `.sqlx` files ❗</a>
![diagnostics](media/images/diagnostics.gif)


### <a id="compilation">Compilation & Dry run stats</a>
* Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your sqlx file. Data processed by query on bottom right on successful dry run
![compilation](media/images/compilation.gif)

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



## Extension Settings


## Known Issues

- [ ] sync feature flickers when user tries to scroll a non-active editor. Fixes when user selects the active editor by clicking on it

## TODO

- [ ] Preview query results
- [ ] Bundle javascript files in the extension using [esbuild or webpack](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [ ] Handle case where user is not connected to internet or on vpn where network request for dry run cannot be made
- [ ] Add proper logging, [winston-transport-vscode](https://github.com/loderunner/winston-transport-vscode)


