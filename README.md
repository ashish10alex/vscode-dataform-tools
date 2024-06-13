# Dataform tools - a vscode extension

⚠️ ***This is not an officially supported Google product.***


[Dataform vscode extension](https://marketplace.visualstudio.com/items?itemName=ashishalex.dataform-lsp-vscode) which supports


| Feature | Description |
|---------|-------------|
| [Auto-complete support](#autocomplete) | - declarations in `${ref("..")}` trigger when `$` character is typed <br><br> - `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix <br><br> - `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix |
| [Inline diagnostics on `.sqlx` file](#diagnostics) ❗ | Native lsp like experience with diagnostics being directly put on both the sqlx file & compiled query |
| [Compilation & Dry run stats](#compilation) | - Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your `.sqlx` file <br><br> - Data processed by query on bottom right on successful dry run |
| [Run a specific file/tag](#filetagruns) | Run a file/tag, optionally with dependencies/dependents with vscode command pallet / menu icons |


## Requirements

1. [Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)

   `npm i -g @dataform/cli@^3.0.0-beta`

2. [Setup default application credentails for gcp](https://cloud.google.com/docs/authentication/provide-credentials-adc)

3. [dj cli](https://github.com/ashish10alex/dataform_json_parser)

   ```bash
   git clone https://github.com/ashish10alex/dataform_json_parser.git

   cd dataform_json_parser

   # ensure go is installed in your system
   go build . -o dj

   # copy the binary to a place is visible from your system path e.g
   cp dj /usr/bin
   ```

4. To enable prettier diagnostics install [Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) extension [optional]

5. To enable syntax highlighting and auto-complete
   * In vscode: <kbd>CTLR</kbd> + <kbd>SHIFT</kbd> + <kbd>p</kbd> -> Change language mode -> Configure file association for `.sqlx` -> Select `SQL`


## Features

### <a id="autocomplete">Autocomplete model, tags, dependencies</a>

Auto completion support for `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix
![auto-completion](media/images/dependencies_autocompletion.gif)

* declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed
![auto-completion](media/images/sources_autocompletion.gif)

* Auto completion support for `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix
![auto-completion](media/images/tags_autocompletion.gif)

### <a id="diagnostics">Inline diagnostics errors on `.sqlx` files ❗</a>
![diagnostics](media/images/diagnostics.gif)


### <a id="compilation">Compilation & Dry run stats</a>
* Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your sqlx file. Data processed by query on bottom right on successful dry run
![compilation](media/images/compilation.gif)


### <a id="filetagruns">Run file/tag with dependencies/dependents</a>

Open vscode command pallet by pressing <kbd>CTLR</kbd> + <kbd>SHIFT</kbd> + <kbd>p</kbd> or <kbd>CMD</kbd> + <kbd>SHIFT</kbd> + <kbd>p</kbd> on mac and run one of the required commands

| Commands                                             |
|------------------------------------------------------|
| `Dataform: Run current file`                           |
| `Dataform: Run current file with dependencies`         |
| `Dataform: Run current file with dependents`           |
| `Dataform: Run current tag`                            |
| `Dataform: Run current tag with dependencies`          |
| `Dataform: Run current tag with dependents`            |



## Extension Settings


## Known Issues

- [ ] sync feature flickers when user tries to scroll a non-active editor. Fixes when user selects the active editor by clicking on it

## TODO

- [ ] Streamline installation process - script / build process for dependencies ( e.g. dataform / dj clis )
- [ ] Go to definition for a model
- [ ] Code suggestions on error
- [ ] Add proper logging, [winston-transport-vscode](https://github.com/loderunner/winston-transport-vscode)


