# dataform-lsp-vscode

Provide inline diagnostics errors for Dataform pipelines along with live compiled query on the vertical split which is in sync with the current cursor position.


This is the README for your extension "dataform-lsp-vscode". After writing up a brief description, we recommend including the following sections.

## Features

Add animations here

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

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

