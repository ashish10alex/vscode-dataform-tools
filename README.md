# dataform-lsp-vscode

Provides support for

* Inline diagnostics errors
* Live compiled query on the vertical split which is in sync with the current cursor position of your sqlx file
* Auto completion support for declarations in `${ref("..")}`

## Features

Add animations here..

## Requirements

1. [Dataform cli](https://cloud.google.com/dataform/docs/use-dataform-cli)

   `npm i -g @dataform/cli`

2. `dj` cli

   ```bash
   git clone ...

   cd dataform-json-parser

   # ensure go is installed in your system
   go build . -o dj

   # copy the binary to a place is visible from your system path
   cp dj /usr/bin
   ```

3. To enable prettier diagnostics install [Error Lens](https://marketplace.visualstudio.com/items?itemName=usernamehw.errorlens) extension [optional]

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

- [ ] sync between sqlx file and its compiled output is being carried over to the git hunks
- [ ] sync feature flickers when user tries to scroll a non-active editor. Fixes when user selects the active editor by clicking on it

## Release Notes

