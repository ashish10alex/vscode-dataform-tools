# dataform-lsp-vscode

⚠️ ***This is not an officially supported Google product.***


Provides support for

* Run a specific file, optionally with dependencies
* Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your `.sqlx` file
* Data processed by query on bottom right on successful dry run
* Inline diagnostics errors on `.sqlx` files ❗
* Auto completion support for
    * declarations in `${ref("..")}` trigger when `$` character is typed
    * `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix
    * `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix

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

* Live compiled query in a vertical split **on save** which is in sync with the current cursor position of your sqlx file. Data processed by query on bottom right on successful dry run
![compilation](media/images/compilation.gif)

* Inline diagnostics errors on `.sqlx` files ❗
![diagnostics](media/images/diagnostics.gif)

* declarations in `${ref("..")}` trigger when <kdb>$<kdb> character is typed
![auto-completion](media/images/sources_autocompletion.gif)

* Auto completion support for `dependencies` when `"` or `'` is typed inside the config block which has `dependencies` keyword is in the line prefix
![auto-completion](media/images/dependencies_autocompletion.gif)

* Auto completion support for `tags` when `"` or `'` is typed inside the config block which has `tags` keyword is in the line prefix
![auto-completion](media/images/tags_autocompletion.gif)


## Extension Settings


## Known Issues

- [ ] sync between sqlx file and its compiled output is being carried over to the git hunks
- [ ] sync feature flickers when user tries to scroll a non-active editor. Fixes when user selects the active editor by clicking on it

## TODO

- [ ] Add proper logging, [winston-transport-vscode](https://github.com/loderunner/winston-transport-vscode)
- [ ] Make compiling query to vertical split to a command
- [x] Ability to run a file optionally with dependencies


